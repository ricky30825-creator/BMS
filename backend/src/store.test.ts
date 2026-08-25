import { describe, expect, it } from "vitest";
import { sessionById, startSession } from "./store.js";

describe("sessionById", () => {
  it("returns undefined for an unknown id", () => {
    expect(sessionById("does-not-exist")).toBeUndefined();
  });

  it("returns the session that startSession created", () => {
    const session = startSession("hong", "DEMO-PACK-001");
    const found = sessionById(session.id);
    expect(found).toEqual(session);
  });
});
