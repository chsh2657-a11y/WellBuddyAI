import { describe, expect, it } from 'vitest';
import { type MatchDoc, type MatchInvoice, planTradeInvoiceMatches } from './trade-matching.js';

const BIZ = '2208112341';
const inv = (over: Partial<MatchInvoice> & { id: string }): MatchInvoice => ({
  direction: 'sales',
  issueDate: '2026-11-10',
  bizNo: '220-81-12341',
  supply: 100_000,
  vat: 10_000,
  ...over,
});
const doc = (over: Partial<MatchDoc> & { id: string }): MatchDoc => ({
  kind: 'sale',
  docNo: `SL-${over.id}`,
  docDate: '2026-11-10',
  bizNo: BIZ,
  supply: 100_000,
  vat: 10_000,
  ...over,
});

describe('세금계산서 ↔ 판매·구매 문서 짝짓기', () => {
  it('방향·사업자번호·금액이 같고 같은 달이면 1:1 로 잇는다', () => {
    expect(
      planTradeInvoiceMatches(
        [inv({ id: 'i1' })],
        [
          doc({ id: 'other-biz', bizNo: '1248100998' }),
          doc({ id: 'purchase', kind: 'purchase' }),
          doc({ id: 'other-amount', supply: 100_001 }),
          doc({ id: 'other-vat', vat: 0 }),
          doc({ id: 'next-month', docDate: '2026-12-01' }),
          doc({ id: 'ok' }),
        ],
      ),
    ).toEqual([{ invoiceId: 'i1', docIds: ['ok'] }]);
  });

  it('후보가 여럿이면 작성일자에 가장 가까운 문서, 문서는 한 번만 쓴다', () => {
    const matches = planTradeInvoiceMatches(
      [inv({ id: 'i2', issueDate: '2026-11-20' }), inv({ id: 'i1', issueDate: '2026-11-03' })],
      [
        doc({ id: 'd02', docDate: '2026-11-02' }),
        doc({ id: 'd18', docDate: '2026-11-18' }),
        doc({ id: 'd30', docDate: '2026-11-30' }),
      ],
    );
    expect(matches).toEqual([
      { invoiceId: 'i1', docIds: ['d02'] },
      { invoiceId: 'i2', docIds: ['d18'] },
    ]);
    // 같은 문서 하나에 같은 금액 계산서 두 장이면 한 장만 잇는다
    expect(
      planTradeInvoiceMatches([inv({ id: 'a' }), inv({ id: 'b' })], [doc({ id: 'only' })]),
    ).toEqual([{ invoiceId: 'a', docIds: ['only'] }]);
  });

  it('반품은 음수 금액의 수정세금계산서와, 매입은 구매와 짝짓는다', () => {
    expect(
      planTradeInvoiceMatches(
        [
          inv({ id: 'minus', supply: -30_000, vat: -3_000 }),
          inv({ id: 'buy', direction: 'purchase', supply: 40_000, vat: 4_000 }),
        ],
        [
          doc({ id: 'ret', kind: 'sales_return', supply: 30_000, vat: 3_000 }),
          doc({ id: 'pu', kind: 'purchase', supply: 40_000, vat: 4_000 }),
          doc({ id: 'pr', kind: 'purchase_return', supply: 40_000, vat: 4_000 }),
        ],
      ),
    ).toEqual([
      { invoiceId: 'buy', docIds: ['pu'] },
      { invoiceId: 'minus', docIds: ['ret'] },
    ]);
  });

  it('1:1 이 없으면 같은 거래처·같은 달 문서의 합계로 월합계 계산서와 잇는다', () => {
    const docs = [
      doc({ id: '1', docDate: '2026-11-03', supply: 50_000, vat: 5_000 }),
      doc({ id: '2', docDate: '2026-11-17', supply: 70_000, vat: 7_000 }),
      doc({ id: '3', kind: 'sales_return', docDate: '2026-11-20', supply: 20_000, vat: 2_000 }),
      doc({ id: 'oct', docDate: '2026-10-31', supply: 1_000, vat: 100 }),
    ];
    expect(planTradeInvoiceMatches([inv({ id: 'm', issueDate: '2026-11-30' })], docs)).toEqual([
      { invoiceId: 'm', docIds: ['1', '2', '3'] },
    ]);
    // 합계가 다르면 잇지 않는다
    expect(
      planTradeInvoiceMatches([inv({ id: 'm', issueDate: '2026-11-30', supply: 99_000 })], docs),
    ).toEqual([]);
    // 남은 문서가 한 건뿐이면 월합계로 보지 않는다(금액이 다른 1:1)
    expect(
      planTradeInvoiceMatches(
        [inv({ id: 'm', supply: 50_000, vat: 0 })],
        [doc({ id: '1', supply: 50_000, vat: 5_000 })],
      ),
    ).toEqual([]);
  });

  it('1:1 로 먼저 쓴 문서는 월합계에서 빠진다', () => {
    expect(
      planTradeInvoiceMatches(
        [
          inv({ id: 'single', supply: 10_000, vat: 1_000 }),
          inv({ id: 'sum', supply: 30_000, vat: 3_000 }),
        ],
        [
          doc({ id: 'a', supply: 10_000, vat: 1_000 }),
          doc({ id: 'b', supply: 10_000, vat: 1_000 }),
          doc({ id: 'c', supply: 20_000, vat: 2_000 }),
        ],
      ),
    ).toEqual([
      { invoiceId: 'single', docIds: ['a'] },
      { invoiceId: 'sum', docIds: ['b', 'c'] },
    ]);
  });
});
