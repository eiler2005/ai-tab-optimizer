import type { CachedAIResult, PersistentCluster } from '@shared/types';
import type { Topic, TopicCatalog, TopicCommand, TopicMaterial, TopicSource } from '@shared/types/topics';
import { emptyTopicCatalog, mergeMaterials, reconcileTopics, topicMaterial, topicPairFingerprint } from '@shared/utils/topics';
import { browserSessionId, readWorkspace, saveWorkspace, withWorkspaceLock } from './workspace-storage';
import { readBrowserState } from './browser-state';

function name(value: string, max = 120) { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid topic text'); return value.trim(); }
function materials(input: TopicMaterial[]): TopicMaterial[] {
  if (!Array.isArray(input) || input.length > 2000) throw new Error('Topic exceeds 2,000 material entries');
  return mergeMaterials(input.map((item) => {
    if (!item || typeof item.url !== 'string' || item.url.length > 8192 || !/^https?:\/\//i.test(item.url)
      || typeof item.key !== 'string' || item.key.length > 9000 || typeof item.title !== 'string' || item.title.length > 4000
      || !Array.isArray(item.collectionIds) || item.collectionIds.some((id) => typeof id !== 'string')) throw new Error('Invalid topic material');
    new URL(item.url);
    return topicMaterial(item.url, item.title, item.key, [...new Set(item.collectionIds)]);
  }));
}

export async function getTopicCatalog(server?: { clusters: PersistentCluster[]; updatedAt: number; error?: string }): Promise<{ catalog: TopicCatalog; sessionId: string }> {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace(); const sessionId = await browserSessionId();
    const sources: TopicSource[] = [];
    const windows = await readBrowserState(); const tabs = windows.flatMap((window) => window.tabs);
    for (const collection of workspace.collections.filter((item) => !item.deletedAt)) sources.push({ key: 'collection:' + collection.id,
      name: collection.name, focus: collection.focus ?? '', accepted: true,
      materials: collection.windows.flatMap((window) => window.tabs.filter((tab) => /^https?:\/\//i.test(tab.url)).map((tab) => topicMaterial(tab.url, tab.title, `saved:${collection.id}:${tab.itemId}`, [collection.id]))) });
    for (const window of windows) for (const groupId of new Set(window.tabs.map((tab) => tab.groupId).filter((id): id is number => id !== undefined && id >= 0))) {
      const members = window.tabs.filter((tab) => tab.groupId === groupId && /^https?:\/\//i.test(tab.url));
      sources.push({ key: `group:${sessionId}:${groupId}`, name: members[0]?.groupName || 'Chrome group', focus: '', accepted: true,
        materials: members.map((tab) => topicMaterial(tab.url, tab.title, `live:${sessionId}:${tab.id}`)) });
    }
    const stored = await chrome.storage.local.get(['lastAIResult', 'aitab.topic-server-cache']);
    const cached = stored.lastAIResult as CachedAIResult | undefined;
    for (const cluster of cached?.result.topicClusters ?? []) {
      const urls = [...new Set(cluster.tabUrls?.length ? cluster.tabUrls : tabs.filter((tab) => cluster.tabIds.includes(tab.id)).map((tab) => tab.url))].filter((url) => /^https?:\/\//i.test(url));
      const key = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([cluster.name, [...urls].sort()])));
      const fingerprint = [...new Uint8Array(key)].map((value) => value.toString(16).padStart(2, '0')).join('');
      sources.push({ key: 'ai:' + fingerprint, name: cluster.name, focus: '', accepted: false,
        materials: urls.filter((url) => !/^https?:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)(\/|$)/i.test(url)).map((url) => topicMaterial(url, tabs.find((tab) => tab.url === url)?.title ?? url, 'ai:' + fingerprint + ':' + url)) });
    }
    const cache = server ?? stored['aitab.topic-server-cache'] as typeof server;
    for (const cluster of cache?.clusters ?? []) sources.push({ key: 'persistent:' + cluster.id, name: cluster.name, focus: '', accepted: true,
      materials: cluster.tabUrls.filter((url) => /^https?:\/\//i.test(url) && !/^https?:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)(\/|$)/i.test(url)).map((url) => topicMaterial(url, tabs.find((tab) => tab.url === url)?.title ?? url, 'persistent:' + cluster.id + ':' + url)) });
    const before = workspace.topicCatalog ?? emptyTopicCatalog();
    const catalog = reconcileTopics(before, sources);
    if (cache) { catalog.serverUpdatedAt = cache.updatedAt; catalog.serverError = cache.error; }
    if (JSON.stringify(catalog) !== JSON.stringify(before)) {
      if (!workspace.topicCatalog) await chrome.storage.local.set({ 'aitab.before-topics': { createdAt: Date.now(), workspaceRevision: workspace.revision, catalog: before } });
      catalog.revision++; workspace.topicCatalog = catalog; await saveWorkspace(workspace);
    }
    if (server) await chrome.storage.local.set({ 'aitab.topic-server-cache': server });
    return { catalog, sessionId };
  });
}

export async function changeTopics(command: TopicCommand): Promise<TopicCatalog> {
  return withWorkspaceLock(async () => {
    const workspace = await readWorkspace(); const catalog = structuredClone(workspace.topicCatalog ?? emptyTopicCatalog());
    const before: Topic[] = []; const touched = new Set<string>();
    const take = (id: string, revision?: number) => {
      const topic = catalog.topics.find((item) => item.id === id && !item.deletedAt && !item.mergedInto);
      const metadataOnly = command.action === 'update' && command.userRevision !== undefined && !command.add && !command.removeKeys && !command.deleted;
      if (!topic || (revision !== undefined && topic.revision !== revision && !(metadataOnly && command.action === 'update' && command.userRevision === (topic.userRevision ?? 0)))) throw new Error('Topic changed. Refresh before applying.');
      if (command.action === 'update' && command.userRevision !== undefined && command.userRevision !== (topic.userRevision ?? 0)) throw new Error('Topic was edited elsewhere. Refresh before applying.');
      if (!touched.has(id)) { before.push(structuredClone(topic)); touched.add(id); }
      return topic;
    };
    const create = (title: string, focus: string, entries: TopicMaterial[]) => {
      if (catalog.topics.length >= 500) throw new Error('Topic catalog limit reached (500)');
      const topic: Topic = { id: crypto.randomUUID(), name: name(title), focus: focus.slice(0, 1000), accepted: true, revision: 0,
        createdAt: Date.now(), updatedAt: Date.now(), sourceKeys: [], aliases: [], materials: materials(entries), excludedKeys: [], relatedIds: [] };
      catalog.topics.push(topic); touched.add(topic.id); return topic;
    };
    if (command.action === 'undo') {
      const record = catalog.history.find((entry) => entry.id === command.historyId);
      if (!record) throw new Error('Topic history entry missing');
      if (record.undone) return catalog;
      if (Object.entries(record.after).some(([id, revision]) => catalog.topics.find((topic) => topic.id === id)?.revision !== revision)) throw new Error('Topic changed since this action. Undo newer changes first.');
      for (const [id] of Object.entries(record.after)) {
        const previous = record.before.find((topic) => topic.id === id);
        const current = catalog.topics.find((topic) => topic.id === id)!;
        if (previous) catalog.topics[catalog.topics.indexOf(current)] = { ...previous, revision: current.revision + 1, userRevision: (current.userRevision ?? 0) + 1, updatedAt: Date.now() };
        else Object.assign(current, { deletedAt: Date.now(), revision: current.revision + 1 });
      }
      // Earlier actions may now be undone after this action; retain monotonic revisions.
      for (const entry of catalog.history.filter((entry) => !entry.undone && entry !== record)) for (const id of Object.keys(record.after)) {
        const previous = record.before.find((topic) => topic.id === id);
        if (previous && entry.after[id] === previous.revision) entry.after[id] = catalog.topics.find((topic) => topic.id === id)!.revision;
      }
      record.undone = true;
    } else {
      if (command.action === 'create') create(command.name, command.focus ?? '', command.materials);
      else if (command.action === 'update') {
        const topic = take(command.id, command.revision);
        if (command.name !== undefined) { topic.aliases = [...new Set([...topic.aliases, topic.name])]; topic.name = name(command.name); }
        if (command.focus !== undefined) { if (command.focus.length > 1000) throw new Error('Focus exceeds 1,000 characters'); topic.focus = command.focus; }
        if (command.accepted !== undefined) topic.accepted = command.accepted;
        if (command.deleted) topic.deletedAt = Date.now();
        if (command.removeKeys) { topic.excludedKeys = [...new Set([...topic.excludedKeys, ...command.removeKeys])]; topic.materials = topic.materials.filter((item) => !command.removeKeys!.includes(item.key)); }
        if (command.add) { const added = materials(command.add); topic.excludedKeys = topic.excludedKeys.filter((key) => !added.some((item) => item.key === key)); topic.materials = materials([...topic.materials, ...added]); }
      } else if (command.action === 'split') {
        const topic = take(command.id, command.revision); const selected = new Set(command.materialKeys);
        const entries = topic.materials.filter((item) => selected.has(item.key));
        if (!entries.length || entries.length === topic.materials.length || entries.length !== selected.size) throw new Error('Select a non-empty proper subset to split');
        const created = create(command.name, topic.focus, entries);
        topic.materials = topic.materials.filter((item) => !selected.has(item.key)); topic.excludedKeys = [...new Set([...topic.excludedKeys, ...selected])];
        topic.relatedIds.push(created.id); created.relatedIds.push(topic.id);
      } else {
        if (command.ids.length !== 2 || command.ids[0] === command.ids[1]) throw new Error('Choose two distinct topics');
        if (command.ids.some((id) => !Number.isSafeInteger(command.revisions[id]))) throw new Error('Topic revisions are required');
        const pair = command.ids.map((id) => take(id, command.revisions[id]));
        if (command.action === 'merge') {
          const [target, source] = pair;
          target.name = name(command.name); target.accepted = true;
          target.aliases = [...new Set([...target.aliases, ...source.aliases, source.name, before[0].name])];
          target.materials = materials([...target.materials, ...source.materials]);
          target.sourceKeys = [...new Set([...target.sourceKeys, ...source.sourceKeys])];
          target.excludedKeys = target.excludedKeys.filter((key) => source.excludedKeys.includes(key));
          target.focus = [...new Set([target.focus, source.focus].filter(Boolean))].join('\n').slice(0, 1000);
          target.relatedIds = [...new Set([...target.relatedIds, ...source.relatedIds])].filter((id) => !command.ids.includes(id));
          source.mergedInto = target.id;
        } else if (command.action === 'link') {
          for (const topic of pair) topic.relatedIds = [...new Set([...topic.relatedIds, pair.find((item) => item !== topic)!.id])];
        } else catalog.distinct = [...catalog.distinct.filter((item) => !command.ids.includes(item.a) || !command.ids.includes(item.b)), { a: pair[0].id, b: pair[1].id, fingerprint: await topicPairFingerprint(pair[0], pair[1]) }].slice(-500);
      }
      for (const id of touched) { const topic = catalog.topics.find((item) => item.id === id)!; topic.revision++; topic.userRevision = (topic.userRevision ?? 0) + 1; topic.updatedAt = Date.now(); }
      catalog.history.push({ id: crypto.randomUUID(), createdAt: Date.now(), label: command.action, before,
        after: Object.fromEntries([...touched].map((id) => [id, catalog.topics.find((item) => item.id === id)!.revision])) });
      catalog.history = catalog.history.slice(-30);
    }
    catalog.revision++; workspace.topicCatalog = catalog; await saveWorkspace(workspace); return catalog;
  });
}
