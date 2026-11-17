import type { AccountConnectInput, DateRange, HometaxProvider } from '../providers.js';
import type {
  CardApprovalRecord,
  CashReceiptRecord,
  InvoiceDirection,
  TaxInvoiceRecord,
} from '../records.js';
import { connectCodefAccount } from './account.js';
import { codefCardRecord } from './card.js';
import { CodefClient, type CodefOptions, codefDate, isoDate, listOf, pick, won } from './client.js';
import { CODEF_BUSINESS_TYPES, CODEF_HOMETAX_ORG, CODEF_PRODUCTS } from './products.js';

const digits = (v: string | null) => (v ?? '').replace(/\D/g, '');

/** 세금계산서 종류: 영세율·계산서(면세)·세금계산서(과세) */
function invoiceKind(typeText: string, vat: number): TaxInvoiceRecord['kind'] {
  if (/영세/.test(typeText)) return 'zero';
  if (/(^|[^금])계산서/.test(typeText) && !/세금계산서/.test(typeText)) return 'exempt';
  return vat === 0 && /면세/.test(typeText) ? 'exempt' : 'tax';
}

/** CODEF 전자세금계산서 한 장 → 세금계산서 */
export function codefTaxInvoice(
  item: Record<string, unknown>,
  direction: InvoiceDirection,
): TaxInvoiceRecord | null {
  const approvalNo = pick(item, ['resApprovalNo', 'resApprovalNumber']);
  const issueDate = isoDate(pick(item, ['resWriteDate', 'resIssueDate', 'resIssueDt']));
  const supply = won(pick(item, ['resSupplyValue', 'resSupplyAmount']));
  const vat = won(pick(item, ['resTaxAmt', 'resTaxAmount']));
  if (!approvalNo || !issueDate) return null;
  const total = pick(item, ['resTotalAmount', 'resTotalAmt']);
  return {
    direction,
    kind: invoiceKind(
      pick(item, ['resTaxInvoiceType', 'resETaxInvoiceType', 'resType']) ?? '',
      vat,
    ),
    approvalNo,
    issueDate,
    supplierBizNo: digits(pick(item, ['resSupplierRegNumber', 'resSupplierCorpNo'])),
    supplierName: pick(item, ['resSupplierCompanyName', 'resSupplierName']) ?? '',
    buyerBizNo: digits(pick(item, ['resContractorRegNumber', 'resBuyerRegNumber'])),
    buyerName: pick(item, ['resContractorCompanyName', 'resBuyerCompanyName']) ?? '',
    supplyAmount: supply,
    vatAmount: vat,
    totalAmount: total === null ? supply + vat : won(total),
    itemSummary: pick(item, ['resItemName', 'resItem']),
  };
}

/** CODEF 현금영수증 한 건 → 현금영수증 */
export function codefCashReceipt(
  item: Record<string, unknown>,
  direction: InvoiceDirection,
): CashReceiptRecord | null {
  const approvalNo = pick(item, ['resApprovalNo', 'resApprovalNumber']);
  const date = isoDate(pick(item, ['resUsedDate', 'resDealDate', 'resApprovalDate']));
  const total = Math.abs(won(pick(item, ['resTotalAmount', 'resUsedAmount'])));
  if (!approvalNo || !date || total === 0) return null;
  const vat = Math.abs(won(pick(item, ['resTaxAmt', 'resVAT'])));
  const supplyValue = pick(item, ['resSupplyValue', 'resSupplyAmount']);
  const usage = pick(item, ['resUsage', 'resDeductionType', 'resUseType']) ?? '';
  const cancel = pick(item, ['resCancelYN', 'resTransactionType']) ?? '';
  const bizNo = digits(pick(item, ['resMemberStoreCorpNo', 'resCorpNo', 'resRegNumber']));
  return {
    direction,
    date,
    approvalNo,
    bizNo: bizNo.length === 10 ? bizNo : null,
    name: pick(item, ['resMemberStoreName', 'resCompanyName', 'resName']) ?? '',
    supplyAmount: supplyValue === null ? total - vat : Math.abs(won(supplyValue)),
    vatAmount: vat,
    totalAmount: total,
    usage: /소득/.test(usage) ? 'income_deduction' : 'expense_proof',
    cancelled: cancel === '1' || /취소/.test(cancel),
  };
}

/** CODEF 홈택스(국세청) 세금계산서·현금영수증·사업용 카드 매입(P2-12) */
export class CodefHometaxProvider implements HometaxProvider {
  private readonly client: CodefClient;

  constructor(options: CodefOptions) {
    this.client = new CodefClient(options);
  }

  testConnection() {
    return this.client.test();
  }

  /** 홈택스는 기관이 국세청 하나라 기관 코드를 고정한다 */
  connectAccount(input: AccountConnectInput) {
    return connectCodefAccount(this.client, CODEF_BUSINESS_TYPES.hometax, {
      ...input,
      organization: CODEF_HOMETAX_ORG,
    });
  }

  private params(range: DateRange) {
    return {
      organization: CODEF_HOMETAX_ORG,
      connectedId: this.client.requireConnectedId(),
      startDate: codefDate(range.from),
      endDate: codefDate(range.to),
      orderBy: '1',
    };
  }

  async fetchTaxInvoices(direction: InvoiceDirection, range: DateRange) {
    const data = await this.client.request(CODEF_PRODUCTS.taxInvoices, {
      ...this.params(range),
      // 01 매출, 02 매입
      inquiryType: direction === 'sales' ? '01' : '02',
    });
    return listOf(data, 'resList').flatMap((i) => {
      const r = codefTaxInvoice(i, direction);
      return r ? [r] : [];
    });
  }

  async fetchCashReceipts(direction: InvoiceDirection, range: DateRange) {
    const data = await this.client.request(
      direction === 'sales' ? CODEF_PRODUCTS.cashReceiptSales : CODEF_PRODUCTS.cashReceiptPurchases,
      this.params(range),
    );
    return listOf(data, 'resList').flatMap((i) => {
      const r = codefCashReceipt(i, direction);
      return r ? [r] : [];
    });
  }

  async fetchCardPurchases(range: DateRange): Promise<CardApprovalRecord[]> {
    const data = await this.client.request(
      CODEF_PRODUCTS.businessCardPurchases,
      this.params(range),
    );
    return listOf(data, 'resList').flatMap((i) => {
      const r = codefCardRecord(i);
      return r ? [r] : [];
    });
  }
}
