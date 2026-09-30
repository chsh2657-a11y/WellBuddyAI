import { createHash } from 'node:crypto';
import type { IssuedTaxInvoice, TaxInvoiceDraft, TaxInvoiceIssuer } from '../providers.js';

/** 관리번호로 정해지는 모의 국세청 승인번호(24자리: 작성일 8 + 41000000 + 8) */
export function mockApprovalNo(mgtKey: string, issueDate: string): string {
  const n = createHash('sha256').update(mgtKey).digest().readUInt32BE(0) % 100_000_000;
  return `${issueDate.replaceAll('-', '')}41000000${String(n).padStart(8, '0')}`;
}

/** 모의 전자세금계산서 발행(국세청 전송 없음). 발행하면 곧바로 전송 완료로 본다 */
export class MockTaxInvoiceIssuer implements TaxInvoiceIssuer {
  async testConnection() {
    return { ok: true, message: '모의 발행이 준비되었습니다(국세청 전송 없음).' };
  }

  async issue(draft: TaxInvoiceDraft): Promise<IssuedTaxInvoice> {
    return {
      mgtKey: draft.mgtKey,
      approvalNo: mockApprovalNo(draft.mgtKey, draft.issueDate),
      status: 'issued',
      message: '모의 발행입니다(국세청에 전송하지 않음).',
    };
  }

  async cancel(mgtKey: string): Promise<IssuedTaxInvoice> {
    return { mgtKey, approvalNo: null, status: 'cancelled', message: '모의 발행을 취소했습니다.' };
  }

  async getStatus(mgtKey: string): Promise<IssuedTaxInvoice> {
    return { mgtKey, approvalNo: null, status: 'sent', message: '모의 전송 완료' };
  }
}
