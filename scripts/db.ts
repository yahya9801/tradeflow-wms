import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";

// Loads DB password from .env.local and connects to the linked Supabase
// project via the session pooler (IPv4-friendly). Used for programmatic
// schema verification during Phase 1 execution.

const REF = "tepcjahgmggajenimltn";
const REGION = "ap-northeast-1";

function dbPassword(): string {
  const m = readFileSync(".env.local", "utf8").match(/^SUPABASE_DB_PASSWORD=(.*)$/m);
  if (!m) throw new Error("SUPABASE_DB_PASSWORD missing from .env.local");
  return m[1].trim();
}

export function makeClient(): Client {
  return new Client({
    host: `aws-0-${REGION}.pooler.supabase.com`,
    port: 5432,
    user: `postgres.${REF}`,
    password: dbPassword(),
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
}

export async function query(sql: string) {
  const c = makeClient();
  await c.connect();
  try {
    return await c.query(sql);
  } finally {
    await c.end();
  }
}

// CLI mode: `tsx scripts/db.ts "select 1"`
if (process.argv[2]) {
  query(process.argv[2])
    .then((r) => {
      console.log(JSON.stringify(r.rows, null, 2));
    })
    .catch((e) => {
      console.error("DB ERROR:", e.message);
      process.exit(1);
    });
}
