import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  addDays,
  paymentLines,
  purchaseLines,
  receiptLines,
  salesLines,
  type TemplateLine,
  VAT_TYPES,
  type VatType,
} from '@wellbuddy/accounting-core';
import { truncateAll } from '@wellbuddy/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Agent, createTestApp, ownerWithCompany } from './helpers.js';

/**
 * P1-23 단계 완료 기준: 실제 API 로 여러 종류의 전표를 섞어 넣고
 * (작성중·승인요청으로 남긴 것, 역분개한 것 포함) 장부·보고서가 서로 맞는지 확인한다.
 * 기대값은 테스트가 따로 들고 있는 "전기된 줄" 목록으로 계산한다.
 */

function random(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface PostedLine {
  date: string;
  code: string;
  debit: number;
  credit: number;
  partnerId: string | null;
}

describe('회계 불변식(API 통합)', () => {
  let app: NestExpressApplication;
  let owner: Agent;
  const acc: Record<string, string> = {};
  const requiresPartner = new Set<string>();
  const partners: string[] = [];
  const posted: PostedLine[] = [];
  let entryCount = 0;
  let unpostedCount = 0;

  const toApi = (
    lines: { code: string; debit: number; credit: number; partnerId: string | null }[],
  ) =>
    lines.map((l) => ({
      accountId: acc[l.code]!,
      debit: l.debit,
      credit: l.credit,
      partnerId: l.partnerId,
    }));

  /** 기대값 계산: 기준일까지 전기된 줄의 계정별 합계 */
  const expectedTotals = (to: string) => {
    const sums = new Map<string, { debit: number; credit: number }>();
    for (const l of posted.filter((p) => p.date <= to)) {
      const s = sums.get(l.code) ?? { debit: 0, credit: 0 };
      s.debit += l.debit;
      s.credit += l.credit;
      sums.set(l.code, s);
    }
    return sums;
  };

  beforeAll(async () => {
    await truncateAll();
    app = await createTestApp();
    ({ agent: owner } = await ownerWithCompany(app, 'owner@invariants.local', '불변식상사'));
    for (const a of (await owner.get('/api/accounts').expect(200)).body as {
      id: string;
      code: string;
      requiresPartner: boolean;
    }[]) {
      acc[a.code] = a.id;
      if (a.requiresPartner) requiresPartner.add(a.code);
    }
    for (const name of ['한빛상사', '누리유통', '다온물산']) {
      partners.push((await owner.post('/api/partners').send({ name }).expect(201)).body.id);
    }

    // 기초잔액(2025-01-01)
    const fy = (await owner.post('/api/fiscal-years').send({ date: '2025-01-01' }).expect(201)).body
      .id;
    const opening = [
      { code: '101', debit: 5_000_000, credit: 0, partnerId: null },
      { code: '103', debit: 20_000_000, credit: 0, partnerId: null },
      { code: '108', debit: 3_000_000, credit: 0, partnerId: partners[0]! },
      { code: '251', debit: 0, credit: 2_000_000, partnerId: partners[1]! },
      { code: '331', debit: 0, credit: 26_000_000, partnerId: null },
    ];
    await owner
      .put(`/api/fiscal-years/${fy}/opening-balances`)
      .send({ lines: toApi(opening) })
      .expect(200);
    posted.push(...opening.map((l) => ({ ...l, date: '2025-01-01' })));

    // 무작위 전표 80건
    const r = random(20250101);
    const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)]!;
    const amount = (max = 3_000_000) => 1_000 + Math.floor(r() * max);
    const date = () =>
      `2025-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`;
    const withPartners = (template: TemplateLine[], partnerId: string) =>
      template.map((t) => ({
        code: t.accountCode,
        debit: t.debit,
        credit: t.credit,
        partnerId: t.withPartner || requiresPartner.has(t.accountCode) ? partnerId : null,
      }));
    const counters = ['401', '811', '830', '108', '251', '253', '120', '259'];
    const generalCodes = ['146', '212', '811', '813', '819', '830', '401', '402', '131', '253'];

    for (let i = 0; i < 80; i++) {
      const entryDate = date();
      const partnerId = pick(partners);
      const kind = r();
      let type = 'general';
      let vat: object | null = null;
      let lines: { code: string; debit: number; credit: number; partnerId: string | null }[];
      if (kind < 0.25) {
        type = 'sales';
        const vatType: VatType = pick(VAT_TYPES);
        const t = salesLines({
          supply: amount(),
          vatType,
          receivableCode: pick(['108', '101', '103']),
        });
        lines = withPartners(t, partnerId);
        const vatAmount = t.find((l) => l.accountCode === '255')?.credit ?? 0;
        vat = {
          vatType,
          evidenceType: vatType === 'exempt' ? 'invoice' : 'tax_invoice',
          supplyAmount: t.find((l) => l.credit > 0 && l.accountCode !== '255')!.credit,
          vatAmount,
          partnerId,
        };
      } else if (kind < 0.45) {
        type = 'purchase';
        const vatType: VatType = pick(VAT_TYPES);
        const deductible = r() < 0.75;
        const supply = amount();
        const t = purchaseLines({
          supply,
          vatType,
          expenseCode: pick(['146', '830', '813', '212']),
          payableCode: pick(['251', '253', '101', '103']),
          deductible,
        });
        lines = withPartners(t, partnerId);
        vat = {
          vatType,
          evidenceType: vatType === 'exempt' ? 'invoice' : 'tax_invoice',
          supplyAmount: supply,
          vatAmount: vatType === 'taxable' ? Math.floor(supply / 10) : 0,
          deductible,
          partnerId,
        };
      } else if (kind < 0.6) {
        type = 'receipt';
        lines = withPartners(
          receiptLines(amount(), pick(counters), pick(['101', '103'])),
          partnerId,
        );
      } else if (kind < 0.75) {
        type = 'payment';
        lines = withPartners(
          paymentLines(amount(), pick(counters), pick(['101', '103'])),
          partnerId,
        );
      } else {
        const n = 2 + Math.floor(r() * 3);
        lines = [];
        let net = 0;
        for (let k = 0; k < n - 1; k++) {
          const code = pick(generalCodes);
          const value = amount(1_000_000);
          const debit = r() < 0.5;
          lines.push({
            code,
            debit: debit ? value : 0,
            credit: debit ? 0 : value,
            partnerId: requiresPartner.has(code) ? partnerId : null,
          });
          net += debit ? value : -value;
        }
        if (net === 0) continue;
        lines.push({
          code: '103',
          debit: net < 0 ? -net : 0,
          credit: net > 0 ? net : 0,
          partnerId: null,
        });
      }

      // 15% 는 작성중·승인요청으로 남긴다(장부에 들어가면 안 된다)
      const status = r() < 0.15 ? pick(['draft', 'pending']) : 'posted';
      const res = await owner
        .post('/api/journals')
        .send({ entry: { entryDate, type, lines: toApi(lines), vat }, status })
        .expect(201);
      entryCount++;
      if (status !== 'posted') {
        unpostedCount++;
        continue;
      }
      posted.push(...lines.map((l) => ({ ...l, date: entryDate })));

      // 10% 는 역분개(원래 날짜 이후, 연말을 넘지 않게)
      if (r() < 0.1) {
        let reverseDate = addDays(entryDate, Math.floor(r() * 20));
        if (reverseDate > '2025-12-31') reverseDate = '2025-12-31';
        await owner
          .post(`/api/journals/${res.body.id}/reverse`)
          .send({ entryDate: reverseDate })
          .expect(201);
        posted.push(
          ...lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit, date: reverseDate })),
        );
      }
    }
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('시나리오가 여러 상태를 섞었다', () => {
    expect(entryCount).toBeGreaterThan(60);
    expect(unpostedCount).toBeGreaterThan(0);
  });

  describe.each(['2025-03-31', '2025-06-30', '2025-12-31'])('기준일 %s', (date) => {
    it('합계잔액시산표는 대차가 맞고, 계정별 합계가 전기된 전표와 같다', async () => {
      const tb = (await owner.get('/api/reports/trial-balance').query({ date }).expect(200))
        .body as {
        balanced: boolean;
        totals: { debit: number; credit: number; debitBalance: number; creditBalance: number };
        rows: { code: string; debit: number; credit: number }[];
      };
      expect(tb.balanced).toBe(true);
      expect(tb.totals.debit).toBe(tb.totals.credit);
      expect(tb.totals.debitBalance).toBe(tb.totals.creditBalance);

      const expected = expectedTotals(date);
      const actual = new Map(tb.rows.map((r) => [r.code, { debit: r.debit, credit: r.credit }]));
      for (const [code, sums] of expected) {
        if (sums.debit === 0 && sums.credit === 0) continue;
        expect(actual.get(code), `계정 ${code}`).toEqual(sums);
      }
      expect(actual.size).toBe([...expected.values()].filter((s) => s.debit || s.credit).length);
    });

    it('자산 = 부채 + 자본이고, 재무상태표의 당기순이익 = 손익계산서 당기순이익', async () => {
      const bs = (await owner.get('/api/reports/balance-sheet').query({ date }).expect(200)).body;
      expect(bs.balanced).toBe(true);
      expect(bs.totalAssets).toBe(bs.totalLiabilities + bs.totalEquity);
      const is = (
        await owner
          .get('/api/reports/income-statement')
          .query({ from: '2025-01-01', to: date })
          .expect(200)
      ).body;
      expect(bs.undistributedIncome.currentPeriod).toBe(is.netIncome);
    });
  });

  it('월계표: 차변 소계 + 월말 현금 = 대변 소계 + 전월 현금', async () => {
    for (const [from, to] of [
      ['2025-02-01', '2025-02-28'],
      ['2025-07-01', '2025-07-31'],
      ['2025-11-01', '2025-11-30'],
    ] as const) {
      const d = (await owner.get('/api/reports/daily-summary').query({ from, to }).expect(200))
        .body;
      const t = d.totals;
      expect(t.debitTransfer).toBe(t.creditTransfer);
      expect(t.debitCash + t.debitTransfer + d.cash.closing).toBe(
        t.creditCash + t.creditTransfer + d.cash.opening,
      );
    }
  });

  it('거래처원장 잔액 합계 = 시산표의 그 계정 잔액', async () => {
    const tb = (
      await owner.get('/api/reports/trial-balance').query({ date: '2025-12-31' }).expect(200)
    ).body as { rows: { code: string; debit: number; credit: number }[] };
    for (const code of ['108', '251']) {
      const row = tb.rows.find((r) => r.code === code)!;
      const balances = (
        await owner
          .get('/api/reports/partner-balances')
          .query({ accountId: acc[code], from: '2025-01-01', to: '2025-12-31' })
          .expect(200)
      ).body;
      const net = row.debit - row.credit;
      expect(balances.totals.closing).toBe(code === '108' ? net : -net);
    }
  });

  it('전기이월하면 다음 연도 기초 재무상태표가 전년도 말 재무상태표와 같다', async () => {
    const years = (await owner.get('/api/fiscal-years').expect(200)).body as {
      id: string;
      label: string;
    }[];
    const fy2025 = years.find((y) => y.label === '2025')!;
    const closing = (
      await owner.get('/api/reports/balance-sheet').query({ date: '2025-12-31' }).expect(200)
    ).body;
    await owner.post(`/api/fiscal-years/${fy2025.id}/carry-forward`).expect(200);
    const opening = (
      await owner.get('/api/reports/balance-sheet').query({ date: '2026-01-01' }).expect(200)
    ).body;
    expect(opening.balanced).toBe(true);
    expect(opening.undistributedIncome.currentPeriod).toBe(0);
    expect(opening.totalAssets).toBe(closing.totalAssets);
    expect(opening.totalLiabilities).toBe(closing.totalLiabilities);
    expect(opening.totalEquity).toBe(closing.totalEquity);
  });
});
