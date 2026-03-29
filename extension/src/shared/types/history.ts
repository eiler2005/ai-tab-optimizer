export type TabHistoryEvent = 'opened' | 'closed' | 'activated';

export interface TabHistoryEntry {
  tabId: number;
  url: string;
  title: string;
  domain: string;
  event: TabHistoryEvent;
  timestamp: number;
}

export type HistoryTimeframe = 'day' | 'week' | 'month';

export interface TabHistoryStats {
  url: string;
  title: string;
  domain: string;
  favIconUrl?: string;
  activationCount: number;
  firstSeen: number;
  lastSeen: number;
  lastOpenedAt: number | null;
  stillOpen: boolean;
}
