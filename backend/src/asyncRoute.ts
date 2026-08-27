import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4는 async 핸들러가 reject하면 에러 미들웨어로 넘기지 않고 프로세스로
// 흘려보낸다(unhandled rejection). 모든 async 라우트는 이 래퍼를 거쳐야 한다.
export function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };
}
