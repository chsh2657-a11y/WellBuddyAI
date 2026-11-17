import { describe, expect, it } from 'vitest';
import {
  bankTransactionHash,
  cardApprovalHash,
  cashReceiptHash,
  taxInvoiceHash,
  withSequence,
} from './hash.js';
import type { BankTransactionRecord } from './records.js';

const tx = (patch: Partial<BankTransactionRecord> = {}): BankTransactionRecord => ({
  date: '2026-03-10',
  time: '10:00:00',
  description: '급여',
  deposit: 0,
  withdrawal: 50_000,
  balance: 950_000,
  ...patch,
});

describe('중복 제거 해시', () => {
  it('통장: 같은 거래는 같은 해시, 계좌·금액·잔액이 다르면 다른 해시', () => {
    expect(bankTransactionHash('A', tx())).toBe(
      bankTransactionHash('A', tx({ description: ' 급여 ' })),
    );
    expect(bankTransactionHash('A', tx())).not.toBe(bankTransactionHash('B', tx()));
    expect(bankTransactionHash('A', tx())).not.toBe(
      bankTransactionHash('A', tx({ balance: 900_000 })),
    );
    // 공급자 고유번호가 있으면 그것만 본다
    expect(bankTransactionHash('A', tx({ externalId: 'X1' }))).toBe(
      bankTransactionHash('A', tx({ externalId: 'X1', description: '다름' })),
    );
  });

  it('잔액이 없는 같은 날·같은 금액 거래는 파일 안 순번으로 구분한다', () => {
    const rows = [
      tx({ balance: null }),
      tx({ balance: null }),
      tx({ balance: null, withdrawal: 1 }),
    ];
    const seq = withSequence(rows, (r) => bankTransactionHash('A', r));
    expect(seq.map((s) => s.seq)).toEqual([0, 1, 0]);
    const hashes = seq.map((s) => bankTransactionHash('A', s.record, s.seq));
    expect(new Set(hashes).size).toBe(3);
  });

  it('카드·세금계산서·현금영수증', () => {
    const card = {
      date: '2026-03-10',
      merchantName: '김밥천국',
      amount: 8_000,
      approvalNo: '12345678',
      cancelled: false,
    };
    expect(cardApprovalHash('C', card)).not.toBe(
      cardApprovalHash('C', { ...card, cancelled: true }),
    );
    const invoice = {
      direction: 'purchase' as const,
      kind: 'tax' as const,
      approvalNo: '20260310-41000000-12345678',
      issueDate: '2026-03-10',
      supplierBizNo: '1248100998',
      supplierName: '공급자',
      buyerBizNo: '2208112341',
      buyerName: '우리',
      supplyAmount: 100_000,
      vatAmount: 10_000,
      totalAmount: 110_000,
    };
    expect(taxInvoiceHash(invoice)).toBe(
      taxInvoiceHash({ ...invoice, approvalNo: '202603104100000012345678' }),
    );
    const receipt = {
      direction: 'purchase' as const,
      date: '2026-03-10',
      approvalNo: 'A1',
      name: '문구점',
      supplyAmount: 10_000,
      vatAmount: 1_000,
      totalAmount: 11_000,
      usage: 'expense_proof' as const,
      cancelled: false,
    };
    expect(cashReceiptHash(receipt)).not.toBe(cashReceiptHash({ ...receipt, direction: 'sales' }));
  });
});
