/**
 * 개발용 데모 데이터: pnpm db:seed
 *   로그인: demo@wellbuddy.local / demo1234!
 * 소유자 롤(DATABASE_URL_OWNER)로 넣으므로 RLS 를 거치지 않는다. 이미 있으면 건너뛴다.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { sql } from 'drizzle-orm';
import { createDb } from './client.js';
import {
  businessPlaces,
  companies,
  companyMembers,
  companySettings,
  users,
} from './schema/index.js';

const DEMO_EMAIL = 'demo@wellbuddy.local';
const DEMO_PASSWORD = 'demo1234!';

const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const url = process.env.DATABASE_URL_OWNER;
if (!url) {
  console.error('DATABASE_URL_OWNER 환경변수가 필요합니다 (.env.example 참고).');
  process.exit(1);
}

const db = createDb(url, { max: 1 });
try {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${DEMO_EMAIL}`);
  if (existing.length > 0) {
    console.log(`• 데모 계정이 이미 있습니다: ${DEMO_EMAIL}`);
  } else {
    await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: DEMO_EMAIL,
          name: '데모 관리자',
          passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        })
        .returning({ id: users.id });
      const [company] = await tx
        .insert(companies)
        .values({
          name: '데모상사',
          bizRegNo: '0000000000',
          representative: '홍길동',
          businessType: '도소매',
          businessItem: '사무용품',
          createdBy: user!.id,
        })
        .returning({ id: companies.id });
      await tx
        .insert(companyMembers)
        .values({ companyId: company!.id, userId: user!.id, role: 'owner' });
      await tx.insert(companySettings).values({ companyId: company!.id });
      await tx.insert(businessPlaces).values({
        companyId: company!.id,
        name: '본점',
        bizRegNo: '0000000000',
        isHeadquarters: true,
      });
    });
    console.log(`✔ 데모 데이터 생성: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  }
} finally {
  await db.$client.end();
}
