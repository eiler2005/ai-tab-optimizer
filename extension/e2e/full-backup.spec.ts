import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, request } from './fixtures';
import type { CollectionPreview, WorkspaceData } from '../src/shared/types/workspace';
import type { FullBackup } from '../src/shared/types/backup';
import type { ContentReviewJob } from '../src/shared/types/content-review';

test('real extension and FastAPI create a complete backup and append collections without opening tabs', async ({ panel, worker, context }) => {
  const directory = await mkdtemp(join(tmpdir(), 'aitab-server-e2e-'));
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No isolated test port');
  const port = address.port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const localPython = resolve('../.venv/bin/python');
  const process = spawn(existsSync(localPython) ? localPython : 'python', ['tests/e2e_server.py'], { cwd: resolve('..'), stdio: ['ignore', 'pipe', 'pipe'], env: { ...globalThis.process.env,
    AITAB_E2E_DB: join(directory, 'test.sqlite'), AITAB_E2E_PORT: String(port), AITAB_BACKUP_DIR: join(directory, 'backups') } });
  let logs = ''; process.stderr.on('data', (chunk) => { logs += String(chunk); });
  try {
    await expect.poll(async () => {
      if (process.exitCode !== null) throw new Error(logs);
      try { return (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { return false; }
    }, { timeout: 15_000 }).toBe(true);
    await context.route(`http://127.0.0.1:${port}/**`, (route) => route.continue());
    await worker.evaluate(async (server) => { const old = (await chrome.storage.local.get('settings')).settings as object; await chrome.storage.local.set({ settings: { ...old, localServerUrl: server } }); }, `http://127.0.0.1:${port}`);
    const urls = [`http://127.0.0.1:${port}/health`, `http://127.0.0.1:${port}/openapi.json`];
    for (const url of urls) { const page = await context.newPage(); await page.goto(url); }
    await request(panel, { type: 'START_CONTENT_REVIEW', options: { readContent: true, useAi: false, deepUrls: urls } });
    await expect.poll(async () => (await request<ContentReviewJob>(panel, { type: 'GET_CONTENT_REVIEW_JOB' })).status).toBe('completed');
    const reviewed = await request<ContentReviewJob>(panel, { type: 'GET_CONTENT_REVIEW_JOB' });
    expect(reviewed.preview?.extractedCount).toBe(2);
    expect(Object.values(reviewed.preview?.evidence ?? {}).map((item) => item.text).join(' ')).toContain('openapi');
    const id = await worker.evaluate(async () => (await chrome.tabs.create({ url: 'http://aitab.test/backed-up', active: false })).id!);
    await expect.poll(async () => panel.evaluate(async (tabId) => (await chrome.tabs.get(tabId)).url, id)).toBe('http://aitab.test/backed-up');
    const preview = await request<CollectionPreview>(panel, { type: 'PREVIEW_COLLECTION', name: 'Backed up', tabIds: [id] });
    await request(panel, { type: 'SAVE_COLLECTION', previewId: preview.id, closeAfter: false });
    const backup = await request<FullBackup>(panel, { type: 'CREATE_FULL_BACKUP' });
    expect(JSON.parse(await readFile(join(backup.path, 'manifest.json'), 'utf8')).scope).toContain('SQLite analysis/history/snapshots');
    expect((await readFile(join(backup.path, 'database.sqlite'))).subarray(0, 15).toString()).toBe('SQLite format 3');
    expect(execFileSync(existsSync(localPython) ? localPython : 'python', ['scripts/verify-workspace-backup.py', backup.path], { cwd: resolve('..'), encoding: 'utf8' })).toContain('checksums and SQLite integrity verified');
    const before = await panel.evaluate(async () => (await chrome.tabs.query({})).length);
    const restore = await request<{ id: string }>(panel, { type: 'PREVIEW_FULL_BACKUP_RESTORE', backupId: backup.id });
    await request(panel, { type: 'IMPORT_WORKSPACE_BACKUP', previewId: restore.id });
    expect((await request<WorkspaceData>(panel, { type: 'WORKSPACE_OVERVIEW' })).collections).toHaveLength(2);
    expect(await panel.evaluate(async () => (await chrome.tabs.query({})).length)).toBe(before);
    await request(panel, { type: 'CONFIGURE_BACKUPS', settings: { enabled: true, intervalHours: 24, retention: 3 } });
    expect(await panel.evaluate(async () => (await chrome.alarms.get('aitab-full-backup'))?.periodInMinutes)).toBe(1440);
  } finally {
    const stopped = new Promise<void>((done) => process.once('exit', () => done()));
    process.kill('SIGTERM');
    const timer = setTimeout(() => process.kill('SIGKILL'), 5000);
    if (process.exitCode === null) await stopped;
    clearTimeout(timer);
    await rm(directory, { recursive: true, force: true });
  }
});
