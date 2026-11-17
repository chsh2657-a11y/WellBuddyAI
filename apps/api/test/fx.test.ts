import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

interface EntryLine {
  accountCode: string;
  debit: number;
  credit: number;
  currency: string | null;
  foreignAmount: string | null;
  exchangeRate: string | null;
}
interface PreviewRow {
  accountCode: string;
  currency: string;
  foreignBalance: string;
  bookKrw: number;
  rate: string | null;
  targetKrw: number | null;
  adjustment: number | null;
  profit: number | null;
}

/**
 * 2026 회계연도(1월 시작)
 *  기초: 현금 500만, 외화예금(보통예금) USD 1,000 = 130만(장부), 자본금
 *  3/10 Global 에 수출 USD 2,000 @1,350 (외상매출금 / 매출)
 *  3/20 Tokyo 에서 상품 외상 매입 JPY 100,000 @910.50(100엔당)
 *  3/31 평가: USD 1,400 · JPY 900 → 예금 +10만, 외상매출금 +10만, 외상매입금 −10,500 (이익 210,500)
 *  4/15 Global 외상대금 USD 2,000 @1,420 입금 → 외환차익 4만
 *  6/30 평가: USD 1,300 → 예금 USD 3,000 장부 4,240,000 → 3,900,000 (손실 34만)
 */
describe('외화·환율·외화평가', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let employee: Agent;
  const acc: Record<string, string> = {};
  let fy2026: string;
  let globalInc: string;
  let tokyo: string;

  const rate = (currency: string, rateDate: string, value: string | number) =>
    owner.put('/api/exchange-rates').send({ currency, rateDate, rate: value });
  const post = async (entryDate: string, lines: object[], expected = 201) =>
    owner
      .post('/api/journals')
      .send({ entry: { entryDate, lines }, status: 'posted' })
      .expect(expected);
  const ledgerClosing = async (code: string, to = '2026-12-31') =>
    (
      await owner
        .get('/api/reports/account-ledger')
        .query({ accountId: acc[code], from: `${to.slice(0, 4)}-01-01`, to })
        .expect(200)
    ).body.closing as number;
  const preview = async (date: string) =>
    (await owner.get('/api/fx-revaluations/preview').query({ date }).expect(200)).body as {
      rows: PreviewRow[];
      gain: number;
      loss: number;
      missingCurrencies: string[];
    };
  const entryLines = async (id: string) =>
    ((await owner.get(`/api/journals/${id}`).expect(200)).body.lines as EntryLine[])
      .map((l) => [l.accountCode, l.debit, l.credit, l.currency, l.foreignAmount])
      .sort();

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@fx.local', '외화상사'));
    employee = await inviteAndJoin(app, owner, 'emp@fx.local', 'employee');
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    globalInc = (await owner.post('/api/partners').send({ name: 'Global Inc' }).expect(201)).body
      .id;
    tokyo = (await owner.post('/api/partners').send({ name: 'Tokyo Co' }).expect(201)).body.id;
    fy2026 = (await owner.post('/api/fiscal-years').send({ date: '2026-01-01' }).expect(201)).body
      .id;
    const opening = await owner
      .put(`/api/fiscal-years/${fy2026}/opening-balances`)
      .send({
        lines: [
          { accountId: acc['101'], debit: 5_000_000 },
          {
            accountId: acc['103'],
            debit: 1_300_000,
            currency: 'USD',
            foreignAmount: '1,000',
          },
          { accountId: acc['331'], credit: 6_300_000 },
        ],
      })
      .expect(200);
    expect(opening.body.lines[1]).toMatchObject({ currency: 'USD', foreignAmount: '1000.00' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('환율: 같은 통화·날짜는 덮어쓰고, 날짜로 가장 가까운 이전 환율을 찾는다', async () => {
    expect((await rate('USD', '2026-03-02', '1,349.5').expect(200)).body).toMatchObject({
      currency: 'USD',
      rate: '1349.5000',
      unit: 1,
    });
    expect((await rate('USD', '2026-03-02', 1350).expect(200)).body.rate).toBe('1350.0000');
    expect((await rate('JPY', '2026-03-02', '910.5').expect(200)).body.unit).toBe(100);
    await rate('KRW', '2026-03-02', 1).expect(400);
    await rate('USD', '2026-03-02', 0).expect(400);
    await employee
      .put('/api/exchange-rates')
      .send({ currency: 'USD', rateDate: '2026-03-02', rate: 1 })
      .expect(403);

    const found = await owner
      .get('/api/exchange-rates/lookup')
      .query({ currency: 'USD', date: '2026-03-10' })
      .expect(200);
    expect(found.body.exchangeRate).toMatchObject({ rateDate: '2026-03-02', rate: '1350.0000' });
    const none = await owner
      .get('/api/exchange-rates/lookup')
      .query({ currency: 'USD', date: '2026-03-01' })
      .expect(200);
    expect(none.body).toEqual({ exchangeRate: null });
    const list = (await owner.get('/api/exchange-rates').expect(200)).body;
    expect(list).toHaveLength(2);
  });

  it('환율 엑셀(CSV) 일괄 등록', async () => {
    const csv = ['통화,일자,환율', 'USD,2026-03-31,1400', 'JPY,2026-03-31,900', 'XYZ,2026-03-31,1'];
    const rejected = await owner
      .post('/api/imports/exchange-rates/commit')
      .attach('file', Buffer.from(csv.join('\n')), '환율.csv')
      .expect(400);
    expect(rejected.body.code).toBe('IMPORT_INVALID');
    const res = await owner
      .post('/api/imports/exchange-rates/commit')
      .attach('file', Buffer.from(csv.slice(0, 3).join('\n')), '환율.csv')
      .expect(200);
    expect(res.body).toMatchObject({ created: 2, updated: 0 });
  });

  it('외화 전표: 원화 금액 = 외화 × 환율(원 미만 반올림)이어야 한다', async () => {
    const mismatch = await post(
      '2026-03-10',
      [
        {
          accountId: acc['108'],
          partnerId: globalInc,
          debit: 2_700_001,
          currency: 'USD',
          foreignAmount: '2000',
          exchangeRate: '1350',
        },
        { accountId: acc['401'], credit: 2_700_001 },
      ],
      400,
    );
    expect(mismatch.body.code).toBe('FX_AMOUNT_MISMATCH');
    // 통화만 있고 환율이 없으면 입력 오류
    await post(
      '2026-03-10',
      [
        {
          accountId: acc['108'],
          partnerId: globalInc,
          debit: 1,
          currency: 'USD',
          foreignAmount: 1,
        },
        { accountId: acc['401'], credit: 1 },
      ],
      400,
    );

    const sale = await post('2026-03-10', [
      {
        accountId: acc['108'],
        partnerId: globalInc,
        debit: 2_700_000,
        currency: 'USD',
        foreignAmount: '2,000.00',
        exchangeRate: '1350',
      },
      // 손익 계정에 통화를 붙여도 외화평가 대상이 아니다
      {
        accountId: acc['401'],
        credit: 2_700_000,
        currency: 'USD',
        foreignAmount: '2000',
        exchangeRate: '1350',
      },
    ]);
    expect(await entryLines(sale.body.id)).toEqual([
      ['108', 2_700_000, 0, 'USD', '2000.00'],
      ['401', 0, 2_700_000, 'USD', '2000.00'],
    ]);
    await post('2026-03-20', [
      { accountId: acc['146'], debit: 910_500 },
      {
        accountId: acc['251'],
        partnerId: tokyo,
        credit: 910_500,
        currency: 'JPY',
        foreignAmount: '100000',
        exchangeRate: '910.5',
      },
    ]);
  });

  it('기말 외화평가: 외화 자산·부채를 평가일 환율로 다시 환산해 차액을 전기한다', async () => {
    const plan = await preview('2026-03-31');
    expect(
      plan.rows.map((r) => [r.accountCode, r.currency, r.foreignBalance, r.bookKrw, r.adjustment]),
    ).toEqual([
      ['103', 'USD', '1000.00', 1_300_000, 100_000],
      ['108', 'USD', '2000.00', 2_700_000, 100_000],
      ['251', 'JPY', '100000.00', 910_500, -10_500],
    ]);
    expect(plan).toMatchObject({ gain: 210_500, loss: 0, missingCurrencies: [] });

    await employee.post('/api/fx-revaluations').send({ date: '2026-03-31' }).expect(403);
    const run = (await owner.post('/api/fx-revaluations').send({ date: '2026-03-31' }).expect(201))
      .body;
    expect(run).toMatchObject({ gain: 210_500, loss: 0, rows: 3 });
    expect(await entryLines(run.entryId)).toEqual([
      ['103', 100_000, 0, 'USD', '0.00'],
      ['108', 100_000, 0, 'USD', '0.00'],
      ['251', 10_500, 0, 'JPY', '0.00'],
      ['910', 0, 210_500, null, null],
    ]);
    const entry = (await owner.get(`/api/journals/${run.entryId}`).expect(200)).body;
    expect(entry).toMatchObject({ source: 'fx_revaluation', sourceRef: '2026-03-31' });

    // 평가 후: 원화 잔액 = 외화 잔액 × 평가 환율
    expect(await ledgerClosing('103', '2026-03-31')).toBe(1_000 * 1_400);
    expect(await ledgerClosing('108', '2026-03-31')).toBe(2_000 * 1_400);
    expect(await ledgerClosing('251', '2026-03-31')).toBe((100_000 * 900) / 100);
    expect((await preview('2026-03-31')).rows.every((r) => r.adjustment === 0)).toBe(true);

    const again = await owner.post('/api/fx-revaluations').send({ date: '2026-03-31' }).expect(409);
    expect(again.body.code).toBe('FX_REVALUATION_ALREADY_RUN');
    const earlier = await owner
      .post('/api/fx-revaluations')
      .send({ date: '2026-03-15' })
      .expect(409);
    expect(earlier.body.code).toBe('FX_REVALUATION_ORDER');
    const manual = await owner.post(`/api/journals/${run.entryId}/reverse`).send({}).expect(409);
    expect(manual.body.code).toBe('SYSTEM_ENTRY');
  });

  it('결제 때 외환차익, 다음 평가는 앞선 평가를 반영한 장부 원화 기준', async () => {
    // Global 이 USD 2,000 을 1,420 에 보내옴: 장부 1,400 기준 외상매출금을 지우고 차익 4만
    await rate('USD', '2026-04-15', '1420');
    await post('2026-04-15', [
      {
        accountId: acc['103'],
        debit: 2_840_000,
        currency: 'USD',
        foreignAmount: '2000',
        exchangeRate: '1420',
      },
      {
        accountId: acc['108'],
        partnerId: globalInc,
        credit: 2_800_000,
        currency: 'USD',
        foreignAmount: '2000',
        exchangeRate: '1400',
      },
      { accountId: acc['907'], credit: 40_000 },
    ]);
    // 환율이 없는 통화(CNY)가 있으면 평가를 막는다
    await post('2026-04-20', [
      {
        accountId: acc['103'],
        debit: 190_000,
        currency: 'CNY',
        foreignAmount: '1000',
        exchangeRate: '190',
      },
      { accountId: acc['101'], credit: 190_000 },
    ]);
    await rate('USD', '2026-06-30', '1300');
    const plan = await preview('2026-06-30');
    expect(plan.missingCurrencies).toEqual(['CNY']);
    const missing = await owner
      .post('/api/fx-revaluations')
      .send({ date: '2026-06-30' })
      .expect(400);
    expect(missing.body.code).toBe('FX_RATE_MISSING');
    await rate('CNY', '2026-06-30', '195');

    const next = await preview('2026-06-30');
    expect(
      next.rows.map((r) => [r.accountCode, r.currency, r.foreignBalance, r.bookKrw, r.adjustment]),
    ).toEqual([
      ['103', 'CNY', '1000.00', 190_000, 5_000],
      ['103', 'USD', '3000.00', 4_240_000, -340_000],
      ['251', 'JPY', '100000.00', 900_000, 0],
    ]);
    const june = (await owner.post('/api/fx-revaluations').send({ date: '2026-06-30' }).expect(201))
      .body;
    expect(june).toMatchObject({ gain: 5_000, loss: 340_000 });
    expect(await ledgerClosing('103', '2026-06-30')).toBe(3_000 * 1_300 + 1_000 * 195);
    expect(await ledgerClosing('907')).toBe(40_000);
    expect(await ledgerClosing('910')).toBe(210_500 + 5_000);
    expect(await ledgerClosing('955')).toBe(340_000);

    // 마지막 평가만 취소(역분개)
    const notLatest = await owner.delete('/api/fx-revaluations/2026-03-31').expect(409);
    expect(notLatest.body.code).toBe('FX_REVALUATION_NOT_LATEST');
    await owner.delete('/api/fx-revaluations/2026-06-30').expect(204);
    expect(await ledgerClosing('103', '2026-06-30')).toBe(4_240_000 + 190_000);
    expect(
      (await owner.get('/api/fx-revaluations').expect(200)).body.map(
        (r: { date: string }) => r.date,
      ),
    ).toEqual(['2026-03-31']);
    await owner.post('/api/fx-revaluations').send({ date: '2026-06-30' }).expect(201);

    const tb = (
      await owner.get('/api/reports/trial-balance').query({ date: '2026-12-31' }).expect(200)
    ).body;
    expect(tb.balanced).toBe(true);
  });

  it('전기이월하면 외화 잔액도 이월되어 다음 연도 평가가 이어진다', async () => {
    const carried = await owner.post(`/api/fiscal-years/${fy2026}/carry-forward`).expect(200);
    const opening = (
      await owner
        .get(`/api/fiscal-years/${carried.body.nextFiscalYearId}/opening-balances`)
        .expect(200)
    ).body;
    const foreign = (opening.lines as (EntryLine & { accountCode: string })[])
      .filter((l) => l.currency)
      .map((l) => [l.accountCode, l.currency, l.foreignAmount, l.debit, l.credit])
      .sort();
    expect(foreign).toEqual([
      ['103', 'CNY', '1000.00', 195_000, 0],
      ['103', 'USD', '3000.00', 3_900_000, 0],
      ['251', 'JPY', '100000.00', 0, 900_000],
    ]);

    await rate('USD', '2027-01-31', '1350');
    const plan = await preview('2027-01-31');
    const usd = plan.rows.find((r) => r.currency === 'USD')!;
    expect(usd).toMatchObject({
      foreignBalance: '3000.00',
      bookKrw: 3_900_000,
      targetKrw: 4_050_000,
      adjustment: 150_000,
    });
  });
});
