/**
 * 서버를 띄우지 않고 OpenAPI 문서를 파일로 내보낸다: pnpm --filter @wellbuddy/api openapi <출력 경로>
 * DB·Redis 는 실제로 접속하지 않으므로 더미 설정으로 충분하다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildOpenApiDocument, createApp } from './app.factory.js';
import { loadConfig } from './config/env.js';

const out = path.resolve(process.argv[2] ?? 'openapi.json');
const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unused@localhost/unused',
  JWT_SECRET: 'openapi-export-openapi-export-openapi-export',
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
});

const app = await createApp({ config, logger: false });
await app.init();
const document = buildOpenApiDocument(app);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
await app.close();
console.log(`✔ OpenAPI 문서 저장: ${out}`);
