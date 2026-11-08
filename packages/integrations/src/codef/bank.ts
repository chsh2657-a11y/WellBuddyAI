import type { AccountConnectInput, BankAccountRef, BankProvider, DateRange } from '../providers.js';
import type { BankTransactionRecord } from '../records.js';
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

/** CODEF 은행 응답 한 줄 → 통장 거래 */
export function codefBankRecord(item: Record<string, unknown>): BankTransactionRecord | null {
  const date = isoDate(pick(item, ['resAccountTrDate', 'resTrDate']));
  const deposit = Math.abs(won(pick(item, ['resAccountIn', 'resInAmount'])));
  const withdrawal = Math.abs(won(pick(item, ['resAccountOut', 'resOutAmount'])));
  if (!date || deposit + withdrawal === 0) return null;
  const desc = [1, 2, 3, 4].map((i) => pick(item, [`resAccountDesc${i}`]));
  const balance = pick(item, ['resAfterTranBalance', 'resAccountBalance']);
  return {
    date,
    time: isoTime(pick(item, ['resAccountTrTime', 'resTrTime'])),
    // 은행마다 조금 다르지만 대개 1·2 는 거래 구분·적요, 3 은 받는 분·보낸 분, 4 는 거래점·메모
    description: [desc[0], desc[1]].filter(Boolean).join(' ') || desc[2] || '(적요 없음)',
    counterparty: desc[2],
    deposit,
    withdrawal,
    balance: balance === null ? null : won(balance),
    memo: desc[3],
    externalId: null,
  };
}

/** CODEF 기업 은행 거래내역(P2-10) */
export class CodefBankProvider implements BankProvider {
  private readonly client: CodefClient;

  constructor(options: CodefOptions) {
    this.client = new CodefClient(options);
  }

  testConnection() {
    return this.client.test();
  }

  connectAccount(input: AccountConnectInput) {
    return connectCodefAccount(this.client, CODEF_BUSINESS_TYPES.bank, input);
  }

  async fetchTransactions(
    account: BankAccountRef,
    range: DateRange,
  ): Promise<BankTransactionRecord[]> {
    const data = await this.client.request(CODEF_PRODUCTS.bankTransactions, {
      connectedId: this.client.requireConnectedId(),
      organization: account.bankCode,
      account: account.accountNo,
      startDate: codefDate(range.from),
      endDate: codefDate(range.to),
      orderBy: '1',
    });
    return listOf(data, 'resTrHistoryList').flatMap((item) => {
      const record = codefBankRecord(item);
      return record && record.date >= range.from && record.date <= range.to ? [record] : [];
    });
  }
}
