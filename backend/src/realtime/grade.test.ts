import { describe, expect, it } from "vitest";
import { detectGradeTransition, gradeForScore } from "./grade.js";

describe("gradeForScore", () => {
  it("returns null for a null score", () => {
    expect(gradeForScore(null)).toBeNull();
  });

  it("classifies the four fixed 0.3/0.6/0.8 bands", () => {
    expect(gradeForScore(0)).toBe("NORMAL");
    expect(gradeForScore(0.29)).toBe("NORMAL");
    expect(gradeForScore(0.3)).toBe("CAUTION");
    expect(gradeForScore(0.59)).toBe("CAUTION");
    expect(gradeForScore(0.6)).toBe("WARNING");
    expect(gradeForScore(0.79)).toBe("WARNING");
    expect(gradeForScore(0.8)).toBe("DANGER");
    expect(gradeForScore(1)).toBe("DANGER");
  });
});

describe("detectGradeTransition", () => {
  it("returns null when there is no prior observation (baseline seed, not a transition)", () => {
    expect(detectGradeTransition(null, "NORMAL")).toBeNull();
  });

  it("returns null when the grade is unchanged", () => {
    expect(detectGradeTransition("CAUTION", "CAUTION")).toBeNull();
  });

  it("returns null when the next grade is null", () => {
    expect(detectGradeTransition("CAUTION", null)).toBeNull();
  });

  it("returns the from/to pair on a real transition", () => {
    expect(detectGradeTransition("CAUTION", "WARNING")).toEqual({ from: "CAUTION", to: "WARNING" });
  });
});
