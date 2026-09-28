import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database, withTenant } from './client.js';
import {
  auditLogs,
  businessPlaces,
  companies,
  companyMembers,
  invitations,
  users,
} from './schema/index.js';
import { TEST_DATABASE_URL, TEST_DATABASE_URL_OWNER, truncateAll } from './testing.js';

/** Drizzle 은 DB 오류를 "Failed query" 로 감싸므로 원래 PostgreSQL 오류(cause)의 메시지를 확인한다. */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, '쿼리가 거부되어야 합니다').toBeInstanceOf(Error);
  const cause = (error as Error).cause;
  expect(cause instanceof Error ? cause.message : String(error)).toMatch(pattern);
}

/**
 * 앱 롤(wellbuddy_app)로 접속해 RLS 가 회사 간 데이터를 격리하는지 확인한다.
 * 준비 데이터는 소유자 롤로 넣는다(소유자는 RLS 대상이 아님).
 */
describe('RLS 테넌트 격리', () => {
  let owner: Database;
  let app: Database;
  const userA = randomUUID();
  const userB = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();

  beforeAll(async () => {
    await truncateAll();
    owner = createDb(TEST_DATABASE_URL_OWNER, { max: 2 });
    app = createDb(TEST_DATABASE_URL, { max: 2 });

    await owner.insert(users).values([
      { id: userA, email: 'a@test.local', passwordHash: 'x', name: 'A' },
      { id: userB, email: 'b@test.local', passwordHash: 'x', name: 'B' },
    ]);
    await owner.insert(companies).values([
      { id: companyA, name: 'A상사', bizRegNo: '0000000000', createdBy: userA },
      { id: companyB, name: 'B상사', bizRegNo: '0000000000', createdBy: userB },
    ]);
    await owner.insert(companyMembers).values([
      { companyId: companyA, userId: userA, role: 'owner' },
      { companyId: companyB, userId: userB, role: 'owner' },
    ]);
    await owner.insert(businessPlaces).values([
      { companyId: companyA, name: 'A 본점', bizRegNo: '0000000000', isHeadquarters: true },
      { companyId: companyB, name: 'B 본점', bizRegNo: '0000000000', isHeadquarters: true },
    ]);
    await owner.insert(auditLogs).values({ companyId: companyA, userId: userA, action: 'seed' });
    await owner.insert(invitations).values({
      companyId: companyB,
      email: 'new@test.local',
      role: 'accountant',
      tokenHash: 'hash-1',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  });

  afterAll(async () => {
    await owner.$client.end();
    await app.$client.end();
  });

  it('A 회사 컨텍스트에서는 A 회사 행만 보인다', async () => {
    const rows = await withTenant(app, { userId: userA, companyId: companyA }, (tx) =>
      tx.select().from(businessPlaces),
    );
    expect(rows.map((r) => r.name)).toEqual(['A 본점']);
  });

  it('다른 회사 company_id 로는 INSERT 할 수 없다', async () => {
    await expectDbError(
      withTenant(app, { userId: userA, companyId: companyA }, (tx) =>
        tx.insert(businessPlaces).values({ companyId: companyB, name: '침투', bizRegNo: '0' }),
      ),
      /row-level security/,
    );
  });

  it('다른 회사 행은 UPDATE 해도 바뀌지 않는다', async () => {
    const updated = await withTenant(app, { userId: userA, companyId: companyA }, (tx) =>
      tx
        .update(businessPlaces)
        .set({ name: '변조' })
        .where(eq(businessPlaces.companyId, companyB))
        .returning(),
    );
    expect(updated).toHaveLength(0);
  });

  it('컨텍스트가 없으면 테넌트 데이터가 보이지 않는다', async () => {
    const rows = await app.select().from(businessPlaces);
    expect(rows).toHaveLength(0);
  });

  it('회사 선택 전에는 내가 소속된 회사만 보인다', async () => {
    const rows = await withTenant(app, { userId: userA }, (tx) =>
      tx.select({ id: companies.id }).from(companies),
    );
    expect(rows.map((r) => r.id)).toEqual([companyA]);
  });

  it('다른 회사의 구성원 목록은 보이지 않는다', async () => {
    const rows = await withTenant(app, { userId: userA, companyId: companyA }, (tx) =>
      tx.select().from(companyMembers),
    );
    expect(rows.every((r) => r.companyId === companyA)).toBe(true);
  });

  it('감사로그는 수정·삭제할 수 없다', async () => {
    await expectDbError(
      withTenant(app, { userId: userA, companyId: companyA }, (tx) =>
        tx.update(auditLogs).set({ action: 'tampered' }),
      ),
      /permission denied/,
    );
    await expectDbError(
      withTenant(app, { userId: userA, companyId: companyA }, (tx) => tx.delete(auditLogs)),
      /permission denied/,
    );
  });

  it('초대 토큰 해시로만 다른 회사의 초대 1건을 조회할 수 있다', async () => {
    const direct = await withTenant(app, { userId: userA, companyId: companyA }, (tx) =>
      tx.select().from(invitations),
    );
    expect(direct).toHaveLength(0);

    const { rows } = await app.execute<{ company_name: string; role: string }>(
      sql`select * from find_invitation_by_token_hash(${'hash-1'})`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ company_name: 'B상사', role: 'accountant' });
  });
});
