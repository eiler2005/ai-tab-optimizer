import type { TabRecord } from '@shared/types/tab';

let idCounter = 1;

export function makeTab(overrides: Partial<TabRecord> = {}): TabRecord {
  const id = overrides.id ?? idCounter++;
  const url = overrides.url ?? `https://example.com/page-${id}`;
  return {
    id,
    windowId: 1,
    index: id - 1,
    url,
    title: overrides.title ?? `Tab ${id}`,
    domain: overrides.domain ?? new URL(url).hostname,
    pinned: false,
    active: false,
    ...overrides,
  };
}

export function resetIdCounter() {
  idCounter = 1;
}
