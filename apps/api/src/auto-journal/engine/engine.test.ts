import { AUTO_JOURNAL_KINDS } from '@wellbuddy/shared';
import { describe, expect, it } from 'vitest';
import { defaultSuggestion } from './defaults.js';
import { historyKeys, type MemoryRow, recommendFromHistory } from './history.js';
import { entryDescription, type EvidenceItem, normalizeName } from './items.js';
import { buildEntry } from './lines.js';
import { matchCardPurchases, matchReceipts, pairCancellations } from './matching.js';
import { findRule, type RuleLike } from './rules.js';

const item = (over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  evidenceKind: 'card',
  evidenceId: 'e1',
  kind: 'card',
  date: '2026-03-10',
  description: '스타벅스 역삼점',
  counterparty: '스타벅스 역삼점',
  bizNo: null,
  partnerId: null,
  amount: 11_000,
  supply: null,
  vat: null,
  vatType: 'taxable',
  ledgerAccountId: null,
  category: '커피전문점',
  issuerName: '신한카드',
  reversal: false,
  ...over,
});

const rule = (over: Partial<RuleLike> = {}): RuleLike => ({
  id: 'r',
  priority: 100,
  isActive: true,
  kinds: [],
  keywords: null,
  partnerId: null,
  minAmount: null,
  maxAmount: null,
  createdAt: new Date('2026-01-01'),
  ...over,
});

const balanced = (lines: { debit: number; credit: number }[]) =>
  lines.reduce((s, l) => s + l.debit, 0) === lines.reduce((s, l) => s + l.credit, 0);

describe('이름 정규화·적요', () => {
  it('회사 형태·공백·기호를 뺀다', () => {
    expect(normalizeName('(주)한빛 상사')).toBe('한빛상사');
    expect(normalizeName('㈜ 한빛-상사')).toBe('한빛상사');
    expect(normalizeName('주식회사 KT')).toBe('kt');
  });
  it('전표 적요는 거래처와 내용을 겹치지 않게', () => {
    expect(entryDescription(item(), '카드')).toBe('카드 스타벅스 역삼점');
    expect(
      entryDescription(
        item({ description: '임대료', counterparty: '(주)강남빌딩', evidenceKind: 'bank' }),
        '출금',
      ),
    ).toBe('출금 (주)강남빌딩 임대료');
  });
});

describe('회사 규칙', () => {
  it('조건이 모두 맞는 규칙 중 우선순위가 가장 작은 것', () => {
    const rules = [
      rule({ id: 'coffee', keywords: '스타벅스, 이디야', priority: 50 }),
      rule({ id: 'card-all', kinds: ['card'], keywords: '역삼', priority: 10 }),
      rule({ id: 'off', keywords: '스타벅스', priority: 1, isActive: false }),
    ];
    expect(findRule(rules, item())?.id).toBe('card-all');
    expect(findRule(rules, item({ kind: 'cash_purchase' }))?.id).toBe('coffee');
    expect(findRule(rules, item({ description: '투썸', counterparty: '투썸' }))).toBeNull();
  });
  it('키워드는 공백·대소문자를 무시하고, 거래처·금액 조건도 본다', () => {
    expect(findRule([rule({ keywords: '스타 벅스' })], item())).not.toBeNull();
    expect(findRule([rule({ keywords: 'KTX' })], item({ description: 'ktx 서울' }))).not.toBeNull();
    const byPartner = rule({ partnerId: 'p1' });
    expect(findRule([byPartner], item())).toBeNull();
    expect(findRule([byPartner], item({ partnerId: 'p1' }))).not.toBeNull();
    const range = rule({ keywords: '스타벅스', minAmount: 10_000, maxAmount: 20_000 });
    expect(findRule([range], item({ amount: 9_999 }))).toBeNull();
    expect(findRule([range], item({ amount: 20_000 }))).not.toBeNull();
    expect(findRule([range], item({ amount: 20_001 }))).toBeNull();
  });
  it('우선순위가 같으면 먼저 만든 규칙', () => {
    const rules = [
      rule({ id: 'late', keywords: '스타벅스', createdAt: new Date('2026-02-01') }),
      rule({ id: 'early', keywords: '스타벅스', createdAt: new Date('2026-01-01') }),
    ];
    expect(findRule(rules, item())?.id).toBe('early');
  });
});

describe('과거 이력', () => {
  const row = (over: Partial<MemoryRow>): MemoryRow => ({
    key: 'biz:1234567890',
    accountId: 'a811',
    deductible: null,
    partnerId: null,
    useCount: 1,
    lastUsedAt: new Date('2026-01-01'),
    ...over,
  });

  it('사업자번호 → 거래처 → 이름 → 적요 순서', () => {
    expect(
      historyKeys(item({ bizNo: '1234567890', partnerId: 'p1', evidenceKind: 'bank' })),
    ).toEqual(['biz:1234567890', 'partner:p1', 'name:스타벅스역삼점', 'desc:스타벅스역삼점']);
    expect(historyKeys(item())).toEqual(['name:스타벅스역삼점']);
    expect(
      historyKeys(item({ counterparty: null, evidenceKind: 'bank', description: '급여' })),
    ).toEqual(['desc:급여']);
  });

  it('가장 많이 쓴 계정, 횟수와 비율로 신뢰도', () => {
    const it1 = item({ bizNo: '1234567890' });
    expect(recommendFromHistory(it1, [row({})])).toMatchObject({
      accountId: 'a811',
      confidence: 0.7,
    });
    expect(recommendFromHistory(it1, [row({ useCount: 3 })])?.confidence).toBe(0.9);
    expect(recommendFromHistory(it1, [row({ useCount: 9 })])?.confidence).toBe(0.95);
    const split = recommendFromHistory(it1, [
      row({ useCount: 2 }),
      row({ accountId: 'a813', useCount: 1 }),
    ]);
    expect(split).toMatchObject({ accountId: 'a811', confidence: 0.53 });
    expect(split?.reason).toContain('3번 중 2번');
    // 같은 횟수면 최근에 쓴 계정
    const tie = recommendFromHistory(it1, [
      row({ useCount: 2, lastUsedAt: new Date('2026-01-01') }),
      row({ accountId: 'a813', useCount: 2, lastUsedAt: new Date('2026-02-01') }),
    ]);
    expect(tie?.accountId).toBe('a813');
  });

  it('정확한 열쇠에 이력이 없으면 다음 열쇠', () => {
    const rows = [row({ key: 'name:스타벅스역삼점', accountId: 'a811' })];
    expect(recommendFromHistory(item({ bizNo: '9999999999' }), rows)?.accountId).toBe('a811');
    expect(
      recommendFromHistory(item({ counterparty: '투썸', description: '투썸' }), rows),
    ).toBeNull();
  });
});

describe('기본 추천', () => {
  it('적요·업종 키워드', () => {
    const bank = (description: string, counterparty: string | null = null) =>
      item({ evidenceKind: 'bank', kind: 'bank_out', description, counterparty, category: null });
    expect(defaultSuggestion(bank('임대료', '(주)강남빌딩'))?.accountCode).toBe('819');
    expect(defaultSuggestion(bank('카드대금', '신한카드'))?.accountCode).toBe('253');
    expect(defaultSuggestion(bank('급여', '급여 일괄이체'))?.accountCode).toBe('801');
    expect(defaultSuggestion(bank('타행이체', '처음보는곳'))).toBeNull();
    expect(defaultSuggestion(bank('타행이체', '동양자재'))).toBeNull();
    expect(
      defaultSuggestion({ ...bank('타행이체', '동양자재'), partnerId: 'p1' })?.accountCode,
    ).toBe('251');
    expect(
      defaultSuggestion(item({ evidenceKind: 'bank', kind: 'bank_in', description: '예금이자' }))
        ?.accountCode,
    ).toBe('901');
  });

  it('카드: 교통비는 불공제, 음식점 10만원 이상은 기업업무추진비', () => {
    expect(defaultSuggestion(item())).toMatchObject({ accountCode: '811', deductible: null });
    expect(
      defaultSuggestion(
        item({ description: '카카오T 택시', counterparty: '카카오T 택시', category: '택시' }),
      ),
    ).toMatchObject({ accountCode: '812', deductible: false });
    const dinner = item({
      description: '한우명가',
      counterparty: '한우명가',
      category: '일반음식점',
    });
    expect(defaultSuggestion({ ...dinner, amount: 99_000 })?.accountCode).toBe('811');
    expect(defaultSuggestion({ ...dinner, amount: 350_000 })).toMatchObject({
      accountCode: '813',
      deductible: false,
    });
    expect(
      defaultSuggestion(item({ description: '어딘가', counterparty: '어딘가', category: null })),
    ).toMatchObject({ accountCode: '830', confidence: 0.4 });
  });

  it('세금계산서 품목', () => {
    const tax = (kind: 'tax_sales' | 'tax_purchase', description: string) =>
      item({
        evidenceKind: 'tax_invoice',
        kind,
        description,
        counterparty: '거래처',
        category: null,
      });
    expect(defaultSuggestion(tax('tax_purchase', '사무실 임대료'))?.accountCode).toBe('819');
    expect(defaultSuggestion(tax('tax_purchase', '원자재'))?.accountCode).toBe('153');
    expect(defaultSuggestion(tax('tax_sales', '제품'))?.accountCode).toBe('404');
    expect(defaultSuggestion(tax('tax_sales', '기타'))?.accountCode).toBe('401');
  });
});

describe('자동 매칭', () => {
  const card = (id: string, over: Partial<Parameters<typeof pairCancellations>[0][0]> = {}) => ({
    id,
    cardId: 'c1',
    approvalNo: '111',
    amount: 8_000,
    cancelled: false,
    date: '2026-03-10',
    merchantBizNo: null,
    ...over,
  });

  it('승인과 취소를 한 쌍씩 짝짓는다', () => {
    const cards = [
      card('a'),
      card('b', { cancelled: true }),
      card('c', { approvalNo: '222' }),
      card('d', { approvalNo: '222', cancelled: true, amount: 9_000 }),
      card('e', { cancelled: true, cardId: 'c2' }),
    ];
    expect(pairCancellations(cards)).toEqual([{ originalId: 'a', cancelId: 'b' }]);
  });

  it('영수증은 같은 금액·하루 이내 카드와, 사업자번호가 같은 쪽을 먼저', () => {
    const cards = [
      card('x', { date: '2026-03-11', merchantBizNo: '1111111111' }),
      card('y', { date: '2026-03-10', merchantBizNo: '2222222222' }),
      card('z', { date: '2026-03-15' }),
    ];
    expect(
      matchReceipts(
        [
          { id: 'r1', date: '2026-03-10', totalAmount: 8_000, bizNo: '1111111111' },
          { id: 'r2', date: '2026-03-10', totalAmount: 8_000, bizNo: null },
          { id: 'r3', date: '2026-03-20', totalAmount: 8_000, bizNo: null },
          { id: 'r4', date: null, totalAmount: 8_000, bizNo: null },
        ],
        cards,
      ),
    ).toEqual([
      { receiptId: 'r1', cardId: 'x' },
      { receiptId: 'r2', cardId: 'y' },
    ]);
  });
});

describe('홈택스 카드매입 대조', () => {
  const card = (id: string, over: Partial<Parameters<typeof pairCancellations>[0][0]> = {}) => ({
    id,
    cardId: 'c1',
    approvalNo: '111',
    amount: 8_000,
    cancelled: false,
    date: '2026-03-10',
    merchantBizNo: null,
    ...over,
  });
  it('승인번호·금액·취소 여부가 같고 하루 이내인 승인에 사업자번호·부가세를 채운다', () => {
    const cards = [card('a'), card('b', { cancelled: true }), card('c', { approvalNo: '222' })];
    expect(
      matchCardPurchases(
        [
          {
            date: '2026-03-11',
            approvalNo: '111',
            amount: 8_000,
            cancelled: false,
            merchantBizNo: '1234567890',
            vatAmount: 727,
          },
          {
            date: '2026-03-10',
            approvalNo: '111',
            amount: 8_000,
            cancelled: true,
            merchantBizNo: '1234567890',
          },
          { date: '2026-03-15', approvalNo: '222', amount: 8_000, cancelled: false },
          { date: '2026-03-10', approvalNo: '333', amount: 8_000, cancelled: false },
        ],
        cards,
      ),
    ).toEqual([
      { cardTransactionId: 'a', merchantBizNo: '1234567890', vatAmount: 727 },
      { cardTransactionId: 'b', merchantBizNo: '1234567890', vatAmount: null },
    ]);
  });
});

describe('전표 모양', () => {
  const codes = (lines: { accountCode: string; debit: number; credit: number }[]) =>
    lines.map((l) => [l.accountCode, l.debit, l.credit]);

  it('카드: 비용 + 부가세대급금 / 미지급금(카드사), 취소는 차대 반대·부가세 음수', () => {
    const e = buildEntry(item(), { accountCode: '811', deductible: null }, '253');
    expect(e.type).toBe('purchase');
    expect(codes(e.lines)).toEqual([
      ['811', 10_000, 0],
      ['135', 1_000, 0],
      ['253', 0, 11_000],
    ]);
    expect(e.lines.find((l) => l.accountCode === '253')?.partnerRole).toBe('issuer');
    expect(e.lines.find((l) => l.main)?.accountCode).toBe('811');
    expect(e.vat).toMatchObject({ evidenceType: 'card', supplyAmount: 10_000, vatAmount: 1_000 });

    const cancel = buildEntry(
      item({ kind: 'card_cancel', reversal: true }),
      { accountCode: '811', deductible: null },
      '253',
    );
    expect(codes(cancel.lines)).toEqual([
      ['811', 0, 10_000],
      ['135', 0, 1_000],
      ['253', 11_000, 0],
    ]);
    expect(cancel.vat).toMatchObject({ supplyAmount: -10_000, vatAmount: -1_000 });
  });

  it('불공제면 부가세를 비용에 넣고, 면세는 부가세 없음', () => {
    const e = buildEntry(
      item({ amount: 330_000 }),
      { accountCode: '813', deductible: false },
      '253',
    );
    expect(codes(e.lines)).toEqual([
      ['813', 330_000, 0],
      ['253', 0, 330_000],
    ]);
    expect(e.vat).toMatchObject({ deductible: false, supplyAmount: 300_000, vatAmount: 30_000 });
    const book = buildEntry(
      item({ vatType: 'exempt', amount: 15_000 }),
      { accountCode: '826', deductible: null },
      '253',
    );
    expect(codes(book.lines)).toEqual([
      ['826', 15_000, 0],
      ['253', 0, 15_000],
    ]);
  });

  it('세금계산서·현금영수증·통장', () => {
    const purchase = buildEntry(
      item({
        evidenceKind: 'tax_invoice',
        kind: 'tax_purchase',
        amount: 2_200_000,
        supply: 2_000_000,
        vat: 200_000,
      }),
      { accountCode: '819', deductible: null },
      null,
    );
    expect(codes(purchase.lines)).toEqual([
      ['819', 2_000_000, 0],
      ['135', 200_000, 0],
      ['251', 0, 2_200_000],
    ]);
    expect(purchase.lines[2]?.partnerRole).toBe('counterparty');
    expect(purchase.vat?.evidenceType).toBe('tax_invoice');

    const sales = buildEntry(
      item({
        evidenceKind: 'tax_invoice',
        kind: 'tax_sales',
        amount: 550_000,
        supply: 500_000,
        vat: 50_000,
      }),
      { accountCode: '404', deductible: null },
      null,
    );
    expect(codes(sales.lines)).toEqual([
      ['108', 550_000, 0],
      ['404', 0, 500_000],
      ['255', 0, 50_000],
    ]);
    expect(sales.lines.find((l) => l.main)?.accountCode).toBe('404');

    const exemptInvoice = buildEntry(
      item({
        evidenceKind: 'tax_invoice',
        kind: 'tax_purchase',
        vatType: 'exempt',
        amount: 500_000,
      }),
      { accountCode: '146', deductible: null },
      null,
    );
    expect(exemptInvoice.vat).toMatchObject({ evidenceType: 'invoice', vatAmount: 0 });

    const cash = buildEntry(
      item({ evidenceKind: 'cash_receipt', kind: 'cash_purchase', amount: 11_000 }),
      { accountCode: '829', deductible: null },
      null,
    );
    expect(codes(cash.lines)).toEqual([
      ['829', 10_000, 0],
      ['135', 1_000, 0],
      ['101', 0, 11_000],
    ]);

    const bankOut = buildEntry(
      item({ evidenceKind: 'bank', kind: 'bank_out', amount: 2_200_000 }),
      { accountCode: '819', deductible: null },
      '103',
    );
    expect(bankOut.type).toBe('payment');
    expect(codes(bankOut.lines)).toEqual([
      ['819', 2_200_000, 0],
      ['103', 0, 2_200_000],
    ]);
    const bankIn = buildEntry(
      item({ evidenceKind: 'bank', kind: 'bank_in', amount: 1_100_000 }),
      { accountCode: '108', deductible: null },
      '103',
    );
    expect(codes(bankIn.lines)).toEqual([
      ['103', 1_100_000, 0],
      ['108', 0, 1_100_000],
    ]);
    expect(bankIn.lines[1]).toMatchObject({ main: true, partnerRole: 'counterparty' });
  });

  it('어느 종류든 차변 합계 = 대변 합계', () => {
    for (const kind of AUTO_JOURNAL_KINDS) {
      const evidenceKind = kind.startsWith('bank')
        ? 'bank'
        : kind.startsWith('card')
          ? 'card'
          : kind.startsWith('tax')
            ? 'tax_invoice'
            : 'cash_receipt';
      for (const amount of [1, 10, 12_345, 999_999_999]) {
        for (const reversal of [false, true]) {
          const e = buildEntry(
            item({ evidenceKind, kind, amount, reversal }),
            { accountCode: '830', deductible: amount % 2 === 0 },
            '253',
          );
          expect(balanced(e.lines), `${kind} ${amount}`).toBe(true);
        }
      }
    }
  });
});
