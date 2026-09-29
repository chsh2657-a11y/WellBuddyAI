import type {
  BankTransactionRecord,
  CardApprovalRecord,
  CashReceiptRecord,
  InvoiceDirection,
  ReceiptFields,
  TaxInvoiceRecord,
} from './records.js';

export interface ConnectionResult {
  ok: boolean;
  message: string;
}

export interface DateRange {
  from: string;
  to: string;
}

/** 수집 대상 계좌(공급자에 넘기는 정보) */
export interface BankAccountRef {
  id: string;
  bankCode: string;
  accountNo: string;
}

export interface CardRef {
  id: string;
  cardCompany: string;
  cardNo: string;
}

interface Connectable {
  testConnection(): Promise<ConnectionResult>;
}

export interface BankProvider extends Connectable {
  fetchTransactions(account: BankAccountRef, range: DateRange): Promise<BankTransactionRecord[]>;
}

export interface CardProvider extends Connectable {
  fetchApprovals(card: CardRef, range: DateRange): Promise<CardApprovalRecord[]>;
}

export interface HometaxProvider extends Connectable {
  fetchTaxInvoices(direction: InvoiceDirection, range: DateRange): Promise<TaxInvoiceRecord[]>;
  fetchCashReceipts(direction: InvoiceDirection, range: DateRange): Promise<CashReceiptRecord[]>;
  /** 사업용 카드 매입 내역(홈택스 등록 카드) */
  fetchCardPurchases(range: DateRange): Promise<CardApprovalRecord[]>;
}

export interface TaxInvoiceDraft {
  issueDate: string;
  buyerBizNo: string;
  buyerName: string;
  buyerEmail?: string | null;
  supplyAmount: number;
  vatAmount: number;
  itemName: string;
  /** 우리 쪽 관리번호(중복 발행 방지) */
  mgtKey: string;
}

export interface IssuedTaxInvoice {
  mgtKey: string;
  approvalNo: string | null;
  status: 'issued' | 'sent' | 'cancelled' | 'failed';
  message?: string;
}

export interface TaxInvoiceIssuer extends Connectable {
  issue(draft: TaxInvoiceDraft): Promise<IssuedTaxInvoice>;
  cancel(mgtKey: string, reason: string): Promise<IssuedTaxInvoice>;
  getStatus(mgtKey: string): Promise<IssuedTaxInvoice>;
}

export interface OcrProvider extends Connectable {
  extractReceipt(file: {
    data: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<ReceiptFields>;
}

/** AI 분류에 넘기는 거래와 회사 맥락 */
export interface ClassifyInput {
  kind: 'bank' | 'card' | 'tax_invoice' | 'cash_receipt' | 'receipt';
  date: string;
  description: string;
  counterparty: string | null;
  /** 입금 + / 출금 − (카드·매입은 −) */
  amount: number;
  vatAmount?: number | null;
}

export interface ClassifyContext {
  /** 고를 수 있는 계정(코드·이름·구분) */
  accounts: { code: string; name: string; category: string }[];
  /** 같은 거래처·적요의 과거 분개 예시 */
  examples: { description: string; counterparty: string | null; accountCode: string }[];
}

export interface ClassifySuggestion {
  accountCode: string;
  /** 과세·불공제 등 부가세 처리 */
  vatType: 'taxable' | 'zero_rated' | 'exempt' | 'non_deductible' | 'none';
  confidence: number;
  reason: string;
}

export interface AiClassifier extends Connectable {
  classify(input: ClassifyInput, context: ClassifyContext): Promise<ClassifySuggestion>;
}

export interface ChannelProviders {
  bank: BankProvider;
  card: CardProvider;
  hometax: HometaxProvider;
  taxinvoice: TaxInvoiceIssuer;
  ocr: OcrProvider;
  ai: AiClassifier;
}
export type ProviderChannel = keyof ChannelProviders;
