import type { NestExpressApplication } from '@nestjs/platform-express';
import { truncateAll } from '@wellbuddy/db/testing';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, inviteAndJoin, ownerWithCompany } from './helpers.js';

/**
 * 2026 회계연도 시나리오
 *  기초: 현금 100만, 보통예금 500만, 외상매출금(한빛) 50만, 외상매입금(누리) 30만, 자본금 620만
 *  3/5  한빛에 외상 매출 110만(공급가 100만 + 부가세 10만)
 *  3/5  복리후생비 현금 5만
 *  3/6  (작성중) 복리후생비 현금 999 — 집계되지 않아야 한다
 *  3/10 한빛 외상대금 현금 회수 60만
 *  3/20 잘못 입력한 복리후생비 현금 2만 → 3/21 역분개
 *  4/2  누리에서 상품 외상 매입 44만(공급가 40만 + 부가세 4만)
 *  4/15 누리 외상대금 보통예금 지급 30만
 */
describe('장부·보고서', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  let employee: Agent;
  const acc: Record<string, string> = {};
  let hanbit: string;
  let nuri: string;

  const line = (code: string, debit: number, credit: number, partnerId?: string) => ({
    accountId: acc[code]!,
    debit,
    credit,
    ...(partnerId ? { partnerId } : {}),
  });
  const post = async (entryDate: string, lines: ReturnType<typeof line>[], extra = {}) =>
    (
      await owner
        .post('/api/journals')
        .send({ entry: { entryDate, lines, ...extra }, status: 'posted' })
        .expect(201)
    ).body as { id: string };

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@reports.local', '보고서상사'));
    employee = await inviteAndJoin(app, owner, 'emp@reports.local', 'employee');
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
    }[]) {
      acc[a.code] = a.id;
    }
    hanbit = (await owner.post('/api/partners').send({ name: '한빛상사' }).expect(201)).body.id;
    nuri = (await owner.post('/api/partners').send({ name: '누리유통' }).expect(201)).body.id;

    const fy = (await owner.post('/api/fiscal-years').send({ date: '2026-01-01' }).expect(201)).body
      .id;
    await owner
      .put(`/api/fiscal-years/${fy}/opening-balances`)
      .send({
        lines: [
          line('101', 1_000_000, 0),
          line('103', 5_000_000, 0),
          line('108', 500_000, 0, hanbit),
          line('251', 0, 300_000, nuri),
          line('331', 0, 6_200_000),
        ],
      })
      .expect(200);

    const vat = (partnerId: string, supplyAmount: number, vatAmount: number) => ({
      vatType: 'taxable',
      evidenceType: 'tax_invoice',
      supplyAmount,
      vatAmount,
      partnerId,
    });
    await post(
      '2026-03-05',
      [line('108', 1_100_000, 0, hanbit), line('401', 0, 1_000_000), line('255', 0, 100_000)],
      { type: 'sales', vat: vat(hanbit, 1_000_000, 100_000) },
    );
    await post('2026-03-05', [line('811', 50_000, 0), line('101', 0, 50_000)]);
    await owner
      .post('/api/journals')
      .send({
        entry: { entryDate: '2026-03-06', lines: [line('811', 999, 0), line('101', 0, 999)] },
      })
      .expect(201);
    await post('2026-03-10', [line('101', 600_000, 0), line('108', 0, 600_000, hanbit)]);
    const wrong = await post('2026-03-20', [line('811', 20_000, 0), line('101', 0, 20_000)]);
    await owner
      .post(`/api/journals/${wrong.id}/reverse`)
      .send({ entryDate: '2026-03-21' })
      .expect(201);
    await post(
      '2026-04-02',
      [line('146', 400_000, 0), line('135', 40_000, 0), line('251', 0, 440_000, nuri)],
      { type: 'purchase', vat: vat(nuri, 400_000, 40_000) },
    );
    await post('2026-04-15', [line('251', 300_000, 0, nuri), line('103', 0, 300_000)]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('일계표: 현금 거래와 대체 거래를 나누고 현금 시재를 맞춘다', async () => {
    const day = (
      await owner
        .get('/api/reports/daily-summary')
        .query({ from: '2026-03-05', to: '2026-03-05' })
        .expect(200)
    ).body;
    const byCode = Object.fromEntries(day.rows.map((r: { code: string }) => [r.code, r])) as Record<
      string,
      Record<string, number>
    >;
    expect(byCode['108']).toMatchObject({ debitTransfer: 1_100_000, debitCash: 0 });
    expect(byCode['401']).toMatchObject({ creditTransfer: 1_000_000 });
    expect(byCode['811']).toMatchObject({ debitCash: 50_000, debitTransfer: 0 });
    expect(byCode['101']).toBeUndefined();
    expect(day.cash).toEqual({
      opening: 1_000_000,
      receipts: 0,
      payments: 50_000,
      closing: 950_000,
    });

    const month = (
      await owner
        .get('/api/reports/daily-summary')
        .query({ from: '2026-03-01', to: '2026-03-31' })
        .expect(200)
    ).body;
    // 역분개 2만은 출금·입금 양쪽에 나타나고, 작성중 999원은 빠진다
    expect(month.cash).toEqual({
      opening: 1_000_000,
      receipts: 620_000,
      payments: 70_000,
      closing: 1_550_000,
    });
  });

  it('계정별원장·현금출납장: 기간 전 잔액에서 이어서 잔액을 누적한다', async () => {
    const cash = (
      await owner
        .get('/api/reports/account-ledger')
        .query({ accountId: acc['101'], from: '2026-03-01', to: '2026-03-31' })
        .expect(200)
    ).body;
    expect(cash.opening).toBe(1_000_000);
    expect(
      cash.rows.map((r: { entryDate: string; debit: number; credit: number; balance: number }) => [
        r.entryDate,
        r.debit,
        r.credit,
        r.balance,
      ]),
    ).toEqual([
      ['2026-03-05', 0, 50_000, 950_000],
      ['2026-03-10', 600_000, 0, 1_550_000],
      ['2026-03-20', 0, 20_000, 1_530_000],
      ['2026-03-21', 20_000, 0, 1_550_000],
    ]);
    expect(cash.rows[0].counterAccount).toBe('복리후생비');
    expect(cash.rows[1].counterAccount).toBe('외상매출금');
    expect(cash.closing).toBe(1_550_000);

    const april = (
      await owner
        .get('/api/reports/account-ledger')
        .query({ accountId: acc['101'], from: '2026-04-01', to: '2026-04-30' })
        .expect(200)
    ).body;
    expect(april).toMatchObject({ opening: 1_550_000, rows: [], closing: 1_550_000 });
  });

  it('거래처원장·거래처별 잔액: 대변 정상잔액 계정은 대변 쪽으로 늘어난다', async () => {
    const ledger = (
      await owner
        .get('/api/reports/account-ledger')
        .query({ accountId: acc['108'], partnerId: hanbit, from: '2026-01-01', to: '2026-12-31' })
        .expect(200)
    ).body;
    expect(ledger.partner.name).toBe('한빛상사');
    expect(ledger.opening).toBe(500_000);
    expect(ledger.rows.map((r: { balance: number }) => r.balance)).toEqual([1_600_000, 1_000_000]);

    const payables = (
      await owner
        .get('/api/reports/partner-balances')
        .query({ accountId: acc['251'], from: '2026-01-01', to: '2026-12-31' })
        .expect(200)
    ).body;
    expect(payables.rows).toEqual([
      {
        partnerId: nuri,
        partnerCode: expect.any(String),
        partnerName: '누리유통',
        opening: 300_000,
        debit: 300_000,
        credit: 440_000,
        closing: 440_000,
      },
    ]);
  });

  it('총계정원장: 월별 합계와 누적 잔액', async () => {
    const gl = (
      await owner
        .get('/api/reports/general-ledger')
        .query({ accountId: acc['101'], date: '2026-06-30' })
        .expect(200)
    ).body;
    expect(gl.opening).toBe(1_000_000);
    expect(gl.months).toHaveLength(12);
    expect(gl.months[2]).toEqual({
      month: '2026-03',
      debit: 620_000,
      credit: 70_000,
      balance: 1_550_000,
    });
    expect(gl.months[11].balance).toBe(1_550_000);
  });

  it('합계잔액시산표·재무상태표·손익계산서가 서로 맞는다', async () => {
    const tb = (
      await owner.get('/api/reports/trial-balance').query({ date: '2026-12-31' }).expect(200)
    ).body;
    expect(tb.balanced).toBe(true);
    expect(tb.totals.debit).toBe(tb.totals.credit);

    const is = (
      await owner
        .get('/api/reports/income-statement')
        .query({ from: '2026-01-01', to: '2026-12-31' })
        .expect(200)
    ).body;
    expect(is).toMatchObject({ revenue: 1_000_000, sga: 50_000, netIncome: 950_000 });

    const bs = (
      await owner.get('/api/reports/balance-sheet').query({ date: '2026-12-31' }).expect(200)
    ).body;
    expect(bs).toMatchObject({
      totalAssets: 7_690_000,
      totalLiabilities: 540_000,
      totalEquity: 7_150_000,
      balanced: true,
      undistributedIncome: { priorPeriods: 0, currentPeriod: 950_000 },
    });

    const march = (
      await owner.get('/api/reports/balance-sheet').query({ date: '2026-03-31' }).expect(200)
    ).body;
    expect(march.balanced).toBe(true);
    expect(march.totalAssets).toBe(march.totalLiabilities + march.totalEquity);
  });

  it('채권·채무 연령분석: 남은 잔액은 최근 발생분부터', async () => {
    const receivable = (
      await owner
        .get('/api/reports/aging')
        .query({ kind: 'receivable', date: '2026-06-30' })
        .expect(200)
    ).body;
    expect(receivable.rows).toEqual([
      {
        partnerId: hanbit,
        partnerName: '한빛상사',
        balance: 1_000_000,
        buckets: [0, 0, 0, 1_000_000, 0],
      },
    ]);
    const payable = (
      await owner
        .get('/api/reports/aging')
        .query({ kind: 'payable', date: '2026-06-30' })
        .expect(200)
    ).body;
    expect(payable.rows[0]).toMatchObject({ partnerName: '누리유통', balance: 440_000 });
    expect(payable.rows[0].buckets).toEqual([0, 0, 440_000, 0, 0]);
  });

  it('대시보드 지표', async () => {
    const d = (await owner.get('/api/reports/dashboard').query({ date: '2026-06-30' }).expect(200))
      .body;
    expect(d).toMatchObject({
      cash: 1_550_000,
      deposits: 4_700_000,
      receivables: 1_000_000,
      payables: 440_000,
      revenue: 1_000_000,
      expense: 50_000,
      netIncome: 950_000,
      drafts: 1,
      pending: 0,
    });
    expect(d.months[2]).toEqual({ month: '2026-03', revenue: 1_000_000, expense: 50_000 });
  });

  it('조회 기간은 한 회계연도 안이어야 하고, 회계 권한이 없으면 볼 수 없다', async () => {
    await owner.post('/api/fiscal-years').send({ date: '2025-06-01' }).expect(201);
    const spans = await owner
      .get('/api/reports/daily-summary')
      .query({ from: '2025-12-01', to: '2026-01-31' })
      .expect(400);
    expect(spans.body.code).toBe('RANGE_SPANS_FISCAL_YEARS');
    await employee.get('/api/reports/trial-balance').query({ date: '2026-12-31' }).expect(403);
  });

  it('보고서 표를 엑셀로 내려받는다', async () => {
    const res = await owner
      .post('/api/reports/export')
      .send({
        title: '합계잔액시산표',
        subtitle: '보고서상사 · 2026-12-31',
        columns: [
          { header: '계정과목' },
          { header: '차변 잔액', type: 'won' },
          { header: '대변 잔액', type: 'won' },
        ],
        rows: [
          ['현금', 1_550_000, null],
          ['합계', 1_550_000, 0],
        ],
        boldRows: [1],
      })
      .responseType('blob')
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('합계잔액시산표'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as ArrayBuffer);
    const sheet = wb.worksheets[0]!;
    expect(sheet.getCell('A1').value).toBe('합계잔액시산표');
    expect(sheet.getCell('A3').value).toBe('계정과목');
    expect(sheet.getCell('B4').value).toBe(1_550_000);
    expect(sheet.getColumn(2).numFmt).toContain('#,##0');
  });
});
