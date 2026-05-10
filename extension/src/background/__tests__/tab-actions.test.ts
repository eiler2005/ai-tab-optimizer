import { describe, expect, it } from 'vitest';
import { closeChromeTabs } from '../tab-actions';

describe('background tab actions', () => {
  it('treats already-closed tabs as a successful close state', async () => {
    const result = await closeChromeTabs([10], async () => {
      throw new Error('No tab with id: 10.');
    });

    expect(result).toEqual({
      closedTabIds: [10],
      failedTabIds: [],
      errors: [],
    });
  });

  it('reports genuine close failures', async () => {
    const result = await closeChromeTabs([11], async () => {
      throw new Error('Tabs cannot be edited right now (user may be dragging a tab).');
    });

    expect(result.closedTabIds).toEqual([]);
    expect(result.failedTabIds).toEqual([11]);
    expect(result.errors[0]).toContain('Tabs cannot be edited right now');
  });

  it('deduplicates tab ids before closing', async () => {
    const closed: number[] = [];
    const result = await closeChromeTabs([5, 5, 6], async (tabId) => {
      closed.push(tabId);
    });

    expect(closed).toEqual([5, 6]);
    expect(result.closedTabIds).toEqual([5, 6]);
    expect(result.failedTabIds).toEqual([]);
  });
});
