import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrate.js';

const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const url = process.env.DATABASE_URL_OWNER;
if (!url) {
  console.error('DATABASE_URL_OWNER 환경변수가 필요합니다 (.env.example 참고).');
  process.exit(1);
}

await runMigrations(url);
console.log(`✔ migrations applied (${new URL(url).pathname.slice(1)})`);
