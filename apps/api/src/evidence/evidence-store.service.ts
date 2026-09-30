import { Injectable } from '@nestjs/common';
import {
  type EvidenceSource,
  bankTransactions,
  cardTransactions,
  cashReceipts,
  collectionRuns,
  integrationSettings,
  partners,
  taxInvoices,
  type Transaction,
} from '@wellbuddy/db';
import {
  bankTransactionHash,
  type BankTransactionRecord,
  cardApprovalHash,
  type CardApprovalRecord,
  cashReceiptHash,
  type CashReceiptRecord,
  taxInvoiceHash,
  type TaxInvoiceRecord,
  withSequence,
} from '@wellbuddy/integrations';
import { eq, inArray, sql } from 'drizzle-orm';
import { matchCardPurchases } from '../auto-journal/engine/matching.js';
import { requireCompanyContext } from '../common/request-context.js';

export interface InsertResult {
  fetched: number;
  inserted: number;
  duplicates: number;
}

const CHUNK = 500;

/**
 * 수집한 원천 기록을 저장한다. 회사별 중복 해시 유니크 인덱스로 이미 있는 기록은 건너뛴다.
 * 파일 업로드·모의·실연동이 모두 이 경로를 쓴다.
 */
@Injectable()
export class EvidenceStore {
  async startRun(
    tx: Transaction,
    channel: string,
    provider: string,
    trigger: 'manual' | 'schedule' | 'file',
  ) {
    const { companyId, userId } = requireCompanyContext();
    const [run] = await tx
      .insert(collectionRuns)
      .values({ companyId, channel, provider, trigger, status: 'running', createdBy: userId })
      .returning({ id: collectionRuns.id });
    return run!.id;
  }

  async finishRun(
    tx: Transaction,
    runId: string,
    channel: string,
    result: InsertResult & { status: 'success' | 'error'; message: string },
  ) {
    await tx
      .update(collectionRuns)
      .set({ ...result, finishedAt: new Date() })
      .where(eq(collectionRuns.id, runId));
    // 연동관리 화면의 "마지막 수집 결과"
    await tx
      .update(integrationSettings)
      .set({ lastStatus: result.status, lastMessage: result.message, lastRunAt: new Date() })
      .where(eq(integrationSettings.channel, channel));
  }

  /** 이미 저장된 해시(미리보기에서 중복 건수를 보여 줄 때) */
  async existingHashes(
    tx: Transaction,
    kind: 'bank' | 'card' | 'tax_invoice' | 'cash_receipt',
    hashes: string[],
  ): Promise<Set<string>> {
    if (hashes.length === 0) return new Set();
    const table = {
      bank: bankTransactions,
      card: cardTransactions,
      tax_invoice: taxInvoices,
      cash_receipt: cashReceipts,
    }[kind];
    const found = new Set<string>();
    for (let i = 0; i < hashes.length; i += CHUNK) {
      const rows = await tx
        .select({ hash: table.dedupeHash })
        .from(table)
        .where(inArray(table.dedupeHash, hashes.slice(i, i + CHUNK)));
      for (const r of rows) found.add(r.hash);
    }
    return found;
  }

  bankHashes(bankAccountId: string, records: BankTransactionRecord[]) {
    return withSequence(records, (r) => bankTransactionHash(bankAccountId, r)).map(
      ({ record, seq }) => bankTransactionHash(bankAccountId, record, seq),
    );
  }

  cardHashes(cardId: string, records: CardApprovalRecord[]) {
    return records.map((r) => cardApprovalHash(cardId, r));
  }

  private async insertChunks<T extends object>(
    rows: T[],
    insert: (chunk: T[]) => Promise<{ id: string }[]>,
  ): Promise<InsertResult> {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      inserted += (await insert(rows.slice(i, i + CHUNK))).length;
    }
    return { fetched: rows.length, inserted, duplicates: rows.length - inserted };
  }

  async insertBank(
    tx: Transaction,
    bankAccountId: string,
    records: BankTransactionRecord[],
    source: EvidenceSource,
    runId: string,
  ): Promise<InsertResult> {
    const { companyId } = requireCompanyContext();
    const hashes = this.bankHashes(bankAccountId, records);
    const rows = records.map((r, i) => ({
      companyId,
      bankAccountId,
      txDate: r.date,
      txTime: r.time ?? null,
      description: r.description,
      counterparty: r.counterparty ?? null,
      deposit: r.deposit,
      withdrawal: r.withdrawal,
      balance: r.balance ?? null,
      memo: r.memo ?? null,
      source,
      dedupeHash: hashes[i]!,
      collectionRunId: runId,
    }));
    return this.insertChunks(rows, (chunk) =>
      tx
        .insert(bankTransactions)
        .values(chunk)
        .onConflictDoNothing({ target: [bankTransactions.companyId, bankTransactions.dedupeHash] })
        .returning({ id: bankTransactions.id }),
    );
  }

  async insertCards(
    tx: Transaction,
    cardId: string,
    records: CardApprovalRecord[],
    source: EvidenceSource,
    runId: string,
  ): Promise<InsertResult> {
    const { companyId } = requireCompanyContext();
    const rows = records.map((r) => ({
      companyId,
      cardId,
      approvedDate: r.date,
      approvedTime: r.time ?? null,
      merchantName: r.merchantName,
      merchantBizNo: r.merchantBizNo ?? null,
      amount: r.amount,
      vatAmount: r.vatAmount ?? null,
      approvalNo: r.approvalNo,
      installmentMonths: r.installmentMonths ?? null,
      cancelled: r.cancelled,
      category: r.category ?? null,
      source,
      dedupeHash: cardApprovalHash(cardId, r),
      collectionRunId: runId,
    }));
    return this.insertChunks(rows, (chunk) =>
      tx
        .insert(cardTransactions)
        .values(chunk)
        .onConflictDoNothing({ target: [cardTransactions.companyId, cardTransactions.dedupeHash] })
        .returning({ id: cardTransactions.id }),
    );
  }

  /**
   * 홈택스 카드매입(P2-19)을 카드 승인과 맞춰, 카드사 자료에 없던 가맹점 사업자번호·부가세를 채운다.
   * 이미 값이 있으면 그대로 둔다. 맞춘 건수를 돌려준다.
   */
  async enrichCards(tx: Transaction, purchases: CardApprovalRecord[]): Promise<number> {
    if (purchases.length === 0) return 0;
    const approvalNos = [...new Set(purchases.map((p) => p.approvalNo))];
    const cards = await tx
      .select()
      .from(cardTransactions)
      .where(inArray(cardTransactions.approvalNo, approvalNos));
    const matches = matchCardPurchases(
      purchases,
      cards.map((c) => ({
        id: c.id,
        cardId: c.cardId,
        approvalNo: c.approvalNo,
        amount: c.amount,
        cancelled: c.cancelled,
        date: c.approvedDate,
        merchantBizNo: c.merchantBizNo,
      })),
    );
    for (const m of matches) {
      await tx
        .update(cardTransactions)
        .set({
          merchantBizNo: sql`coalesce(${cardTransactions.merchantBizNo}, ${m.merchantBizNo})`,
          vatAmount: sql`coalesce(${cardTransactions.vatAmount}, ${m.vatAmount}::bigint)`,
          updatedAt: new Date(),
        })
        .where(eq(cardTransactions.id, m.cardTransactionId));
    }
    return matches.length;
  }

  /** 사업자번호 → 거래처 */
  private async partnersByBizNo(tx: Transaction, bizNos: (string | null | undefined)[]) {
    const list = [...new Set(bizNos.filter((b): b is string => !!b))];
    if (list.length === 0) return new Map<string, string>();
    const rows = await tx
      .select({ id: partners.id, bizRegNo: partners.bizRegNo })
      .from(partners)
      .where(inArray(partners.bizRegNo, list));
    return new Map(rows.map((r) => [r.bizRegNo!, r.id]));
  }

  /** runId 는 수집 실행 기록(전자세금계산서 발행으로 만든 매출 세금계산서는 null) */
  async insertTaxInvoices(
    tx: Transaction,
    records: TaxInvoiceRecord[],
    source: EvidenceSource,
    runId: string | null,
  ): Promise<InsertResult> {
    const { companyId } = requireCompanyContext();
    const counterpart = (r: TaxInvoiceRecord) =>
      r.direction === 'sales' ? r.buyerBizNo : r.supplierBizNo;
    const byBizNo = await this.partnersByBizNo(tx, records.map(counterpart));
    const rows = records.map((r) => ({
      companyId,
      direction: r.direction,
      kind: r.kind,
      approvalNo: r.approvalNo,
      issueDate: r.issueDate,
      supplierBizNo: r.supplierBizNo,
      supplierName: r.supplierName,
      buyerBizNo: r.buyerBizNo,
      buyerName: r.buyerName,
      supplyAmount: r.supplyAmount,
      vatAmount: r.vatAmount,
      totalAmount: r.totalAmount,
      itemSummary: r.itemSummary ?? null,
      partnerId: byBizNo.get(counterpart(r)) ?? null,
      source,
      dedupeHash: taxInvoiceHash(r),
      collectionRunId: runId,
    }));
    return this.insertChunks(rows, (chunk) =>
      tx
        .insert(taxInvoices)
        .values(chunk)
        .onConflictDoNothing({ target: [taxInvoices.companyId, taxInvoices.dedupeHash] })
        .returning({ id: taxInvoices.id }),
    );
  }

  async insertCashReceipts(
    tx: Transaction,
    records: CashReceiptRecord[],
    source: EvidenceSource,
    runId: string,
  ): Promise<InsertResult> {
    const { companyId } = requireCompanyContext();
    const byBizNo = await this.partnersByBizNo(
      tx,
      records.map((r) => r.bizNo),
    );
    const rows = records.map((r) => ({
      companyId,
      direction: r.direction,
      txDate: r.date,
      approvalNo: r.approvalNo,
      bizNo: r.bizNo ?? null,
      name: r.name,
      supplyAmount: r.supplyAmount,
      vatAmount: r.vatAmount,
      totalAmount: r.totalAmount,
      usage: r.usage,
      cancelled: r.cancelled,
      partnerId: r.bizNo ? (byBizNo.get(r.bizNo) ?? null) : null,
      source,
      dedupeHash: cashReceiptHash(r),
      collectionRunId: runId,
    }));
    return this.insertChunks(rows, (chunk) =>
      tx
        .insert(cashReceipts)
        .values(chunk)
        .onConflictDoNothing({ target: [cashReceipts.companyId, cashReceipts.dedupeHash] })
        .returning({ id: cashReceipts.id }),
    );
  }
}
