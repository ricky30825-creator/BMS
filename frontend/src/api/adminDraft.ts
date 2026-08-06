export type DraftReconciliation<T> = { draft: T; baseline: T; conflict: boolean };

export function reconcileDraft<T>(draft: T, baseline: T, incoming: T): DraftReconciliation<T> {
  if (draft === baseline) return { draft: incoming, baseline: incoming, conflict: false };
  return { draft, baseline: incoming, conflict: incoming !== baseline };
}
