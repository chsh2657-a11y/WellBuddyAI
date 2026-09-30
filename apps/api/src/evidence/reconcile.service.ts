import { Injectable } from '@nestjs/common';
import {
  accounts,
  bankAccounts,
  bankTransactions,
  journalEntries,
  journalLines,
} from '@wellbuddy/db';
import { bankName, LEDGER_STATUSES } from '@wellbuddy/shared';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { FiscalYearsService } from '../accounting/fiscal-years.service.js';
import { DbService } from '../db/db.service.js';

const won = (expr: ReturnType<typeof sql>) =>
  sql<number>`coalesce(sum(${expr}), 0)`.mapWith(Number);

export type ReconcileStatus = 'matched' | 'mismatch' | 'unknown';

/**
 * 통장 잔액 ↔ 장부 잔액 대사(P2-26).
 * 장부 계정(103 보통예금 등)마다, 그 계정에 연결된 계좌들의 기준일 통장 잔액 합계와 장부 잔액을 비교한다.
 * 아직 장부에 반영되지 않은 통장 거래(분개 전·검토 중·제외·전기 전 전표)는 차이를 설명하는 항목으로 따로 보여 주고,
 * 통장 − 장부 − 미반영 = 0 이면 일치로 본다.
 */
@Injectable()
export class ReconcileService {
  constructor(
    private readonly db: DbService,
    private readonly fiscal: FiscalYearsService,
  ) {}

  async reconciliation(date: string) {
    return this.db.tenant(async (tx) => {
      const rows = await tx
        .select({
          id: bankAccounts.id,
          alias: bankAccounts.alias,
          bankCode: bankAccounts.bankCode,
          accountNoMasked: bankAccounts.accountNoMasked,
          isActive: bankAccounts.isActive,
          ledgerAccountId: bankAccounts.ledgerAccountId,
          ledgerCode: accounts.code,
          ledgerName: accounts.name,
        })
        .from(bankAccounts)
        .innerJoin(accounts, eq(accounts.id, bankAccounts.ledgerAccountId))
        .orderBy(asc(accounts.code), asc(bankAccounts.createdAt));

      const perAccount: ((typeof rows)[number] & {
        balance: number | null;
        balanceDate: string | null;
        unreflected: number;
        unreflectedCount: number;
      })[] = [];
      for (const a of rows) {
        // 기준일까지 잔액이 찍힌 마지막 거래
        const [last] = await tx
          .select({ balance: bankTransactions.balance, date: bankTransactions.txDate })
          .from(bankTransactions)
          .where(
            and(
              eq(bankTransactions.bankAccountId, a.id),
              lte(bankTransactions.txDate, date),
              isNotNull(bankTransactions.balance),
            ),
          )
          .orderBy(
            desc(bankTransactions.txDate),
            sql`${bankTransactions.txTime} desc nulls last`,
            desc(bankTransactions.createdAt),
          )
          .limit(1);
        // 장부에 아직 반영되지 않은 거래: 전기된 전표와 이어지지 않은 것
        const [pending] = await tx
          .select({
            net: won(sql`${bankTransactions.deposit} - ${bankTransactions.withdrawal}`),
            count: sql<number>`count(*)`.mapWith(Number),
          })
          .from(bankTransactions)
          .leftJoin(journalEntries, eq(journalEntries.id, bankTransactions.entryId))
          .where(
            and(
              eq(bankTransactions.bankAccountId, a.id),
              lte(bankTransactions.txDate, date),
              sql`(${journalEntries.id} is null or ${journalEntries.status} <> 'posted')`,
            ),
          );
        perAccount.push({
          ...a,
          balance: last?.balance ?? null,
          balanceDate: last?.date ?? null,
          unreflected: pending?.net ?? 0,
          unreflectedCount: pending?.count ?? 0,
        });
      }

      const ledgerIds = [...new Set(perAccount.map((a) => a.ledgerAccountId))];
      const year = await this.fiscal.rangeFor(tx, date);
      const ledgerRows = ledgerIds.length
        ? await tx
            .select({
              accountId: journalLines.accountId,
              net: won(sql`${journalLines.debit} - ${journalLines.credit}`),
            })
            .from(journalLines)
            .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
            .where(
              and(
                inArray(journalEntries.status, [...LEDGER_STATUSES]),
                inArray(journalLines.accountId, ledgerIds),
                gte(journalEntries.entryDate, year.startDate),
                or(lte(journalEntries.entryDate, date), eq(journalEntries.type, 'opening')),
              ),
            )
            .groupBy(journalLines.accountId)
        : [];
      const ledgerBalance = new Map(ledgerRows.map((r) => [r.accountId, r.net]));

      const groups = ledgerIds.map((ledgerAccountId) => {
        const list = perAccount.filter((a) => a.ledgerAccountId === ledgerAccountId);
        const known = list.every((a) => a.balance !== null);
        const bankBalance = known ? list.reduce((s, a) => s + a.balance!, 0) : null;
        const ledger = ledgerBalance.get(ledgerAccountId) ?? 0;
        const unreflected = list.reduce((s, a) => s + a.unreflected, 0);
        const difference = bankBalance === null ? null : bankBalance - ledger - unreflected;
        const status: ReconcileStatus =
          difference === null ? 'unknown' : difference === 0 ? 'matched' : 'mismatch';
        return {
          ledgerAccountId,
          ledgerAccount: `${list[0]!.ledgerCode} ${list[0]!.ledgerName}`,
          bankBalance,
          ledgerBalance: ledger,
          unreflected,
          unreflectedCount: list.reduce((s, a) => s + a.unreflectedCount, 0),
          difference,
          status,
          accounts: list.map((a) => ({
            id: a.id,
            alias: a.alias,
            bankName: bankName(a.bankCode),
            accountNoMasked: a.accountNoMasked,
            isActive: a.isActive,
            balance: a.balance,
            balanceDate: a.balanceDate,
            unreflected: a.unreflected,
            unreflectedCount: a.unreflectedCount,
          })),
        };
      });
      return { date, groups };
    });
  }
}
