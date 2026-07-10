import pg from "pg";
import { env } from "./config/env.js";

export const db = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

export async function closeDb(): Promise<void> {
  await db.end();
}
