import type { NestExpressApplication } from '@nestjs/platform-express';
import { TEST_DATABASE_URL } from '@wellbuddy/db/testing';
import { createApp } from '../src/app.factory.js';
import { type AppConfig, loadConfig } from '../src/config/env.js';

export function testConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    FIELD_ENCRYPTION_KEY_ID: 'test',
    ...overrides,
  });
}

/** 실제 DB·Redis(테스트용)에 붙는 API 앱을 띄운다. */
export async function createTestApp(config = testConfig()): Promise<NestExpressApplication> {
  const app = await createApp({ config, logger: false });
  await app.init();
  return app;
}
