import {
  bankAccounts,
  bankTransactions,
  cardTransactions,
  cashReceipts,
  corporateCards,
  type EvidenceStatus,
  partners,
  taxInvoices,
  type Transaction,
} from '@wellbuddy/db';
import { cardCompanyName, type EvidenceRef, type UploadKind } from '@wellbuddy/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { type EvidenceItem, normalizeName } from './engine/items.js';

/** 엔진 항목 + 화면·매칭에 쓰는 정보 */
export interface LoadedItem extends EvidenceItem {
  status: EvidenceStatus;
  /** 통장 계좌·카드 별칭 */
  sourceLabel: string | null;
  card: { cardId: string; approvalNo: string } | null;
}

export interface ItemFilter {
  statuses?: EvidenceStatus[];
  refs?: EvidenceRef[];
}

const idsOf = (refs: EvidenceRef[] | undefined, kind: UploadKind) =>
  refs?.filter((r) => r.evidenceKind === kind).map((r) => r.evidenceId);

/** 이름·사업자번호 → 거래처(같은 이름이 둘 이상이면 이름으로는 찾지 않는다) */
export async function partnerLookup(tx: Transaction) {
  const rows = await tx
    .select({ id: partners.id, name: partners.name, bizRegNo: partners.bizRegNo })
    .from(partners)
    .where(eq(partners.isActive, true));
  const byBiz = new Map<string, string>();
  const byName = new Map<string, string | null>();
  for (const r of rows) {
    if (r.bizRegNo) byBiz.set(r.bizRegNo, r.id);
    const key = normalizeName(r.name);
    if (!key) continue;
    byName.set(key, byName.has(key) ? null : r.id);
  }
  return {
    byBizNo: (bizNo: string | null) => (bizNo ? (byBiz.get(bizNo) ?? null) : null),
    byName: (name: string | null) => (name ? (byName.get(normalizeName(name)) ?? null) : null),
  };
}

/** 분개할 증빙을 엔진 항목으로 읽는다 */
export async function loadItems(tx: Transaction, filter: ItemFilter): Promise<LoadedItem[]> {
  const lookup = await partnerLookup(tx);
  const items: LoadedItem[] = [];

  const bankIds = idsOf(filter.refs, 'bank');
  if (!bankIds || bankIds.length > 0) {
    const rows = await tx
      .select({
        t: bankTransactions,
        alias: bankAccounts.alias,
        ledger: bankAccounts.ledgerAccountId,
      })
      .from(bankTransactions)
      .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
      .where(
        and(
          filter.statuses ? inArray(bankTransactions.status, filter.statuses) : undefined,
          bankIds ? inArray(bankTransactions.id, bankIds) : undefined,
        ),
      );
    for (const { t, alias, ledger } of rows) {
      items.push({
        evidenceKind: 'bank',
        evidenceId: t.id,
        kind: t.deposit > 0 ? 'bank_in' : 'bank_out',
        date: t.txDate,
        description: t.description,
        counterparty: t.counterparty,
        bizNo: null,
        partnerId: lookup.byName(t.counterparty),
        amount: t.deposit > 0 ? t.deposit : t.withdrawal,
        supply: null,
        vat: null,
        vatType: 'taxable',
        ledgerAccountId: ledger,
        category: null,
        issuerName: null,
        reversal: false,
        status: t.status,
        sourceLabel: alias,
        card: null,
      });
    }
  }

  const cardIds = idsOf(filter.refs, 'card');
  if (!cardIds || cardIds.length > 0) {
    const rows = await tx
      .select({
        t: cardTransactions,
        alias: corporateCards.alias,
        ledger: corporateCards.ledgerAccountId,
        cardCompany: corporateCards.cardCompany,
      })
      .from(cardTransactions)
      .innerJoin(corporateCards, eq(corporateCards.id, cardTransactions.cardId))
      .where(
        and(
          filter.statuses ? inArray(cardTransactions.status, filter.statuses) : undefined,
          cardIds ? inArray(cardTransactions.id, cardIds) : undefined,
        ),
      );
    for (const { t, alias, ledger, cardCompany } of rows) {
      items.push({
        evidenceKind: 'card',
        evidenceId: t.id,
        kind: t.cancelled ? 'card_cancel' : 'card',
        date: t.approvedDate,
        description: t.merchantName,
        counterparty: t.merchantName,
        bizNo: t.merchantBizNo,
        partnerId: lookup.byBizNo(t.merchantBizNo),
        amount: t.amount,
        supply: null,
        vat: t.vatAmount,
        vatType: t.vatAmount === 0 ? 'exempt' : 'taxable',
        ledgerAccountId: ledger,
        category: t.category,
        issuerName: cardCompanyName(cardCompany),
        reversal: t.cancelled,
        status: t.status,
        sourceLabel: alias,
        card: { cardId: t.cardId, approvalNo: t.approvalNo },
      });
    }
  }

  const invoiceIds = idsOf(filter.refs, 'tax_invoice');
  if (!invoiceIds || invoiceIds.length > 0) {
    const rows = await tx
      .select()
      .from(taxInvoices)
      .where(
        and(
          filter.statuses ? inArray(taxInvoices.status, filter.statuses) : undefined,
          invoiceIds ? inArray(taxInvoices.id, invoiceIds) : undefined,
        ),
      );
    for (const t of rows) {
      const sales = t.direction === 'sales';
      items.push({
        evidenceKind: 'tax_invoice',
        evidenceId: t.id,
        kind: sales ? 'tax_sales' : 'tax_purchase',
        date: t.issueDate,
        description: t.itemSummary ?? '',
        counterparty: sales ? t.buyerName : t.supplierName,
        bizNo: sales ? t.buyerBizNo : t.supplierBizNo,
        partnerId: t.partnerId,
        amount: Math.abs(t.totalAmount),
        supply: Math.abs(t.supplyAmount),
        vat: Math.abs(t.vatAmount),
        vatType: t.kind === 'tax' ? 'taxable' : t.kind === 'zero' ? 'zero_rated' : 'exempt',
        ledgerAccountId: null,
        category: null,
        issuerName: null,
        reversal: t.totalAmount < 0,
        status: t.status,
        sourceLabel: null,
        card: null,
      });
    }
  }

  const receiptIds = idsOf(filter.refs, 'cash_receipt');
  if (!receiptIds || receiptIds.length > 0) {
    const rows = await tx
      .select()
      .from(cashReceipts)
      .where(
        and(
          filter.statuses ? inArray(cashReceipts.status, filter.statuses) : undefined,
          receiptIds ? inArray(cashReceipts.id, receiptIds) : undefined,
        ),
      );
    for (const t of rows) {
      items.push({
        evidenceKind: 'cash_receipt',
        evidenceId: t.id,
        kind: t.direction === 'sales' ? 'cash_sales' : 'cash_purchase',
        date: t.txDate,
        description: t.name,
        counterparty: t.name,
        bizNo: t.bizNo,
        partnerId: t.partnerId ?? lookup.byBizNo(t.bizNo),
        amount: Math.abs(t.totalAmount),
        supply: Math.abs(t.supplyAmount),
        vat: Math.abs(t.vatAmount),
        vatType: t.vatAmount === 0 ? 'exempt' : 'taxable',
        ledgerAccountId: null,
        category: null,
        issuerName: null,
        reversal: t.cancelled || t.totalAmount < 0,
        status: t.status,
        sourceLabel: null,
        card: null,
      });
    }
  }
  return items.sort(
    (a, b) => a.date.localeCompare(b.date) || a.evidenceId.localeCompare(b.evidenceId),
  );
}
