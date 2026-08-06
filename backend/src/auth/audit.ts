import type { Request } from "express";
import pg from "pg";
import { db } from "../db.js";

export type AuditResult = "SUCCESS" | "DENIED" | "FAILED";

export async function writeAuditLog(params: {
  req: Request;
  actorUserId?: string | null;
  action: string;
  resource: string;
  result: AuditResult;
  reason?: string;
  executor?: pg.Pool | pg.PoolClient;
}): Promise<void> {
  await (params.executor ?? db).query(
    `insert into audit_log
      (actor_user_id, action, resource, result, reason, ip_address, user_agent)
     values ($1, $2, $3, $4, $5, nullif($6, '')::inet, $7)`,
    [
      params.actorUserId ?? null,
      params.action,
      params.resource,
      params.result,
      params.reason ?? null,
      params.req.ip ?? "",
      params.req.get("user-agent") ?? null
    ]
  );
}
