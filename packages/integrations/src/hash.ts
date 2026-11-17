import { createHash } from 'node:crypto';
import type {
  BankTransactionRecord,
  CardApprovalRecord,
  CashReceiptRecord,
  TaxInvoiceRecord,
} from './records.js';

const digest = (parts: (string | number | null | undefined)[]) =>
  createHash('sha256')
    .update(
      parts.map((p) => (p === null || p === undefined ? '' : String(p).trim())).join('\u001f'),
    )
    .digest('hex');

/**
 * 중복 제거 해시. 같은 거래를 파일·모의·실연동으로 여러 번 가져와도 한 건만 남긴다.
 * - 통장: 계좌 + (고유번호가 있으면 고유번호, 없으면 일시·입출금·잔액·적요)
 *   같은 날 같은 금액 거래가 여러 건이어도 잔액이 달라 구분된다. 잔액이 없으면 같은 줄의 순번(seq)을 쓴다.
 * - 카드: 카드 + 승인번호 + 승인/취소 + 금액
 * - 세금계산서: 국세청 승인번호
 * - 현금영수증: 승인번호 + 방향 + 취소 여부
 */
export function bankTransactionHash(accountId: string, r: BankTransactionRecord, seq = 0): string {
  if (r.externalId) return digest(['bank', accountId, 'id', r.externalId]);
  return digest([
    'bank',
    accountId,
    r.date,
    r.time,
    r.deposit,
    r.withdrawal,
    r.balance ?? `#${seq}`,
    r.description,
  ]);
}

export function cardApprovalHash(cardId: string, r: CardApprovalRecord): string {
  return digest(['card', cardId, r.approvalNo, r.cancelled ? 'C' : 'A', r.amount, r.date]);
}

export function taxInvoiceHash(r: TaxInvoiceRecord): string {
  return digest(['tax', r.approvalNo.replace(/-/g, '')]);
}

export function cashReceiptHash(r: CashReceiptRecord): string {
  return digest(['cash', r.direction, r.approvalNo, r.cancelled ? 'C' : 'A']);
}

/**
 * 파일 한 개 안에서 같은 해시가 되는 줄(잔액이 없는 같은 날·같은 금액 거래)을 구분하기 위해,
 * 같은 내용의 줄마다 0,1,2… 순번을 매긴다.
 */
export function withSequence<T>(records: T[], key: (r: T) => string): { record: T; seq: number }[] {
  const seen = new Map<string, number>();
  return records.map((record) => {
    const k = key(record);
    const seq = seen.get(k) ?? 0;
    seen.set(k, seq + 1);
    return { record, seq };
  });
}
