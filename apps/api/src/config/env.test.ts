import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x@localhost/x',
  JWT_SECRET: 'x'.repeat(32),
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
};

describe('loadConfig', () => {
  it('기본값을 채운다', () => {
    const config = loadConfig(base);
    expect(config.port).toBe(4000);
    expect(config.storage.driver).toBe('local');
    expect(config.fieldEncryption.key).toHaveLength(32);
  });

  it('잘못된 값은 어떤 변수가 문제인지 알려준다', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...base, FIELD_ENCRYPTION_KEY: 'abc' })).toThrow(
      /FIELD_ENCRYPTION_KEY/,
    );
  });
});
