import type { NestExpressApplication } from '@nestjs/platform-express';
import { bankAccounts, bankTransactions, createDb, type Database } from '@wellbuddy/db';
import { TEST_DATABASE_URL_OWNER, truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

describe('증빙: 은행 계좌·법인카드 등록', () => {
  let app: NestExpressApplication;
  let db: Database;
  let owner: Agent;
  let other: Agent;
  let otherCompanyId: string;
  let employee: Agent;
  const acc: Record<string, string> = {};

  beforeAll(async () => {
    await truncateAll();
    db = createDb(TEST_DATABASE_URL_OWNER, { max: 1 });
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@src.local', '수집상사'));
    ({ agent: other, companyId: otherCompanyId } = await ownerWithCompany(
      app,
      'other@src.local',
      '다른회사',
    ));
    employee = await inviteAndJoin(app, owner, 'emp@src.local', 'employee');
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end();
  });

  const bank = (patch: object = {}) => ({
    bankCode: '0004',
    alias: '운영자금',
    accountNo: '123-456-78-901234',
    ledgerAccountId: acc['103'],
    ...patch,
  });
  const card = (patch: object = {}) => ({
    cardCompany: '0306',
    alias: '대표 법인카드',
    cardNo: '4518-1234-5678-9012',
    holderName: '김대표',
    ledgerAccountId: acc['253'],
    ...patch,
  });

  it('은행 계좌: 번호는 암호화하고 끝 4자리만, 장부 계정은 자산 계정만', async () => {
    const created = (await owner.post('/api/bank-accounts').send(bank()).expect(201)).body;
    expect(created).toMatchObject({
      bankName: 'KB국민은행',
      accountNoMasked: '****1234',
      ledgerAccount: '103 보통예금',
      isActive: true,
    });
    expect(JSON.stringify(created)).not.toContain('78901234');
    const [row] = await db.select().from(bankAccounts);
    expect(row!.accountNoEnc).toMatch(/^v1:/);
    expect(row!.accountNoEnc).not.toContain('12345678901234');

    const dup = await owner
      .post('/api/bank-accounts')
      .send(bank({ accountNo: '12345678901234', alias: '같은 계좌' }))
      .expect(409);
    expect(dup.body.code).toBe('DUPLICATE_BANK_ACCOUNT');
    const liability = await owner
      .post('/api/bank-accounts')
      .send(bank({ accountNo: '11122233344', ledgerAccountId: acc['253'] }))
      .expect(400);
    expect(liability.body.code).toBe('LEDGER_ACCOUNT_INVALID');
    await owner
      .post('/api/bank-accounts')
      .send(bank({ accountNo: '12ab' }))
      .expect(400);
    await employee.get('/api/bank-accounts').expect(403);

    const updated = (
      await owner
        .patch(`/api/bank-accounts/${created.id}`)
        .send({ alias: '급여 계좌', isActive: false })
        .expect(200)
    ).body;
    expect(updated).toMatchObject({ alias: '급여 계좌', isActive: false });

    // 다른 회사: 목록이 보이지 않고, 다른 회사 계정으로는 등록할 수 없다
    expect((await other.get('/api/bank-accounts').expect(200)).body).toEqual([]);
    const foreign = await other.post('/api/bank-accounts').send(bank()).expect(400);
    expect(foreign.body.code).toBe('ACCOUNT_NOT_FOUND');
    await other.delete(`/api/bank-accounts/${created.id}`).expect(404);
  });

  it('DB 트리거: 다른 회사의 계좌를 가리키는 거래는 직접 넣어도 막힌다', async () => {
    const [account] = await db.select().from(bankAccounts);
    const error = await db
      .insert(bankTransactions)
      .values({
        companyId: otherCompanyId,
        bankAccountId: account!.id,
        txDate: '2026-03-10',
        description: '침입',
        deposit: 1,
        source: 'manual',
        dedupeHash: 'x',
      })
      .catch((e: unknown) => e);
    expect(String((error as { cause?: unknown }).cause)).toMatch(/REFERENCE_NOT_FOUND/);
  });

  it('법인카드: 카드대금 계정은 부채 계정만, 같은 카드 중복 등록 불가', async () => {
    const created = (await owner.post('/api/corporate-cards').send(card()).expect(201)).body;
    expect(created).toMatchObject({
      cardCompanyName: '신한카드',
      cardNoMasked: '****9012',
      ledgerAccount: '253 미지급금',
      holderName: '김대표',
    });
    await owner
      .post('/api/corporate-cards')
      .send(card({ alias: '중복' }))
      .expect(409);
    const asset = await owner
      .post('/api/corporate-cards')
      .send(card({ cardNo: '1111222233334444', ledgerAccountId: acc['103'] }))
      .expect(400);
    expect(asset.body.code).toBe('LEDGER_ACCOUNT_INVALID');
    expect((await owner.get('/api/corporate-cards').expect(200)).body).toHaveLength(1);
    await owner.delete(`/api/corporate-cards/${created.id}`).expect(204);
    expect((await owner.get('/api/corporate-cards').expect(200)).body).toEqual([]);
  });
});
