import { Pool, type QueryResultRow } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const databaseUrl = process.env.DATABASE_URL
    ?? 'postgresql://novae:novae@localhost:5432/novae';
  const pool = new Pool({ connectionString: databaseUrl });
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Migrations applied.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
