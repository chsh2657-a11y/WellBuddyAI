import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  bankAccounts,
  bankTransactions,
  cardTransactions,
  cashReceipts,
  collectionRuns,
  corporateCards,
  journalEntries,
  partners,
  taxInvoices,
} from '@wellbuddy/db';
import { type EvidenceListQuery, formatJournalNo, type UploadKind } from '@wellbuddy/shared';
import { type AnyColumn, and, desc, eq, gte, lte } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { DbService } from '../db/db.service.js';

const TABLES = {
  bank: bankTransactions,
  card: cardTransactions,
  tax_invoice: taxInvoices,
  cash_receipt: cashReceipts,
} as const;

const entryNumber = (date: string | null, no: number | null) =>
  date && no !== null ? formatJournalNo(date, no) : null;

/** 수집한 증빙 조회, 제외 처리, 수집 이력 */
@Injectable()
export class EvidenceService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private range(column: AnyColumn, q: EvidenceListQuery) {
    return [q.from ? gte(column, q.from) : undefined, q.to ? lte(column, q.to) : undefined];
  }

  async bankTransactions(q: EvidenceListQuery) {
    return this.db.tenant(async (tx) => {
      const rows = await tx
        .select({
          t: bankTransactions,
          accountAlias: bankAccounts.alias,
          entryDate: journalEntries.entryDate,
          entryNo: journalEntries.entryNo,
        })
        .from(bankTransactions)
        .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
        .leftJoin(journalEntries, eq(journalEntries.id, bankTransactions.entryId))
        .where(
          and(
            q.sourceId ? eq(bankTransactions.bankAccountId, q.sourceId) : undefined,
            q.status ? eq(bankTransactions.status, q.status) : undefined,
            ...this.range(bankTransactions.txDate, q),
          ),
        )
        .orderBy(
          desc(bankTransactions.txDate),
          desc(bankTransactions.txTime),
          desc(bankTransactions.createdAt),
        )
        .limit(1000);
      return rows.map(({ t, accountAlias, entryDate, entryNo }) => ({
        id: t.id,
        bankAccountId: t.bankAccountId,
        accountAlias,
        txDate: t.txDate,
        txTime: t.txTime,
        description: t.description,
        counterparty: t.counterparty,
        deposit: t.deposit,
        withdrawal: t.withdrawal,
        balance: t.balance,
        memo: t.memo,
        source: t.source,
        status: t.status,
        entryId: t.entryId,
        entryNumber: entryNumber(entryDate, entryNo),
      }));
    });
  }

  async cardTransactions(q: EvidenceListQuery) {
    return this.db.tenant(async (tx) => {
      const rows = await tx
        .select({
          t: cardTransactions,
          cardAlias: corporateCards.alias,
          entryDate: journalEntries.entryDate,
          entryNo: journalEntries.entryNo,
        })
        .from(cardTransactions)
        .innerJoin(corporateCards, eq(corporateCards.id, cardTransactions.cardId))
        .leftJoin(journalEntries, eq(journalEntries.id, cardTransactions.entryId))
        .where(
          and(
            q.sourceId ? eq(cardTransactions.cardId, q.sourceId) : undefined,
            q.status ? eq(cardTransactions.status, q.status) : undefined,
            ...this.range(cardTransactions.approvedDate, q),
          ),
        )
        .orderBy(desc(cardTransactions.approvedDate), desc(cardTransactions.approvedTime))
        .limit(1000);
      return rows.map(({ t, cardAlias, entryDate, entryNo }) => ({
        id: t.id,
        cardId: t.cardId,
        cardAlias,
        approvedDate: t.approvedDate,
        approvedTime: t.approvedTime,
        merchantName: t.merchantName,
        merchantBizNo: t.merchantBizNo,
        amount: t.amount,
        vatAmount: t.vatAmount,
        approvalNo: t.approvalNo,
        installmentMonths: t.installmentMonths,
        cancelled: t.cancelled,
        category: t.category,
        source: t.source,
        status: t.status,
        entryId: t.entryId,
        entryNumber: entryNumber(entryDate, entryNo),
      }));
    });
  }

  async taxInvoices(q: EvidenceListQuery) {
    return this.db.tenant(async (tx) => {
      const rows = await tx
        .select({
          t: taxInvoices,
          partnerName: partners.name,
          entryDate: journalEntries.entryDate,
          entryNo: journalEntries.entryNo,
        })
        .from(taxInvoices)
        .leftJoin(partners, eq(partners.id, taxInvoices.partnerId))
        .leftJoin(journalEntries, eq(journalEntries.id, taxInvoices.entryId))
        .where(
          and(
            q.direction ? eq(taxInvoices.direction, q.direction) : undefined,
            q.status ? eq(taxInvoices.status, q.status) : undefined,
            ...this.range(taxInvoices.issueDate, q),
          ),
        )
        .orderBy(desc(taxInvoices.issueDate), desc(taxInvoices.createdAt))
        .limit(1000);
      return rows.map(({ t, partnerName, entryDate, entryNo }) => ({
        id: t.id,
        direction: t.direction,
        kind: t.kind,
        approvalNo: t.approvalNo,
        issueDate: t.issueDate,
        supplierBizNo: t.supplierBizNo,
        supplierName: t.supplierName,
        buyerBizNo: t.buyerBizNo,
        buyerName: t.buyerName,
        supplyAmount: t.supplyAmount,
        vatAmount: t.vatAmount,
        totalAmount: t.totalAmount,
        itemSummary: t.itemSummary,
        partnerId: t.partnerId,
        partnerName,
        source: t.source,
        status: t.status,
        entryId: t.entryId,
        entryNumber: entryNumber(entryDate, entryNo),
      }));
    });
  }

  async cashReceipts(q: EvidenceListQuery) {
    return this.db.tenant(async (tx) => {
      const rows = await tx
        .select({
          t: cashReceipts,
          partnerName: partners.name,
          entryDate: journalEntries.entryDate,
          entryNo: journalEntries.entryNo,
        })
        .from(cashReceipts)
        .leftJoin(partners, eq(partners.id, cashReceipts.partnerId))
        .leftJoin(journalEntries, eq(journalEntries.id, cashReceipts.entryId))
        .where(
          and(
            q.direction ? eq(cashReceipts.direction, q.direction) : undefined,
            q.status ? eq(cashReceipts.status, q.status) : undefined,
            ...this.range(cashReceipts.txDate, q),
          ),
        )
        .orderBy(desc(cashReceipts.txDate), desc(cashReceipts.createdAt))
        .limit(1000);
      return rows.map(({ t, partnerName, entryDate, entryNo }) => ({
        id: t.id,
        direction: t.direction,
        txDate: t.txDate,
        approvalNo: t.approvalNo,
        bizNo: t.bizNo,
        name: t.name,
        supplyAmount: t.supplyAmount,
        vatAmount: t.vatAmount,
        totalAmount: t.totalAmount,
        usage: t.usage,
        cancelled: t.cancelled,
        partnerId: t.partnerId,
        partnerName,
        source: t.source,
        status: t.status,
        entryId: t.entryId,
        entryNumber: entryNumber(entryDate, entryNo),
      }));
    });
  }

  /** 제외(개인 사용분·중복 등) 또는 되살리기. 전표와 연결된 증빙은 바꾸지 않는다 */
  async setStatus(kind: UploadKind, id: string, status: 'pending' | 'ignored') {
    const table = TABLES[kind];
    await this.db.tenant(async (tx) => {
      const [row] = await tx
        .select({ status: table.status, entryId: table.entryId })
        .from(table)
        .where(eq(table.id, id));
      if (!row) throw new NotFoundException();
      if (row.entryId || row.status === 'posted') {
        throw new AppException(
          'EVIDENCE_POSTED',
          '전표와 연결된 증빙입니다. 전표를 먼저 취소해 주세요.',
          HttpStatus.CONFLICT,
        );
      }
      await tx.update(table).set({ status, updatedAt: new Date() }).where(eq(table.id, id));
      await this.audit.record(
        {
          action: `evidence.${status === 'ignored' ? 'ignore' : 'restore'}`,
          entity: kind,
          entityId: id,
        },
        tx,
      );
    });
  }

  async runs() {
    return this.db.tenant(async (tx) => {
      const rows = await tx
        .select()
        .from(collectionRuns)
        .orderBy(desc(collectionRuns.startedAt))
        .limit(50);
      return rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        provider: r.provider,
        trigger: r.trigger,
        status: r.status,
        fetched: r.fetched,
        inserted: r.inserted,
        duplicates: r.duplicates,
        message: r.message,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
      }));
    });
  }
}
