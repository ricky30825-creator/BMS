export type Grade = "NORMAL" | "CAUTION" | "WARNING" | "DANGER";

export function gradeForScore(score: number | null): Grade | null {
  if (score === null) return null;
  if (score < 0.3) return "NORMAL";
  if (score < 0.6) return "CAUTION";
  if (score < 0.8) return "WARNING";
  return "DANGER";
}

export type GradeTransition = { from: Grade; to: Grade };

export function detectGradeTransition(previous: Grade | null, next: Grade | null): GradeTransition | null {
  if (next === null || previous === null || previous === next) return null;
  return { from: previous, to: next };
}
