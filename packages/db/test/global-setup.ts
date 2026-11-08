import { runMigrations } from '../src/migrate.js';
import { TEST_DATABASE_URL_OWNER } from '../src/testing.js';

export default async function setup() {
  await runMigrations(TEST_DATABASE_URL_OWNER);
}
