import { afterEach, describe, expect, it, vi } from 'vitest';
import { collapseTopic } from '../topic-actions';
import { mockBrowser } from './mock-browser';
import { makeTab } from '../../shared/utils/__tests__/fixtures';

afterEach(() => vi.unstubAllGlobals());
describe('topic collapse', () => {
  it('collapses each window independently and preserves pinned tabs and live pages', async () => {
    const browser = mockBrowser([makeTab({ id: 1, windowId: 1 }), makeTab({ id: 2, windowId: 2 }), makeTab({ id: 3, windowId: 2, pinned: true })]);
    const ids = await collapseTopic([1, 2, 3], 'Research', true);
    expect(ids).toHaveLength(2);
    expect(browser.tabs.get(1)?.windowId).toBe(1);
    expect(browser.tabs.get(2)?.windowId).toBe(2);
    expect(browser.tabs.get(3)?.groupId).toBe(-1);
    expect([...browser.groups.values()].every((group) => group.collapsed && group.title === 'Research')).toBe(true);
    expect(browser.api.tabs.remove).not.toHaveBeenCalled();
    await expect(collapseTopic([999], 'Research', true)).rejects.toThrow('changed');
  });
});
