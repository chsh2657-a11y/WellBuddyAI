import { isValidBizNo } from '@wellbuddy/accounting-core';
import { describe, expect, it } from 'vitest';
import { bankTransactionHash, cardApprovalHash, taxInvoiceHash } from '../hash.js';
import { ProviderError } from '../registry.js';
import { bizNo, CASH_MERCHANTS, CUSTOMERS, MERCHANTS, SUPPLIERS } from './catalog.js';
import {
  createProviderRegistry,
  MockBankProvider,
  MockCardProvider,
  MockHometaxProvider,
} from './index.js';

const account = { id: 'acc-1', bankCode: '0004', accountNo: '12345678901234' };
const card = { id: 'card-1', cardCompany: '0306', cardNo: '4518123456789012' };
const ctx = { companyId: 'company-1', companyName: '모의상사', bizNo: '1248100998' };

describe('모의 공급자', () => {
  it('가상 거래처 사업자번호는 모두 검증 공식을 통과한다', () => {
    expect(bizNo('124810099')).toBe('1248100998');
    for (const p of [...CUSTOMERS, ...SUPPLIERS, ...MERCHANTS, ...CASH_MERCHANTS]) {
      expect(isValidBizNo(p.bizNo), p.name).toBe(true);
    }
  });

  it('은행: 같은 기간은 늘 같고, 겹치는 기간은 겹치는 날의 거래가 같다', async () => {
    const bank = new MockBankProvider();
    const march = await bank.fetchTransactions(account, { from: '2026-03-01', to: '2026-03-31' });
    const again = await bank.fetchTransactions(account, { from: '2026-03-01', to: '2026-03-31' });
    expect(again).toEqual(march);
    expect(march.length).toBeGreaterThan(20);

    const mid = await bank.fetchTransactions(account, { from: '2026-03-15', to: '2026-04-10' });
    const overlap = march.filter((r) => r.date >= '2026-03-15');
    expect(mid.slice(0, overlap.length)).toEqual(overlap);

    const other = await bank.fetchTransactions(
      { ...account, id: 'acc-2' },
      { from: '2026-03-01', to: '2026-03-31' },
    );
    expect(other).not.toEqual(march);
  });

  it('은행: 금액은 양의 정수, 입금·출금 중 하나, 잔액은 이어진다, 고유번호가 겹치지 않는다', async () => {
    const records = await new MockBankProvider().fetchTransactions(account, {
      from: '2026-01-01',
      to: '2026-06-30',
    });
    for (const r of records) {
      expect(Number.isInteger(r.deposit) && Number.isInteger(r.withdrawal)).toBe(true);
      expect(r.deposit > 0 !== r.withdrawal > 0).toBe(true);
      expect(r.balance!).toBeGreaterThanOrEqual(1_000_000);
    }
    for (let i = 1; i < records.length; i++) {
      const [prev, cur] = [records[i - 1]!, records[i]!];
      expect(cur.balance).toBe(prev.balance! + cur.deposit - cur.withdrawal);
      expect(`${prev.date} ${prev.time}` <= `${cur.date} ${cur.time}`).toBe(true);
    }
    const hashes = new Set(records.map((r) => bankTransactionHash(account.id, r)));
    expect(hashes.size).toBe(records.length);
    // 정기 이체
    expect(records.filter((r) => r.description === '급여')).toHaveLength(6);
    expect(
      records.filter((r) => r.description === '임대료').every((r) => r.date.endsWith('-05')),
    ).toBe(true);
  });

  it('카드: 날짜별로 정해지고, 취소는 같은 승인번호로 뒤따른다', async () => {
    const provider = new MockCardProvider();
    const range = { from: '2026-01-01', to: '2026-06-30' };
    const records = await provider.fetchApprovals(card, range);
    expect(await provider.fetchApprovals(card, range)).toEqual(records);
    expect(records.every((r) => r.amount > 0 && Number.isInteger(r.amount))).toBe(true);
    const cancels = records.filter((r) => r.cancelled);
    expect(cancels.length).toBeGreaterThan(0);
    for (const c of cancels) {
      expect(
        records.some((r) => !r.cancelled && r.approvalNo === c.approvalNo && r.amount === c.amount),
      ).toBe(true);
    }
    expect(new Set(records.map((r) => cardApprovalHash(card.id, r))).size).toBe(records.length);
    const books = records.filter((r) => r.merchantName.startsWith('교보문고'));
    expect(books.every((r) => r.vatAmount === 0)).toBe(true);
  });

  it('홈택스: 우리 사업자번호로 매출·매입이 갈리고 합계 = 공급가액 + 세액', async () => {
    const hometax = new MockHometaxProvider(ctx);
    const range = { from: '2026-01-01', to: '2026-03-31' };
    const sales = await hometax.fetchTaxInvoices('sales', range);
    const purchases = await hometax.fetchTaxInvoices('purchase', range);
    expect(sales.length).toBeGreaterThan(10);
    expect(sales.every((r) => r.supplierBizNo === ctx.bizNo && r.buyerBizNo !== ctx.bizNo)).toBe(
      true,
    );
    expect(purchases.every((r) => r.buyerBizNo === ctx.bizNo)).toBe(true);
    for (const r of [...sales, ...purchases]) {
      expect(r.totalAmount).toBe(r.supplyAmount + r.vatAmount);
      expect(r.vatAmount).toBe(r.kind === 'tax' ? r.supplyAmount / 10 : 0);
      expect(r.approvalNo).toMatch(/^\d{8}-\d{8}-\d{8}$/);
    }
    expect(purchases.filter((r) => r.itemSummary === '사무실 임대료')).toHaveLength(3);
    const hashes = new Set([...sales, ...purchases].map(taxInvoiceHash));
    expect(hashes.size).toBe(sales.length + purchases.length);

    const receipts = await hometax.fetchCashReceipts('purchase', range);
    expect(receipts.length).toBeGreaterThan(5);
    for (const r of receipts) {
      expect(r).toMatchObject({ direction: 'purchase', usage: 'expense_proof' });
      expect(r.totalAmount).toBe(r.supplyAmount + r.vatAmount);
    }
    const other = new MockHometaxProvider({ ...ctx, companyId: 'company-2' });
    expect(await other.fetchTaxInvoices('sales', range)).not.toEqual(sales);
  });

  it('레지스트리: 모의 공급자를 고르면 구현체가 나오고, 파일 업로드는 수집하지 않는다', async () => {
    const registry = createProviderRegistry();
    const setting = { provider: 'mock', enabled: true, credentials: {} };
    expect(registry.resolve('bank', setting, ctx)).toBeInstanceOf(MockBankProvider);
    expect(registry.resolve('card', setting, ctx)).toBeInstanceOf(MockCardProvider);
    const hometax = registry.resolve('hometax', setting, ctx);
    expect((await hometax.testConnection()).ok).toBe(true);
    expect(() => registry.resolve('bank', { ...setting, provider: 'file' }, ctx)).toThrow(
      ProviderError,
    );
  });
});
