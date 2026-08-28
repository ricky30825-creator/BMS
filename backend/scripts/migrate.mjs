// 마이그레이션 실행기. `npm run db:migrate`로 돌린다.
//
// psql에 의존하지 않는다 — 호스트 PC는 Windows이고 개발 장비는 macOS라, 이미
// 의존성에 있는 pg로 도는 편이 양쪽에서 똑같이 동작한다.
//
// 규칙:
//   · migrations/*.sql을 파일명 순서대로 적용한다(000 → 001 → …).
//   · 적용한 파일은 schema_migrations에 기록하고 다시 실행하지 않는다.
//   · 파일 하나가 트랜잭션 하나다 — 중간에 실패하면 그 파일은 통째로 롤백된다.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import pg from "pg";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL이 없다. backend/.env를 먼저 채운다 (.env.example 참고).");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

async function main() {
  await pool.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await pool.query("select filename from schema_migrations")).rows.map((row) => row.filename)
  );

  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip  ${file}`);
      continue;
    }
    const sql = await readFile(join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (filename) values ($1)", [file]);
      await client.query("commit");
      console.log(`  apply ${file}`);
      count += 1;
    } catch (error) {
      await client.query("rollback");
      console.error(`\n${file} 적용 실패 — 이 파일은 롤백됐다.`);
      console.error(`  ${error.message}`);
      if (/timescaledb/i.test(error.message)) {
        console.error("  → TimescaleDB 확장이 설치돼 있는지 확인한다. 005만 실패한 것이면");
        console.error("    004까지는 유효하고, telemetry_metric은 평범한 테이블로 동작한다.");
      }
      process.exitCode = 1;
      return;
    } finally {
      client.release();
    }
  }
  console.log(count === 0 ? "\n변경 없음 — 이미 최신이다." : `\n${count}개 적용 완료.`);
}

main().finally(() => pool.end());
