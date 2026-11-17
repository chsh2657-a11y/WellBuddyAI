import type { AccountConnectInput, CardProvider, CardRef, DateRange } from '../providers.js';
import type { CardApprovalRecord } from '../records.js';
import { connectCodefAccount } from './account.js';
import {
  CodefClient,
  type CodefOptions,
  codefDate,
  isoDate,
  isoTime,
  listOf,
  pick,
  won,
} from './client.js';
import { CODEF_BUSINESS_TYPES, CODEF_PRODUCTS } from './products.js';

/** CODEF 카드 승인 한 건 → 카드 승인(거절은 null). 취소는 cancelled, 금액은 양수 */
export function codefCardRecord(item: Record<string, unknown>): CardApprovalRecord | null {
  const date = isoDate(pick(item, ['resUsedDate', 'resApprovalDate']));
  const approvalNo = pick(item, ['resApprovalNo', 'resApprovalNumber']);
  const amount = Math.abs(won(pick(item, ['resUsedAmount', 'resApprovalAmount'])));
  // resCancelYN: 0 정상, 1 취소, 2 부분취소, 3 거절
  const cancel = pick(item, ['resCancelYN']) ?? '0';
  if (!date || !approvalNo || amount === 0 || cancel === '3') return null;
  const vat = pick(item, ['resVAT', 'resVat']);
  const installment = Number(pick(item, ['resInstallmentMonth']) ?? 0);
  const bizNo = pick(item, ['resMemberStoreCorpNo', 'resMemberStoreBizNo'])?.replace(/\D/g, '');
  return {
    date,
    time: isoTime(pick(item, ['resUsedTime', 'resApprovalTime'])),
    merchantName: pick(item, ['resMemberStoreName']) ?? '(가맹점 없음)',
    merchantBizNo: bizNo && bizNo.length === 10 ? bizNo : null,
    amount,
    vatAmount: vat === null ? null : Math.abs(won(vat)),
    approvalNo,
    installmentMonths: installment > 1 ? installment : null,
    cancelled: cancel === '1' || cancel === '2',
    category: pick(item, ['resMemberStoreType']),
  };
}

const last4 = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').slice(-4);

/** CODEF 법인카드 승인내역(P2-11) */
export class CodefCardProvider implements CardProvider {
  private readonly client: CodefClient;

  constructor(options: CodefOptions) {
    this.client = new CodefClient(options);
  }

  testConnection() {
    return this.client.test();
  }

  connectAccount(input: AccountConnectInput) {
    return connectCodefAccount(this.client, CODEF_BUSINESS_TYPES.card, input);
  }

  async fetchApprovals(card: CardRef, range: DateRange): Promise<CardApprovalRecord[]> {
    const data = await this.client.request(CODEF_PRODUCTS.cardApprovals, {
      connectedId: this.client.requireConnectedId(),
      organization: card.cardCompany,
      startDate: codefDate(range.from),
      endDate: codefDate(range.to),
      orderBy: '1',
      // 1: 카드번호로 조회, 가맹점 정보(사업자번호·업종) 포함
      inquiryType: '1',
      cardNo: card.cardNo,
      memberStoreInfoType: '1',
    });
    const mine = last4(card.cardNo);
    return listOf(data).flatMap((item) => {
      // 여러 카드가 섞여 오면 끝 4자리로 이 카드 것만 고른다
      const cardNo = pick(item, ['resCardNo']);
      if (cardNo && last4(cardNo) && last4(cardNo) !== mine) return [];
      const record = codefCardRecord(item);
      return record && record.date >= range.from && record.date <= range.to ? [record] : [];
    });
  }
}
