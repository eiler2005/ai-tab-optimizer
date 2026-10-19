export interface CleanupIdentity { id: number; url: string }
export interface CleanupPosition { order: CleanupIdentity[]; index: number; offset: number }

export function resumeCleanup(position: CleanupPosition, remaining: CleanupIdentity[]): CleanupIdentity | undefined {
  const unchanged = (old: CleanupIdentity) => remaining.find((item) => item.id === old.id && item.url === old.url);
  for (const old of position.order.slice(position.index)) {
    const match = unchanged(old);
    if (match) return match;
  }
  for (const old of position.order.slice(0, position.index).reverse()) {
    const match = unchanged(old);
    if (match) return match;
  }
  return remaining[0];
}
