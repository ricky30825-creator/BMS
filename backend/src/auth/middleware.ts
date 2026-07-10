import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth, type AuthSession } from "../auth.js";
import { db } from "../db.js";
import { writeAuditLog } from "./audit.js";

export type AppRole = "USER" | "ADMIN";

declare global {
  namespace Express {
    interface Request {
      authSession?: NonNullable<AuthSession>;
      userRole?: AppRole;
    }
  }
}

async function getUserRole(userId: string): Promise<AppRole> {
  const result = await db.query<{ role: AppRole }>(
    "select role from app_user_profile where user_id = $1 and is_active = true",
    [userId]
  );
  return result.rows[0]?.role ?? "USER";
}

async function getSessionFromRequest(req: Request): Promise<AuthSession> {
  return auth.api.getSession({
    headers: fromNodeHeaders(req.headers)
  });
}

export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = await getSessionFromRequest(req);

  if (!session) {
    res.status(401).json({ error: "UNAUTHENTICATED" });
    return;
  }

  req.authSession = session;
  req.userRole = await getUserRole(session.user.id);
  next();
}

export function requireRole(role: AppRole) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const session = await getSessionFromRequest(req);

    if (!session) {
      await writeAuditLog({
        req,
        action: "ADMIN_ACCESS",
        resource: req.originalUrl,
        result: "DENIED",
        reason: "unauthenticated"
      });
      res.status(401).json({ error: "UNAUTHENTICATED" });
      return;
    }

    req.authSession = session;
    req.userRole = await getUserRole(session.user.id);

    if (req.userRole !== role) {
      await writeAuditLog({
        req,
        actorUserId: req.authSession.user.id,
        action: "ADMIN_ACCESS",
        resource: req.originalUrl,
        result: "DENIED",
        reason: `required role ${role}`
      });
      res.status(403).json({ error: "FORBIDDEN" });
      return;
    }

    next();
  };
}
