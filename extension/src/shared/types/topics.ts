export interface TopicMaterial {
  key: string;
  url: string;
  title: string;
  collectionIds: string[];
}

export interface Topic {
  id: string;
  name: string;
  focus: string;
  accepted: boolean;
  revision: number;
  userRevision?: number;
  createdAt: number;
  updatedAt: number;
  sourceKeys: string[];
  aliases: string[];
  materials: TopicMaterial[];
  excludedKeys: string[];
  relatedIds: string[];
  deletedAt?: number;
  mergedInto?: string;
}

export interface TopicCatalog {
  version: 1;
  revision: number;
  topics: Topic[];
  history: { id: string; label: string; createdAt: number; before: Topic[]; after: Record<string, number>; undone?: boolean }[];
  distinct: { a: string; b: string; fingerprint: string }[];
  serverUpdatedAt?: number;
  serverError?: string;
}

export interface TopicSource {
  key: string;
  name: string;
  focus: string;
  accepted: boolean;
  materials: TopicMaterial[];
}

export type TopicCommand =
  | { action: 'create'; name: string; focus?: string; materials: TopicMaterial[] }
  | { action: 'update'; id: string; revision: number; userRevision?: number; name?: string; focus?: string; accepted?: boolean; deleted?: boolean; add?: TopicMaterial[]; removeKeys?: string[] }
  | { action: 'merge'; ids: string[]; revisions: Record<string, number>; name: string }
  | { action: 'link' | 'different'; ids: string[]; revisions: Record<string, number> }
  | { action: 'split'; id: string; revision: number; name: string; materialKeys: string[] }
  | { action: 'undo'; historyId: string };
