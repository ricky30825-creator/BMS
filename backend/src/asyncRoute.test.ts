import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { asyncRoute } from "./asyncRoute.js";

describe("asyncRoute", () => {
  it("rejection을 next()로 넘겨 에러 미들웨어가 받게 한다", async () => {
    const boom = new Error("NOT_FOUND");
    const next = vi.fn() as unknown as NextFunction;
    asyncRoute(async () => { throw boom; })({} as Request, {} as Response, next);
    await new Promise((resolve) => setImmediate(resolve));
    expect(next).toHaveBeenCalledWith(boom);
  });

  it("정상 완료하면 next()를 부르지 않는다", async () => {
    const next = vi.fn() as unknown as NextFunction;
    const handler = vi.fn().mockResolvedValue(undefined);
    asyncRoute(handler)({} as Request, {} as Response, next);
    await new Promise((resolve) => setImmediate(resolve));
    expect(handler).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });
});
