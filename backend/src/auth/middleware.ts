import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { fromNodeHeaders } from "better-auth/node";
import { auth, type AuthSession } from "../auth.js";
import { db } from "../db.js";
import { writeAuditLog } from "./audit.js";
import { env } from "../config/env.js";
import { recordAudit, userById } from "../store.js";

export type AppRole = "USER" | "ADMIN";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  status: "ACTIVE" | "SUSPENDED";
};

const demoTokens = new Map<string, string>();
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
  demoTokens.set(token, user.id);
  return token;
}

export async function demoUserForToken(token: string | null | undefined): Promise<AppUser | null> {
  if (env.AUTH_MODE !== "demo" || !token) return null;
  const userId = demoTokens.get(token);
  const user = userId ? await userById(userId) : undefined;
  return user ? { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status } : null;
}

export function revokeDemoToken(token: string | null | undefined): void {
  if (token) demoTokens.delete(token);
}

export function demoPasswordMatches(userId: string, password: string): boolean {
  return env.AUTH_MODE === "demo" && (demoPasswords.get(userId) ?? DEMO_PASSWORD) === password;
}

export function setDemoPassword(userId: string, password: string): void {
  demoPasswords.set(userId, password);
}

async function demoUserFromRequest(req: Request): Promise<AppUser | null> {
  if (env.AUTH_MODE !== "demo") return null;
  const token = req.get("authorization")?.match(/^Demo\s+(.+)$/i)?.[1];
  return demoUserForToken(token);
}

async function getSessionFromRequest(req: Request): Promise<AuthSession> {
  return auth.api.getSession({
    headers: fromNodeHeaders(req.headers)
  });
}

export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const demoUser = await demoUserFromRequest(req);
  if (demoUser) {
    if (demoUser.status === "SUSPENDED") {
      await recordAudit({ actorId: demoUser.id, action: "SUSPENDED_ACCESS_DENIED", resource: req.originalUrl, result: "DENIED", reason: "account suspended" });
      res.status(403).json({ error: { code: "ACCOUNT_SUSPENDED", message: "The account is suspended." } });
      return;
    }
    req.appUser = demoUser;
    req.userRole = demoUser.role;
    next();
    return;
  }
  if (env.AUTH_MODE === "demo" && /^Demo\s+/i.test(req.get("authorization") ?? "")) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "The demo token is invalid." } });
    return;
  }
  const session = await getSessionFromRequest(req);

  if (!session) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
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
    const demoUser = await demoUserFromRequest(req);
    if (demoUser) {
      if (demoUser.status === "SUSPENDED") {
        await recordAudit({ actorId: demoUser.id, action: "SUSPENDED_ACCESS_DENIED", resource: req.originalUrl, result: "DENIED", reason: "account suspended" });
        res.status(403).json({ error: { code: "ACCOUNT_SUSPENDED", message: "The account is suspended." } });
        return;
      }
      req.appUser = demoUser;
      req.userRole = demoUser.role;
      if (demoUser.role !== role) {
        await recordAudit({ actorId: demoUser.id, action: "ADMIN_ACCESS_DENIED", resource: req.originalUrl, result: "DENIED", reason: `required role ${role}` });
        res.status(403).json({ error: { code: "FORBIDDEN", message: "Required role is not present." } });
        return;
      }
      next();
      return;
    }
    if (env.AUTH_MODE === "demo" && /^Demo\s+/i.test(req.get("authorization") ?? "")) {
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
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
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
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Required role is not present." } });
      return;
    }

    next();
  };
}
