import cors from "cors";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import { corsOrigins, env } from "./config/env.js";
import { requireRole, requireSession } from "./auth/middleware.js";
import { writeAuditLog } from "./auth/audit.js";

const app = express();

app.use(
  cors({
    origin: corsOrigins,
    credentials: true
  })
);

app.all("/api/auth/*", toNodeHandler(auth));

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/me", requireSession, (req, res) => {
  res.json({
    user: req.authSession?.user,
    role: req.userRole
  });
});

app.get("/api/admin/health", requireRole("ADMIN"), async (req, res) => {
  await writeAuditLog({
    req,
    actorUserId: req.authSession?.user.id,
    action: "ADMIN_ACCESS",
    resource: "/api/admin/health",
    result: "SUCCESS"
  });
  res.json({ status: "ok", scope: "admin" });
});

app.post("/api/relay/kill-switch/confirm", requireSession, async (req, res) => {
  await writeAuditLog({
    req,
    actorUserId: req.authSession?.user.id,
    action: "KILL_SWITCH_CONFIRM",
    resource: "relay",
    result: "SUCCESS",
    reason: typeof req.body?.reason === "string" ? req.body.reason : undefined
  });
  res.status(202).json({ status: "accepted" });
});

app.listen(env.PORT, () => {
  console.log(`CellGuard backend listening on ${env.PORT}`);
});
