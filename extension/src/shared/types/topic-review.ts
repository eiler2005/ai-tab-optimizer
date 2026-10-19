export interface TopicPairSuggestion {
  a: string;
  b: string;
  shared: number;
  onlyA: number;
  onlyB: number;
  reason: 'same_materials' | 'overlap' | 'name';
  score: number;
}
export interface TopicAdvice {
  relation: 'same_task' | 'related' | 'different' | 'uncertain';
  reason: string;
  commonGround: string[];
  uniqueA: string[];
  uniqueB: string[];
  suggestedName: string;
  evidence: { topicId: string; materialKey: string; quote: string }[];
  provider?: string;
  model?: string;
}
export interface TopicAdviceJob {
  id: string;
  topicIds: string[];
  revisions: Record<string, number>;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  startedAt: number;
  updatedAt: number;
  sampled: number[];
  totals: number[];
  evidenceCount: number;
  advice?: TopicAdvice;
  error?: string;
}
