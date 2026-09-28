import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL 이 필요합니다'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET 은 32자 이상이어야 합니다'),
  FIELD_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
    message: 'FIELD_ENCRYPTION_KEY 는 32바이트 키의 base64 문자열이어야 합니다',
  }),
  FIELD_ENCRYPTION_KEY_ID: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .default('k1'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('ap-northeast-2'),
  S3_BUCKET: z.string().default('wellbuddy'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('WellBuddy <no-reply@wellbuddy.local>'),
});

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  fieldEncryption: { key: Buffer; keyId: string };
  webOrigin: string;
  storage: {
    driver: Env['STORAGE_DRIVER'];
    localDir: string;
    s3: {
      endpoint?: string;
      region: string;
      bucket: string;
      accessKey?: string;
      secretKey?: string;
    };
  };
  mail: { host?: string; port: number; user?: string; pass?: string; from: string };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** 저장소 루트의 .env 를 (있으면) 읽고, 환경변수를 검증해 설정 객체로 바꾼다. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const envFile = path.join(repoRoot, '.env');
  if (source === process.env && process.env.NODE_ENV !== 'test' && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`환경변수 설정이 올바르지 않습니다:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    port: e.API_PORT,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    jwtSecret: e.JWT_SECRET,
    fieldEncryption: {
      key: Buffer.from(e.FIELD_ENCRYPTION_KEY, 'base64'),
      keyId: e.FIELD_ENCRYPTION_KEY_ID,
    },
    webOrigin: e.WEB_ORIGIN,
    storage: {
      driver: e.STORAGE_DRIVER,
      localDir: path.resolve(repoRoot, e.STORAGE_LOCAL_DIR),
      s3: {
        endpoint: e.S3_ENDPOINT,
        region: e.S3_REGION,
        bucket: e.S3_BUCKET,
        accessKey: e.S3_ACCESS_KEY,
        secretKey: e.S3_SECRET_KEY,
      },
    },
    mail: {
      host: e.SMTP_HOST || undefined,
      port: e.SMTP_PORT,
      user: e.SMTP_USER || undefined,
      pass: e.SMTP_PASS || undefined,
      from: e.MAIL_FROM,
    },
  };
}
