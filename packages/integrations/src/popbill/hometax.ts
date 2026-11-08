import type { DateRange, HometaxProvider } from '../providers.js';
import type {
  CardApprovalRecord,
  CashReceiptRecord,
  InvoiceDirection,
  TaxInvoiceRecord,
} from '../records.js';
import { ProviderError } from '../registry.js';
import {
  amount,
  PopbillClient,
  type PopbillOptions,
  popbillDate,
  popbillIsoDate,
} from './client.js';

/** 홈택스 세금계산서(111)·현금영수증(141) 수집 권한 */
const SCOPES = ['111', '141'];
const PER_PAGE = 1000;

export interface PopbillHometaxOptions extends PopbillOptions {
  /** 수집 작업 상태를 다시 묻는 간격·횟수(기본 2초 × 90번 = 3분) */
  pollIntervalMs?: number;
  maxPolls?: number;
}

interface JobState {
  jobState?: number | string;
  errorCode?: number | string;
  errorReason?: string;
}

interface SearchResult<T> {
  pageCount?: number;
  list?: T[];
}

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** 팝빌 홈택스 세금계산서 목록 한 건 → 세금계산서 */
export function popbillTaxInvoice(
  item: Record<string, unknown>,
  direction: InvoiceDirection,
): TaxInvoiceRecord | null {
  const approvalNo = String(item.ntsconfirmNum ?? '').trim();
  const issueDate = popbillIsoDate(item.writeDate ?? item.issueDate);
  if (!approvalNo || !issueDate) return null;
  const taxType = String(item.taxType ?? '');
  const supply = amount(item.supplyCostTotal);
  const vat = amount(item.taxTotal);
  return {
    direction,
    kind: taxType.includes('영세') ? 'zero' : taxType.includes('면세') ? 'exempt' : 'tax',
    approvalNo,
    issueDate,
    supplierBizNo: digits(item.invoicerCorpNum),
    supplierName: String(item.invoicerCorpName ?? ''),
    buyerBizNo: digits(item.invoiceeCorpNum),
    buyerName: String(item.invoiceeCorpName ?? ''),
    supplyAmount: supply,
    vatAmount: vat,
    totalAmount: item.totalAmount === undefined ? supply + vat : amount(item.totalAmount),
    itemSummary: item.itemName ? String(item.itemName) : null,
  };
}

/** 팝빌 홈택스 현금영수증 한 건 → 현금영수증 */
export function popbillCashReceipt(
  item: Record<string, unknown>,
  direction: InvoiceDirection,
): CashReceiptRecord | null {
  const approvalNo = String(item.ntsconfirmNum ?? '').trim();
  const date = popbillIsoDate(item.tradeDate ?? item.tradeDT);
  const total = Math.abs(amount(item.totalAmount));
  if (!approvalNo || !date || total === 0) return null;
  const franchise = digits(item.franchiseCorpNum);
  const identity = digits(item.identityNum);
  const bizNo = direction === 'purchase' ? franchise : identity;
  return {
    direction,
    date,
    approvalNo,
    bizNo: bizNo.length === 10 ? bizNo : null,
    name:
      direction === 'purchase'
        ? String(item.franchiseCorpName ?? '')
        : String(item.customerName ?? '') || '현금영수증 고객',
    supplyAmount: Math.abs(amount(item.supplyCost)) + Math.abs(amount(item.serviceFee)),
    vatAmount: Math.abs(amount(item.tax)),
    totalAmount: total,
    usage: String(item.tradeUsage ?? '').includes('소득') ? 'income_deduction' : 'expense_proof',
    cancelled: String(item.tradeType ?? '').includes('취소'),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 팝빌 홈택스 수집(P2-13, CODEF 대체): 수집 작업을 요청하고 끝날 때까지 기다린 뒤 결과를 페이지로 읽는다.
 * 사업용 카드 매입은 팝빌 홈택스 수집 상품에 없어 빈 목록을 돌려준다(카드사 수집으로 대신한다).
 */
export class PopbillHometaxProvider implements HometaxProvider {
  private readonly client: PopbillClient;

  constructor(private readonly options: PopbillHometaxOptions) {
    this.client = new PopbillClient(options, SCOPES);
  }

  async testConnection() {
    try {
      // 홈택스 인증서(공동인증서) 등록 확인: 수집에 꼭 필요하다
      await this.client.request('GET', '/HomeTax/Taxinvoice/CertCheck');
      return {
        ok: true,
        message: `팝빌(${this.client.environment}) 홈택스 인증서가 확인되었습니다.`,
      };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  /** 작업 요청 → 상태 확인(완료까지) → 모든 페이지 읽기 */
  private async collect<T>(
    base: '/HomeTax/Taxinvoice' | '/HomeTax/Cashbill',
    requestUri: string,
    searchQuery: string,
  ): Promise<T[]> {
    const { jobID } = await this.client.request<{ jobID?: string }>('POST', requestUri);
    if (!jobID)
      throw new ProviderError('PROVIDER_FAILED', '팝빌 수집 작업 번호를 받지 못했습니다.');
    const maxPolls = this.options.maxPolls ?? 90;
    let state: JobState = {};
    for (let i = 0; i < maxPolls; i += 1) {
      state = await this.client.request<JobState>('GET', `${base}/${jobID}/State`);
      if (Number(state.jobState) === 3) break;
      await sleep(this.options.pollIntervalMs ?? 2_000);
    }
    if (Number(state.jobState) !== 3) {
      throw new ProviderError(
        'PROVIDER_FAILED',
        '홈택스 수집이 오래 걸립니다. 잠시 뒤 다시 수집해 주세요.',
      );
    }
    if (Number(state.errorCode) !== 1) {
      throw new ProviderError(
        'PROVIDER_FAILED',
        `홈택스 수집이 실패했습니다: ${state.errorReason ?? `오류 ${state.errorCode}`}`,
      );
    }
    const items: T[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.client.request<SearchResult<T>>(
        'GET',
        `${base}/${jobID}?${searchQuery}&Page=${page}&PerPage=${PER_PAGE}&Order=D`,
      );
      items.push(...(result.list ?? []));
      if (page >= (result.pageCount ?? 1)) break;
    }
    return items;
  }

  async fetchTaxInvoices(direction: InvoiceDirection, range: DateRange) {
    const type = direction === 'sales' ? 'SELL' : 'BUY';
    // DType=W: 작성일자 기준
    const items = await this.collect<Record<string, unknown>>(
      '/HomeTax/Taxinvoice',
      `/HomeTax/Taxinvoice/${type}?DType=W&SDate=${popbillDate(range.from)}&EDate=${popbillDate(range.to)}`,
      'Type=',
    );
    return items.flatMap((i) => {
      const r = popbillTaxInvoice(i, direction);
      return r ? [r] : [];
    });
  }

  async fetchCashReceipts(direction: InvoiceDirection, range: DateRange) {
    const type = direction === 'sales' ? 'SELL' : 'BUY';
    const items = await this.collect<Record<string, unknown>>(
      '/HomeTax/Cashbill',
      `/HomeTax/Cashbill/${type}?SDate=${popbillDate(range.from)}&EDate=${popbillDate(range.to)}`,
      'TradeType=',
    );
    return items.flatMap((i) => {
      const r = popbillCashReceipt(i, direction);
      return r ? [r] : [];
    });
  }

  async fetchCardPurchases(): Promise<CardApprovalRecord[]> {
    return [];
  }
}
