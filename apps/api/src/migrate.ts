import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const sqlDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql');

export async function migrate() {
  await db.pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.many<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  for (const file of readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(sqlDir, file), 'utf8');
    await db.tx(async (c) => {
      await c.query(sql);
      await c.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    console.log(`migrated ${file}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => db.pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
