import { afterEach, expect, it } from 'vitest';
import { makeTab } from '@shared/utils/__tests__/fixtures';
import { useStore } from '../store';
import { filteredWindows } from '../tab-filter';

afterEach(() => useStore.setState(useStore.getInitialState()));
const windows = [
  { windowId: 1, focused: false, tabs: [makeTab({ id: 1, url: 'https://a.test/guide', title: 'Guide' }), makeTab({ id: 2, url: 'https://b.test/guide' })] },
  { windowId: 2, focused: true, tabs: [makeTab({ id: 3, windowId: 2, url: 'https://a.test/reference', title: 'Reference' })] },
];

it('selects every matching result but never tabs outside the search and window scope', () => {
  useStore.setState({ windowGroups: windows, searchQuery: 'a.test', tabScope: 'current' });
  useStore.getState().selectAll();
  expect([...useStore.getState().selectedTabIds]).toEqual([3]);
  useStore.setState({ tabScope: 'all' }); useStore.getState().selectAll();
  expect([...useStore.getState().selectedTabIds].sort()).toEqual([1, 3]);
});

it('intersects topic scope, search and selected-only view without losing hidden selection', () => {
  useStore.setState({ windowGroups: windows, tabTopicUrls: ['https://a.test/guide'], selectedTabIds: new Set([1, 3]), showSelectedOnly: true });
  expect(filteredWindows(windows, useStore.getState()).flatMap((window) => window.tabs.map((tab) => tab.id))).toEqual([1]);
  expect(useStore.getState().selectedTabIds.size).toBe(2);
});

it('keeps current window first and includes all matches beyond the first rendered page', () => {
  const many = Array.from({ length: 650 }, (_, index) => makeTab({ id: index + 10 }));
  useStore.setState({ windowGroups: [...windows, { windowId: 3, focused: false, tabs: many }] });
  useStore.getState().selectAll();
  expect(useStore.getState().selectedTabIds.size).toBe(653);
  expect(filteredWindows(useStore.getState().windowGroups, useStore.getState())[0].windowId).toBe(2);
});
