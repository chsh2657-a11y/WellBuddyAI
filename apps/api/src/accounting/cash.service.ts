import { Injectable, NotFoundException } from '@nestjs/common';
import { addDays, SYSTEM_ACCOUNTS } from '@wellbuddy/accounting-core';
import {
  accounts,
  cashPlans,
  journalEntries,
  journalLines,
  notes,
  partners,
  type Transaction,
} from '@wellbuddy/db';
import {
  type CashPlanInput,
  type CashPlanUpdateInput,
  formatJournalNo,
  LEDGER_STATUSES,
} from '@wellbuddy/shared';
import { and, asc, eq, gte, inArray, lt, lte, ne, or, type SQL, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';
import { FiscalYearsService } from './fiscal-years.service.js';

/** 자금(현금·예금) 계정 */
const FUND_CODES = [SYSTEM_ACCOUNTS.cash, '102', SYSTEM_ACCOUNTS.bankDeposit];

const inLedger = inArray(journalEntries.status, [...LEDGER_STATUSES]);
const won = (value: unknown) => sql<number>`coalesce(sum(${value}), 0)`.mapWith(Number);

interface PlanItem {
  date: string;
  source: 'plan' | 'note';
  id: string;
  direction: 'in' | 'out';
  amount: number;
  description: string;
  partnerName: string | null;
}

/**
 * 자금계획(예정 입출금 + 어음 만기로 일자별 예상 잔액)과 일일자금일보(현금·예금 계정별 전일 잔액·입금·출금·금일 잔액).
 */
@Injectable()
export class CashService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly fiscal: FiscalYearsService,
  ) {}

  private async fundAccounts(tx: Transaction) {
    return tx
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(inArray(accounts.code, FUND_CODES))
      .orderBy(asc(accounts.code));
  }

  /** 계정별 (차변 − 대변) 잔액: 날짜가 속한 회계연도 기초부터 before 전날까지(기초잔액 포함) */
  private async balances(tx: Transaction, accountIds: string[], before: string) {
    if (accountIds.length === 0) return new Map<string, number>();
    const year = await this.fiscal.rangeFor(tx, before);
    const rows = await tx
      .select({
        accountId: journalLines.accountId,
        net: won(sql`${journalLines.debit} - ${journalLines.credit}`),
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(
        and(
          inLedger,
          inArray(journalLines.accountId, accountIds),
          gte(journalEntries.entryDate, year.startDate),
          or(lt(journalEntries.entryDate, before), eq(journalEntries.type, 'opening')),
        ),
      )
      .groupBy(journalLines.accountId);
    return new Map(rows.map((r) => [r.accountId, r.net]));
  }

  // ── 자금계획 항목 ────────────────────────────────────

  private async plans(tx: Transaction, where: SQL | undefined) {
    const rows = await tx
      .select({ p: cashPlans, partnerName: partners.name })
      .from(cashPlans)
      .leftJoin(partners, eq(partners.id, cashPlans.partnerId))
      .where(where)
      .orderBy(asc(cashPlans.planDate), asc(cashPlans.createdAt));
    return rows.map(({ p, partnerName }) => ({
      id: p.id,
      planDate: p.planDate,
      direction: p.direction,
      amount: p.amount,
      description: p.description,
      partnerId: p.partnerId,
      partnerName,
      done: p.done,
    }));
  }

  async listPlans(from: string, to: string) {
    return this.db.tenant((tx) =>
      this.plans(tx, and(gte(cashPlans.planDate, from), lte(cashPlans.planDate, to))),
    );
  }

  async createPlan(input: CashPlanInput) {
    const { companyId } = requireCompanyContext();
    return this.db.tenant(async (tx) => {
      const [row] = await tx
        .insert(cashPlans)
        .values({ ...input, partnerId: input.partnerId ?? null, companyId })
        .returning();
      await this.audit.record(
        { action: 'cash_plan.create', entity: 'cash_plan', entityId: row!.id, after: input },
        tx,
      );
      return (await this.plans(tx, eq(cashPlans.id, row!.id)))[0]!;
    });
  }

  async updatePlan(id: string, input: CashPlanUpdateInput) {
    return this.db.tenant(async (tx) => {
      const [row] = await tx
        .update(cashPlans)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(cashPlans.id, id))
        .returning();
      if (!row) throw new NotFoundException();
      await this.audit.record(
        { action: 'cash_plan.update', entity: 'cash_plan', entityId: id, after: input },
        tx,
      );
      return (await this.plans(tx, eq(cashPlans.id, id)))[0]!;
    });
  }

  async removePlan(id: string) {
    await this.db.tenant(async (tx) => {
      const [row] = await tx.delete(cashPlans).where(eq(cashPlans.id, id)).returning();
      if (!row) throw new NotFoundException();
      await this.audit.record(
        { action: 'cash_plan.delete', entity: 'cash_plan', entityId: id, before: row },
        tx,
      );
    });
  }

  // ── 자금계획 보고서 ──────────────────────────────────

  /**
   * from 전날까지의 실제 현금·예금 잔액에서 시작해, 기간 안의 예정 입출금(끝나지 않은 계획)과
   * 보유 중인 받을어음(입금)·발행한 지급어음(출금) 만기를 날짜순으로 더한 예상 잔액.
   */
  async planReport(from: string, to: string) {
    return this.db.tenant(async (tx) => {
      const funds = await this.fundAccounts(tx);
      const opening = [
        ...(
          await this.balances(
            tx,
            funds.map((a) => a.id),
            from,
          )
        ).values(),
      ].reduce((s, v) => s + v, 0);
      const plans = await tx
        .select({ p: cashPlans, partnerName: partners.name })
        .from(cashPlans)
        .leftJoin(partners, eq(partners.id, cashPlans.partnerId))
        .where(
          and(
            gte(cashPlans.planDate, from),
            lte(cashPlans.planDate, to),
            eq(cashPlans.done, false),
          ),
        );
      const dueNotes = await tx
        .select({ n: notes, partnerName: partners.name })
        .from(notes)
        .innerJoin(partners, eq(partners.id, notes.partnerId))
        .where(and(eq(notes.status, 'holding'), gte(notes.dueDate, from), lte(notes.dueDate, to)));
      const items: PlanItem[] = [
        ...plans.map(({ p, partnerName }) => ({
          date: p.planDate,
          source: 'plan' as const,
          id: p.id,
          direction: p.direction,
          amount: p.amount,
          description: p.description,
          partnerName,
        })),
        ...dueNotes.map(({ n, partnerName }) => ({
          date: n.dueDate,
          source: 'note' as const,
          id: n.id,
          direction: n.kind === 'receivable' ? ('in' as const) : ('out' as const),
          amount: n.amount,
          description: `${n.kind === 'receivable' ? '받을어음' : '지급어음'} ${n.noteNo} 만기`,
          partnerName,
        })),
      ].sort((a, b) => {
        // 날짜순, 같은 날은 입금 먼저
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return (a.direction === 'in' ? 0 : 1) - (b.direction === 'in' ? 0 : 1);
      });

      let balance = opening;
      let minBalance = opening;
      let minDate: string | null = null;
      const days: {
        date: string;
        inflow: number;
        outflow: number;
        balance: number;
        items: PlanItem[];
      }[] = [];
      for (const item of items) {
        let day = days.at(-1);
        if (!day || day.date !== item.date) {
          day = { date: item.date, inflow: 0, outflow: 0, balance, items: [] };
          days.push(day);
        }
        if (item.direction === 'in') day.inflow += item.amount;
        else day.outflow += item.amount;
        balance += item.direction === 'in' ? item.amount : -item.amount;
        day.balance = balance;
        day.items.push(item);
        if (balance < minBalance) {
          minBalance = balance;
          minDate = item.date;
        }
      }
      return {
        from,
        to,
        opening,
        days,
        inflow: days.reduce((s, d) => s + d.inflow, 0),
        outflow: days.reduce((s, d) => s + d.outflow, 0),
        closing: balance,
        minBalance,
        minDate,
        /** 예상 잔액이 0 밑으로 내려가는 첫날 */
        shortageDate: days.find((d) => d.balance < 0)?.date ?? null,
      };
    });
  }

  // ── 일일자금일보 ─────────────────────────────────────

  async dailyReport(date: string) {
    return this.db.tenant(async (tx) => {
      const funds = await this.fundAccounts(tx);
      const ids = funds.map((a) => a.id);
      const opening = await this.balances(tx, ids, date);
      const lines =
        ids.length === 0
          ? []
          : await tx
              .select({
                lineId: journalLines.id,
                entryId: journalEntries.id,
                entryDate: journalEntries.entryDate,
                entryNo: journalEntries.entryNo,
                accountId: journalLines.accountId,
                description: journalEntries.description,
                memo: journalLines.memo,
                partnerName: partners.name,
                debit: journalLines.debit,
                credit: journalLines.credit,
              })
              .from(journalLines)
              .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
              .leftJoin(partners, eq(partners.id, journalLines.partnerId))
              .where(
                and(
                  inLedger,
                  ne(journalEntries.type, 'opening'),
                  inArray(journalLines.accountId, ids),
                  eq(journalEntries.entryDate, date),
                ),
              )
              .orderBy(asc(journalEntries.entryNo), asc(journalLines.lineNo));
      // 상대 계정: 같은 전표의 자금 계정이 아닌 줄들
      const entryIds = [...new Set(lines.map((l) => l.entryId))];
      const others =
        entryIds.length === 0
          ? []
          : await tx
              .select({ entryId: journalLines.entryId, name: accounts.name })
              .from(journalLines)
              .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
              .where(inArray(journalLines.entryId, entryIds));
      const fundNames = new Set(funds.map((f) => f.name));
      const counterOf = (entryId: string) => {
        const names = [
          ...new Set(
            others
              .filter((o) => o.entryId === entryId && !fundNames.has(o.name))
              .map((o) => o.name),
          ),
        ];
        return names.length === 0 ? '자금 이체' : names.length === 1 ? names[0]! : `${names[0]} 외`;
      };

      const accountsReport = funds.map((f) => {
        const own = lines.filter((l) => l.accountId === f.id);
        let balance = opening.get(f.id) ?? 0;
        const rows = own.map((l) => {
          balance += l.debit - l.credit;
          return {
            lineId: l.lineId,
            entryId: l.entryId,
            number: formatJournalNo(l.entryDate, l.entryNo),
            description: l.memo ?? l.description,
            partnerName: l.partnerName,
            counterAccount: counterOf(l.entryId),
            receipt: l.debit,
            payment: l.credit,
            balance,
          };
        });
        return {
          accountId: f.id,
          code: f.code,
          name: f.name,
          opening: opening.get(f.id) ?? 0,
          receipts: own.reduce((s, l) => s + l.debit, 0),
          payments: own.reduce((s, l) => s + l.credit, 0),
          closing: balance,
          rows,
        };
      });

      const dueNotes = await tx
        .select({ n: notes, partnerName: partners.name })
        .from(notes)
        .innerJoin(partners, eq(partners.id, notes.partnerId))
        .where(and(eq(notes.status, 'holding'), eq(notes.dueDate, date)));
      const plans = await tx
        .select({ p: cashPlans, partnerName: partners.name })
        .from(cashPlans)
        .leftJoin(partners, eq(partners.id, cashPlans.partnerId))
        .where(and(eq(cashPlans.planDate, date), eq(cashPlans.done, false)));

      const sum = (key: 'opening' | 'receipts' | 'payments' | 'closing') =>
        accountsReport.reduce((s, a) => s + a[key], 0);
      return {
        date,
        previousDate: addDays(date, -1),
        accounts: accountsReport,
        totals: {
          opening: sum('opening'),
          receipts: sum('receipts'),
          payments: sum('payments'),
          closing: sum('closing'),
        },
        /** 오늘 만기인 어음과 오늘 예정된 입출금(아직 처리 전) */
        scheduled: [
          ...dueNotes.map(({ n, partnerName }) => ({
            source: 'note' as const,
            id: n.id,
            direction: n.kind === 'receivable' ? ('in' as const) : ('out' as const),
            amount: n.amount,
            description: `${n.kind === 'receivable' ? '받을어음' : '지급어음'} ${n.noteNo} 만기`,
            partnerName,
          })),
          ...plans.map(({ p, partnerName }) => ({
            source: 'plan' as const,
            id: p.id,
            direction: p.direction,
            amount: p.amount,
            description: p.description,
            partnerName,
          })),
        ],
      };
    });
  }
}
