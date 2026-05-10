export interface CloseTabsResult {
  closedTabIds: number[];
  failedTabIds: number[];
  errors: string[];
}

function stringifyTabCloseError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  const message = String(error).trim();
  return message || 'Unknown tab close error';
}

export async function closeChromeTabs(
  tabIds: number[],
  removeTab: (tabId: number) => Promise<void>,
): Promise<CloseTabsResult> {
  const seen = new Set<number>();
  const uniqueTabIds = tabIds.filter((tabId) => {
    if (!Number.isInteger(tabId) || seen.has(tabId)) {
      return false;
    }
    seen.add(tabId);
    return true;
  });

  const closedTabIds = new Set<number>();
  const failedTabIds = new Set<number>();
  const errors = new Map<number, string>();

  await Promise.all(uniqueTabIds.map(async (tabId) => {
    try {
      await removeTab(tabId);
      closedTabIds.add(tabId);
    } catch (error) {
      const message = stringifyTabCloseError(error);
      if (message.toLowerCase().includes('no tab with id')) {
        // Treat already-closed tabs as a successful end state for the UI.
        closedTabIds.add(tabId);
        return;
      }
      failedTabIds.add(tabId);
      errors.set(tabId, message);
    }
  }));

  return {
    closedTabIds: uniqueTabIds.filter((tabId) => closedTabIds.has(tabId)),
    failedTabIds: uniqueTabIds.filter((tabId) => failedTabIds.has(tabId)),
    errors: uniqueTabIds
      .filter((tabId) => errors.has(tabId))
      .map((tabId) => `Tab ${tabId}: ${errors.get(tabId)}`),
  };
}
