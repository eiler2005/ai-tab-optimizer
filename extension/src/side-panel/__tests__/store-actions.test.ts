import { afterEach, expect, it, vi } from 'vitest';
import { useStore } from '../store';

afterEach(() => { vi.unstubAllGlobals(); useStore.setState(useStore.getInitialState()); });

it('keeps failed close selections and exposes partial errors', async () => {
  vi.stubGlobal('chrome', { storage: { local: { get: async () => ({ settings: {} }) } }, runtime: { sendMessage: async (message: { type: string }) => {
    if (message.type === 'CLOSE_TABS') return { success: true, data: { closedTabIds: [1], failedTabIds: [2], errors: ['Tab 2: dragging'] } };
    if (message.type === 'GET_ALL_TABS') return { success: true, data: { windowGroups: [], totalTabs: 0 } };
    if (message.type === 'GET_TAB_ANALYSIS_STATUS') return { success: true, data: { statuses: [] } };
    return { success: true, data: {} };
  } } });
  useStore.setState({ selectedTabIds: new Set([1, 2]) });
  await useStore.getState().closeTabs([1, 2]);
  expect([...useStore.getState().selectedTabIds]).toEqual([2]);
  expect(useStore.getState().actionError).toContain('dragging');
});

it('does not mark a failed cleanup action as complete', async () => {
  vi.stubGlobal('chrome', { runtime: { sendMessage: async () => ({ success: false, error: 'Tab is protected' }) } });
  await expect(useStore.getState().applyCleanupAction(1, 'archive')).rejects.toThrow('protected');
  expect(useStore.getState().cleanupActions.size).toBe(0);
  expect(useStore.getState().cleanupStep).toBe(0);
});

it('shows an error and retains selection when every manual close fails', async () => {
  vi.stubGlobal('chrome', { runtime: { sendMessage: async () => ({ success: false, error: 'Storage unavailable' }) } });
  useStore.setState({ selectedTabIds: new Set([1]) });
  await useStore.getState().closeTabs([1]);
  expect([...useStore.getState().selectedTabIds]).toEqual([1]);
  expect(useStore.getState().actionError).toContain('Storage unavailable');
});
