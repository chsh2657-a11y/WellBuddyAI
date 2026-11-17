import { Injectable } from '@nestjs/common';
import {
  accounts,
  bankAccounts,
  bankTransactions,
  cardTransactions,
  cashReceipts,
  corporateCards,
  type EvidenceStatus,
  evidenceSuggestions,
  journalEntries,
  taxInvoices,
  type Transaction,
} from '@wellbuddy/db';
import {
  EVIDENCE_STATUSES,
  type EvidenceCenterQuery,
  formatJournalNo,
  type UploadKind,
} from '@wellbuddy/shared';
import { type AnyColumn, and, desc, eq, gte, ilike, lte, or, type SQL, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';

/** 증빙센터 한 줄: 네 원천을 같은 모양으로 */
export interface CenterItem {
  evidenceKind: UploadKind;
  id: string;
  date: string;
  kindLabel: string;
  /** 무엇(적요·가맹점·품목) */
  description: string;
  /** 누구와(보낸분·받는분·상대 상호) */
  counterparty: string | null;
  /** 계좌·카드 별칭 */
  sourceLabel: string | null;
  /** 돈이 들어오면 in, 나가면 out */
  flow: 'in' | 'out';
  amount: number;
  status: EvidenceStatus;
  /** 분개 계정(추천 또는 전표에 쓴 계정) */
  account: string | null;
  entryId: string | null;
  entryNumber: string | null;
}

const LIMIT = 1000;

const suggestionJoin = (kind: UploadKind, id: AnyColumn) =>
  and(eq(evidenceSuggestions.evidenceKind, kind), eq(evidenceSuggestions.evidenceId, id));

const account = (code: string | null, name: string | null) =>
  code && name ? `${code} ${name}` : null;
const entryNo = (date: string | null, no: number | null) =>
  date && no !== null ? formatJournalNo(date, no) : null;

/**
 * 증빙센터(P2-28): 통장·카드·세금계산서·현금영수증을 한 목록으로, 처리 상태와 전표 연결을 함께 보여 준다.
 * 상태별 건수는 상태 조건만 빼고 같은 조건으로 센다.
 */
@Injectable()
export class CenterService {
  constructor(private readonly db: DbService) {}

  private range(column: AnyColumn, q: EvidenceCenterQuery) {
    return [q.from ? gte(column, q.from) : undefined, q.to ? lte(column, q.to) : undefined];
  }

  private search(q: EvidenceCenterQuery, ...columns: AnyColumn[]): SQL | undefined {
    if (!q.q) return undefined;
    const pattern = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return or(...columns.map((c) => ilike(c, pattern)));
  }

  /** 원천별 조건(상태 제외)과 상태 열 */
  private sources(q: EvidenceCenterQuery) {
    return {
      bank: {
        table: bankTransactions,
        where: and(
          ...this.range(bankTransactions.txDate, q),
          this.search(q, bankTransactions.description, bankTransactions.counterparty),
        ),
      },
      card: {
        table: cardTransactions,
        where: and(
          ...this.range(cardTransactions.approvedDate, q),
          this.search(q, cardTransactions.merchantName, cardTransactions.category),
        ),
      },
      tax_invoice: {
        table: taxInvoices,
        where: and(
          ...this.range(taxInvoices.issueDate, q),
          this.search(q, taxInvoices.supplierName, taxInvoices.buyerName, taxInvoices.itemSummary),
        ),
      },
      cash_receipt: {
        table: cashReceipts,
        where: and(...this.range(cashReceipts.txDate, q), this.search(q, cashReceipts.name)),
      },
    } as const;
  }

  private async items(tx: Transaction, kind: UploadKind, where: SQL | undefined) {
    switch (kind) {
      case 'bank': {
        const rows = await tx
          .select({
            t: bankTransactions,
            alias: bankAccounts.alias,
            code: accounts.code,
            name: accounts.name,
            entryDate: journalEntries.entryDate,
            entryNo: journalEntries.entryNo,
          })
          .from(bankTransactions)
          .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
          .leftJoin(evidenceSuggestions, suggestionJoin('bank', bankTransactions.id))
          .leftJoin(accounts, eq(accounts.id, evidenceSuggestions.accountId))
          .leftJoin(journalEntries, eq(journalEntries.id, bankTransactions.entryId))
          .where(where)
          .orderBy(desc(bankTransactions.txDate), desc(bankTransactions.createdAt))
          .limit(LIMIT);
        return rows.map(({ t, alias, code, name, entryDate, entryNo: no }): CenterItem => ({
          evidenceKind: 'bank',
          id: t.id,
          date: t.txDate,
          kindLabel: t.deposit > 0 ? '통장 입금' : '통장 출금',
          description: t.description,
          counterparty: t.counterparty,
          sourceLabel: alias,
          flow: t.deposit > 0 ? 'in' : 'out',
          amount: t.deposit > 0 ? t.deposit : t.withdrawal,
          status: t.status,
          account: account(code, name),
          entryId: t.entryId,
          entryNumber: entryNo(entryDate, no),
        }));
      }
      case 'card': {
        const rows = await tx
          .select({
            t: cardTransactions,
            alias: corporateCards.alias,
            code: accounts.code,
            name: accounts.name,
            entryDate: journalEntries.entryDate,
            entryNo: journalEntries.entryNo,
          })
          .from(cardTransactions)
          .innerJoin(corporateCards, eq(corporateCards.id, cardTransactions.cardId))
          .leftJoin(evidenceSuggestions, suggestionJoin('card', cardTransactions.id))
          .leftJoin(accounts, eq(accounts.id, evidenceSuggestions.accountId))
          .leftJoin(journalEntries, eq(journalEntries.id, cardTransactions.entryId))
          .where(where)
          .orderBy(desc(cardTransactions.approvedDate), desc(cardTransactions.createdAt))
          .limit(LIMIT);
        return rows.map(({ t, alias, code, name, entryDate, entryNo: no }): CenterItem => ({
          evidenceKind: 'card',
          id: t.id,
          date: t.approvedDate,
          kindLabel: t.cancelled ? '카드 취소' : '카드 승인',
          description: t.category ?? '',
          counterparty: t.merchantName,
          sourceLabel: alias,
          flow: t.cancelled ? 'in' : 'out',
          amount: t.amount,
          status: t.status,
          account: account(code, name),
          entryId: t.entryId,
          entryNumber: entryNo(entryDate, no),
        }));
      }
      case 'tax_invoice': {
        const rows = await tx
          .select({
            t: taxInvoices,
            code: accounts.code,
            name: accounts.name,
            entryDate: journalEntries.entryDate,
            entryNo: journalEntries.entryNo,
          })
          .from(taxInvoices)
          .leftJoin(evidenceSuggestions, suggestionJoin('tax_invoice', taxInvoices.id))
          .leftJoin(accounts, eq(accounts.id, evidenceSuggestions.accountId))
          .leftJoin(journalEntries, eq(journalEntries.id, taxInvoices.entryId))
          .where(where)
          .orderBy(desc(taxInvoices.issueDate), desc(taxInvoices.createdAt))
          .limit(LIMIT);
        return rows.map(({ t, code, name, entryDate, entryNo: no }): CenterItem => {
          const sales = t.direction === 'sales';
          const doc = t.kind === 'exempt' ? '계산서' : '세금계산서';
          return {
            evidenceKind: 'tax_invoice',
            id: t.id,
            date: t.issueDate,
            kindLabel: `${sales ? '매출' : '매입'} ${doc}`,
            description: t.itemSummary ?? '',
            counterparty: sales ? t.buyerName : t.supplierName,
            sourceLabel: null,
            flow: t.totalAmount >= 0 === sales ? 'in' : 'out',
            amount: Math.abs(t.totalAmount),
            status: t.status,
            account: account(code, name),
            entryId: t.entryId,
            entryNumber: entryNo(entryDate, no),
          };
        });
      }
      case 'cash_receipt': {
        const rows = await tx
          .select({
            t: cashReceipts,
            code: accounts.code,
            name: accounts.name,
            entryDate: journalEntries.entryDate,
            entryNo: journalEntries.entryNo,
          })
          .from(cashReceipts)
          .leftJoin(evidenceSuggestions, suggestionJoin('cash_receipt', cashReceipts.id))
          .leftJoin(accounts, eq(accounts.id, evidenceSuggestions.accountId))
          .leftJoin(journalEntries, eq(journalEntries.id, cashReceipts.entryId))
          .where(where)
          .orderBy(desc(cashReceipts.txDate), desc(cashReceipts.createdAt))
          .limit(LIMIT);
        return rows.map(({ t, code, name, entryDate, entryNo: no }): CenterItem => {
          const sales = t.direction === 'sales';
          return {
            evidenceKind: 'cash_receipt',
            id: t.id,
            date: t.txDate,
            kindLabel: `현금영수증 ${sales ? '매출' : '매입'}${t.cancelled ? ' 취소' : ''}`,
            description: '',
            counterparty: t.name,
            sourceLabel: null,
            flow: sales !== t.cancelled ? 'in' : 'out',
            amount: Math.abs(t.totalAmount),
            status: t.status,
            account: account(code, name),
            entryId: t.entryId,
            entryNumber: entryNo(entryDate, no),
          };
        });
      }
    }
  }

  async list(q: EvidenceCenterQuery) {
    return this.db.tenant(async (tx) => {
      const sources = this.sources(q);
      const kinds = (q.kind ? [q.kind] : Object.keys(sources)) as UploadKind[];
      const counts = Object.fromEntries(EVIDENCE_STATUSES.map((s) => [s, 0])) as Record<
        EvidenceStatus,
        number
      >;
      const items: CenterItem[] = [];
      for (const kind of kinds) {
        const { table, where } = sources[kind];
        const grouped = await tx
          .select({ status: table.status, n: sql<number>`count(*)`.mapWith(Number) })
          .from(table)
          .where(where)
          .groupBy(table.status);
        for (const g of grouped) counts[g.status] += g.n;
        items.push(
          ...(await this.items(
            tx,
            kind,
            and(where, q.status ? eq(table.status, q.status) : undefined),
          )),
        );
      }
      items.sort(
        (a, b) => b.date.localeCompare(a.date) || a.evidenceKind.localeCompare(b.evidenceKind),
      );
      const total = Object.values(counts).reduce((s, n) => s + n, 0);
      return { total, counts, items: items.slice(0, LIMIT), truncated: items.length > LIMIT };
    });
  }
}
