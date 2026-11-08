import type { DateRange, HometaxProvider } from '../providers.js';
import type {
  CardApprovalRecord,
  CashReceiptRecord,
  InvoiceDirection,
  TaxInvoiceRecord,
} from '../records.js';
import type { ProviderContext } from '../registry.js';
import {
  CASH_MERCHANTS,
  CUSTOMERS,
  EXEMPT_SUPPLIER,
  LANDLORD,
  type MockParty,
  SUPPLIERS,
} from './catalog.js';
import { compactDate, eachDay, isWeekend, seededRandom } from './random.js';

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/**
 * 모의 홈택스: 회사마다 정해진 세금계산서·계산서·현금영수증을 만든다.
 * 우리 회사가 공급자면 매출, 공급받는자면 매입이다.
 */
export class MockHometaxProvider implements HometaxProvider {
  constructor(private readonly ctx: ProviderContext) {}

  async testConnection() {
    return { ok: true, message: '모의 홈택스가 준비되었습니다.' };
  }

  private get us() {
    return { name: this.ctx.companyName, bizNo: this.ctx.bizNo ?? '0000000000' };
  }

  private dayInvoices(date: string): TaxInvoiceRecord[] {
    const rng = seededRandom('hometax-invoice', this.ctx.companyId, date);
    const invoices: TaxInvoiceRecord[] = [];
    const add = (
      direction: InvoiceDirection,
      party: MockParty,
      supplyAmount: number,
      kind: TaxInvoiceRecord['kind'] = 'tax',
    ) => {
      const vatAmount = kind === 'tax' ? Math.floor(supplyAmount / 10) : 0;
      const supplier = direction === 'sales' ? this.us : party;
      const buyer = direction === 'sales' ? party : this.us;
      invoices.push({
        direction,
        kind,
        approvalNo: `${compactDate(date)}-${pad(rng.int(41_000_000, 41_999_999), 8)}-${pad(
          invoices.length + 1,
          2,
        )}${pad(rng.int(0, 999_999), 6)}`,
        issueDate: date,
        supplierBizNo: supplier.bizNo,
        supplierName: supplier.name,
        buyerBizNo: buyer.bizNo,
        buyerName: buyer.name,
        supplyAmount,
        vatAmount,
        totalAmount: supplyAmount + vatAmount,
        itemSummary: party.item,
      });
    };
    if (date.endsWith('-05')) add('purchase', LANDLORD, 2_000_000);
    if (!isWeekend(date)) {
      if (rng.chance(0.45)) {
        add('sales', rng.pick(CUSTOMERS), rng.amount(300_000, 5_000_000, 10_000));
      }
      if (rng.chance(0.35)) {
        add('purchase', rng.pick(SUPPLIERS), rng.amount(200_000, 3_000_000, 10_000));
      }
      if (rng.chance(0.05)) {
        add('purchase', EXEMPT_SUPPLIER, rng.amount(100_000, 800_000, 1_000), 'exempt');
      }
    }
    return invoices;
  }

  private dayCashReceipts(date: string): CashReceiptRecord[] {
    const rng = seededRandom('hometax-cash', this.ctx.companyId, date);
    const receipts: CashReceiptRecord[] = [];
    const approvalNo = () => `${pad(rng.int(100_000_000, 999_999_999), 9)}`;
    const split = (total: number) => {
      const supplyAmount = Math.round(total / 1.1);
      return { supplyAmount, vatAmount: total - supplyAmount, totalAmount: total };
    };
    if (rng.chance(0.3)) {
      const m = rng.pick(CASH_MERCHANTS);
      const receipt: CashReceiptRecord = {
        direction: 'purchase',
        date,
        approvalNo: approvalNo(),
        bizNo: m.bizNo,
        name: m.name,
        ...split(rng.amount(5_000, 80_000, 100)),
        usage: 'expense_proof',
        cancelled: false,
      };
      receipts.push(receipt);
      if (rng.chance(0.05)) receipts.push({ ...receipt, cancelled: true });
    }
    if (!isWeekend(date) && rng.chance(0.1)) {
      receipts.push({
        direction: 'sales',
        date,
        approvalNo: approvalNo(),
        bizNo: null,
        name: '소비자',
        ...split(rng.amount(10_000, 200_000, 1_000)),
        usage: 'income_deduction',
        cancelled: false,
      });
    }
    return receipts;
  }

  async fetchTaxInvoices(direction: InvoiceDirection, range: DateRange) {
    return eachDay(range.from, range.to)
      .flatMap((date) => this.dayInvoices(date))
      .filter((r) => r.direction === direction);
  }

  async fetchCashReceipts(direction: InvoiceDirection, range: DateRange) {
    return eachDay(range.from, range.to)
      .flatMap((date) => this.dayCashReceipts(date))
      .filter((r) => r.direction === direction);
  }

  /** 모의 홈택스는 회사 카드 목록을 모르므로 카드 매입 내역은 카드사 수집으로 대신한다 */
  async fetchCardPurchases(): Promise<CardApprovalRecord[]> {
    return [];
  }
}
