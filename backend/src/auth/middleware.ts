import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { fromNodeHeaders } from "better-auth/node";
import { auth, type AuthSession } from "../auth.js";
import { db } from "../db.js";
import { writeAuditLog } from "./audit.js";
import { env } from "../config/env.js";

export type AppRole = "USER" | "ADMIN";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  status: "ACTIVE" | "SUSPENDED";
};

const demoTokens = new Map<string, AppUser>();
const DEMO_PASSWORD = "demo-password";
const demoPasswords = new Map<string, string>();

declare global {
  namespace Express {
    interface Request {
      authSession?: NonNullable<AuthSession>;
      userRole?: AppRole;
      appUser?: AppUser;
    }
  }
}

async function getUserProfile(userId: string): Promise<{ role: AppRole; status: AppUser["status"] } | null> {
  const result = await db.query<{ role: AppRole; status: AppUser["status"] }>(
    "select role, status from app_user_profile where user_id = $1 and is_active = true",
    [userId]
  );
  return result.rows[0] ?? null;
}

export function issueDemoToken(user: AppUser): string {
  const token = `demo_${randomUUID()}`;
  demoTokens.set(token, { ...user });
  return token;
}

export function demoUserForToken(token: string | null | undefined): AppUser | null {
  if (!env.DEMO_MODE || !token) return null;
  const issued = demoTokens.get(token);
  if (issued) return { ...issued };
  return null;
}

export function revokeDemoToken(token: string | null | undefined): void {
  if (token) demoTokens.delete(token);
}

export function demoPasswordMatches(userId: string, password: string): boolean {
  return env.DEMO_MODE && (demoPasswords.get(userId) ?? DEMO_PASSWORD) === password;
}

export function setDemoPassword(userId: string, password: string): void {
  demoPasswords.set(userId, password);
}

function demoUserFromRequest(req: Request): AppUser | null {
  if (!env.DEMO_MODE) return null;
  const token = req.get("authorization")?.match(/^Demo\s+(.+)$/i)?.[1];
  return demoUserForToken(token);
}

async function getSessionFromRequest(req: Request): Promise<AuthSession> {
  return auth.api.getSession({
    headers: fromNodeHeaders(req.headers)
  });
}

export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const demoUser = demoUserFromRequest(req);
  if (demoUser) {
    req.appUser = demoUser;
    req.userRole = demoUser.role;
    next();
    return;
  }
  if (env.DEMO_MODE && /^Demo\s+/i.test(req.get("authorization") ?? "")) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "The demo token is invalid." } });
    return;
  }
  const session = await getSessionFromRequest(req);

  if (!session) {
    res.status(401).json({ error: "UNAUTHENTICATED" });
    return;
  }

  req.authSession = session;
  const profile = await getUserProfile(session.user.id);
  if (profile?.status === "SUSPENDED") {
    await writeAuditLog({ req, actorUserId: session.user.id, action: "SUSPENDED_ACCESS_DENIED", resource: req.originalUrl, result: "DENIED", reason: "account suspended" });
    res.status(403).json({ error: { code: "ACCOUNT_SUSPENDED", message: "The account is suspended." } });
    return;
  }
  req.userRole = profile?.role ?? "USER";
  req.appUser = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: req.userRole,
    status: profile?.status ?? "ACTIVE"
  };
  next();
}

export function requireRole(role: AppRole) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const demoUser = demoUserFromRequest(req);
    if (demoUser) {
      req.appUser = demoUser;
      req.userRole = demoUser.role;
      if (demoUser.role !== role) {
        await writeAuditLog({
          req,
          actorUserId: demoUser.id,
          action: "ADMIN_ACCESS_DENIED",
          resource: req.originalUrl,
          result: "DENIED",
          reason: `required role ${role}`
        });
        res.status(403).json({ error: { code: "FORBIDDEN", message: "Required role is not present." } });
        return;
      }
      next();
      return;
    }
    if (env.DEMO_MODE && /^Demo\s+/i.test(req.get("authorization") ?? "")) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "The demo token is invalid." } });
      return;
    }
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
    const profile = await getUserProfile(session.user.id);
    if (profile?.status === "SUSPENDED") {
      await writeAuditLog({ req, actorUserId: session.user.id, action: "SUSPENDED_ACCESS_DENIED", resource: req.originalUrl, result: "DENIED", reason: "account suspended" });
      res.status(403).json({ error: { code: "ACCOUNT_SUSPENDED", message: "The account is suspended." } });
      return;
    }
    req.userRole = profile?.role ?? "USER";
    req.appUser = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: req.userRole,
      status: profile?.status ?? "ACTIVE"
    };

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
