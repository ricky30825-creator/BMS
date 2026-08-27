import { describe, expect, it } from "vitest";
import { sessionById, startSession } from "./store.js";

describe("sessionById", () => {
  it("returns undefined for an unknown id", async () => {
    expect(await sessionById("does-not-exist")).toBeUndefined();
  });

  it("returns the session that startSession created", async () => {
    const session = await startSession("hong", "DEMO-PACK-001");
    const found = await sessionById(session.id);
    expect(found).toEqual(session);
  });
});
