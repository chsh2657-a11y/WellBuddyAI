import type { ProviderContext } from '../registry.js';
import type { IssuedTaxInvoice, TaxInvoiceDraft, TaxInvoiceIssuer } from '../providers.js';
import { PopbillClient, type PopbillOptions, popbillDate } from './client.js';

const TAX_TYPES = { tax: '과세', zero: '영세', exempt: '면세' } as const;

/** 팝빌 상태코드: 3xx 발행, 304 국세청 전송 완료, 305 전송 실패, 6xx 발행 취소 */
export function issueStatusOf(stateCode: number): IssuedTaxInvoice['status'] {
  if (stateCode >= 600) return 'cancelled';
  if (stateCode === 305) return 'failed';
  if (stateCode === 304) return 'sent';
  return 'issued';
}

/** 우리 초안 → 팝빌 세금계산서(정발행·정과금·영수) */
export function popbillTaxinvoice(
  draft: TaxInvoiceDraft,
  supplier: { corpNum: string; corpName: string },
) {
  const writeDate = popbillDate(draft.issueDate);
  return {
    writeDate,
    chargeDirection: '정과금',
    issueType: '정발행',
    purposeType: '영수',
    taxType: TAX_TYPES[draft.kind ?? 'tax'],
    invoicerCorpNum: supplier.corpNum,
    invoicerMgtKey: draft.mgtKey,
    invoicerCorpName: supplier.corpName,
    invoicerCEOName: draft.supplierCeoName || supplier.corpName,
    invoiceeType: '사업자',
    invoiceeCorpNum: draft.buyerBizNo.replace(/\D/g, ''),
    invoiceeCorpName: draft.buyerName,
    invoiceeCEOName: draft.buyerCeoName || draft.buyerName,
    ...(draft.buyerEmail ? { invoiceeEmail1: draft.buyerEmail } : {}),
    supplyCostTotal: String(draft.supplyAmount),
    taxTotal: String(draft.vatAmount),
    totalAmount: String(draft.supplyAmount + draft.vatAmount),
    detailList: [
      {
        serialNum: 1,
        purchaseDT: writeDate,
        itemName: draft.itemName,
        supplyCost: String(draft.supplyAmount),
        tax: String(draft.vatAmount),
      },
    ],
  };
}

/** 팝빌 전자세금계산서 발행·취소·상태조회(P2-14) */
export class PopbillTaxInvoiceIssuer implements TaxInvoiceIssuer {
  private readonly client: PopbillClient;

  constructor(
    options: PopbillOptions,
    private readonly context: Pick<ProviderContext, 'companyName'>,
  ) {
    this.client = new PopbillClient(options, ['110']);
  }

  async testConnection() {
    try {
      await this.client.request('GET', '/Taxinvoice/ChargeInfo');
      return {
        ok: true,
        message: `팝빌(${this.client.environment}) 전자세금계산서에 연결했습니다.`,
      };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async issue(draft: TaxInvoiceDraft): Promise<IssuedTaxInvoice> {
    const res = await this.client.request<{ ntsConfirmNum?: string; message?: string }>(
      'ISSUE',
      '/Taxinvoice',
      popbillTaxinvoice(draft, {
        corpNum: this.client.corpNum,
        corpName: this.context.companyName,
      }),
    );
    return {
      mgtKey: draft.mgtKey,
      approvalNo: res.ntsConfirmNum || null,
      status: 'issued',
      message: res.message,
    };
  }

  async cancel(mgtKey: string, reason: string): Promise<IssuedTaxInvoice> {
    const res = await this.client.request<{ message?: string }>(
      'CANCELISSUE',
      `/Taxinvoice/SELL/${encodeURIComponent(mgtKey)}`,
      { memo: reason },
    );
    return { mgtKey, approvalNo: null, status: 'cancelled', message: res.message };
  }

  async getStatus(mgtKey: string): Promise<IssuedTaxInvoice> {
    const info = await this.client.request<{
      stateCode?: number;
      ntsconfirmNum?: string;
      stateMemo?: string;
      ntsresult?: string;
    }>('GET', `/Taxinvoice/SELL/${encodeURIComponent(mgtKey)}`);
    return {
      mgtKey,
      approvalNo: info.ntsconfirmNum || null,
      status: issueStatusOf(Number(info.stateCode ?? 300)),
      message: info.stateMemo || info.ntsresult || undefined,
    };
  }
}
