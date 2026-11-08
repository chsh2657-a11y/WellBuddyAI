import { runMigrations } from '@wellbuddy/db';
import { TEST_DATABASE_URL_OWNER } from '@wellbuddy/db/testing';

export default async function setup() {
  await runMigrations(TEST_DATABASE_URL_OWNER);
}
