import type { RecommendedAction, TabRecommendation } from '@shared/types';

export function getLiveRecommendations(
  recommendations: TabRecommendation[],
  openTabIds: Set<number>,
): TabRecommendation[] {
  return recommendations.filter((recommendation) => openTabIds.has(recommendation.tabId));
}

export function getRecommendationActionCounts(
  recommendations: TabRecommendation[],
): Partial<Record<RecommendedAction, number>> {
  return recommendations.reduce<Partial<Record<RecommendedAction, number>>>((counts, recommendation) => {
    counts[recommendation.action] = (counts[recommendation.action] ?? 0) + 1;
    return counts;
  }, {});
}
