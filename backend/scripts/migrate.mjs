// 마이그레이션 실행기. `npm run db:migrate`로 돌린다.
//
// psql에 의존하지 않는다 — 호스트 PC는 Windows이고 개발 장비는 macOS라, 이미
// 의존성에 있는 pg로 도는 편이 양쪽에서 똑같이 동작한다.
//
// 규칙:
//   · migrations/*.sql을 3자리 번호의 연속된 파일명 순서대로 적용한다(000 → 001 → …).
//   · 적용한 파일은 schema_migrations에 기록하고 다시 실행하지 않는다.
//   · 파일 하나가 트랜잭션 하나다 — 중간에 실패하면 그 파일은 통째로 롤백된다.
//   · TimescaleDB 확장 가용성과 두 하이퍼테이블을 확인한다. plain PostgreSQL로
//     조용히 강등하는 경로는 없다.
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

const MIGRATION_LOCK_KEY = 839203108;

function migrationNumber(file) {
  const match = /^(\d{3})_.+\.sql$/.exec(file);
  if (!match) throw new Error(`마이그레이션 파일명이 3자리 번호 규칙과 맞지 않는다: ${file}`);
  return Number(match[1]);
}

function assertContiguousMigrations(files) {
  const numbers = files.map(migrationNumber);
  numbers.forEach((number, index) => {
    if (number !== index) {
      throw new Error(`마이그레이션 번호가 연속적이지 않다: expected ${String(index).padStart(3, "0")}, got ${String(number).padStart(3, "0")}`);
    }
  });
}

async function assertTimescaleAvailable(client) {
  const result = await client.query(`
    select default_version, installed_version
    from pg_available_extensions
    where name = 'timescaledb'
  `);
  const extension = result.rows[0];
  if (!extension?.default_version) {
    throw new Error("TIMESCALEDB_REQUIRED: the connected PostgreSQL server does not provide the TimescaleDB extension");
  }
  console.log(`  check TimescaleDB extension available (default ${extension.default_version}${extension.installed_version ? `, installed ${extension.installed_version}` : ""})`);
}

async function assertTimescaleSchema(client) {
  const extension = await client.query(`
    select extversion
    from pg_extension
    where extname = 'timescaledb'
  `);
  if (!extension.rows[0]?.extversion) {
    throw new Error("TIMESCALEDB_REQUIRED: the TimescaleDB extension is not installed after migrations");
  }

  const hypertables = await client.query(`
    select hypertable_name
    from timescaledb_information.hypertables
    where hypertable_schema = 'public'
      and hypertable_name = any($1::text[])
  `, [["telemetry_metric", "anomaly_score"]]);
  const names = new Set(hypertables.rows.map((row) => row.hypertable_name));
  if (!names.has("telemetry_metric") || !names.has("anomaly_score")) {
    throw new Error("TIMESCALEDB_REQUIRED: telemetry_metric and anomaly_score must both be TimescaleDB hypertables");
  }
  console.log(`  check TimescaleDB hypertables (${[...names].sort().join(", ")})`);
}

async function main() {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    locked = true;
    await assertTimescaleAvailable(client);
    await client.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
    `);

    const applied = new Set(
      (await client.query("select filename from schema_migrations")).rows.map((row) => row.filename)
    );

    const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
    assertContiguousMigrations(files);

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip  ${file}`);
        continue;
      }
      const sql = await readFile(join(migrationsDir, file), "utf8");
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
        console.log(`  apply ${file}`);
        count += 1;
      } catch (error) {
        await client.query("rollback");
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${file} 적용 실패 — 이 파일은 롤백됐다.\n  ${detail}`, { cause: error });
      }
    }
    await assertTimescaleSchema(client);
    console.log(count === 0 ? "\n변경 없음 — 이미 최신이다." : `\n${count}개 적용 완료.`);
  } finally {
    if (locked) {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
    }
    client.release();
  }
}

main()
  .catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`\n마이그레이션 중단: ${detail}`);
    if (/TIMESCALEDB_REQUIRED|timescaledb/i.test(detail)) {
      console.error("  → TimescaleDB 이미지/확장을 제공하는 PostgreSQL에 DATABASE_URL을 연결한 뒤 다시 실행한다.");
      console.error("  → plain PostgreSQL로 대체하거나 일부 migration만 성공으로 표시하지 않는다.");
    }
    process.exitCode = 1;
  })
  .finally(() => pool.end());
