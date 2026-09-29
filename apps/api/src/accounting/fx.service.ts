import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CurrencyCode,
  currencyUnit,
  FX_ACCOUNTS,
  type FxSide,
  negateForeign,
  revaluation,
  STATEMENT_GROUPS,
} from '@wellbuddy/accounting-core';
import {
  accounts,
  ensureStandardAccounts,
  exchangeRates,
  type FxRevaluationDetail,
  fxRevaluations,
  journalEntries,
  journalLines,
  partners,
  type Transaction,
} from '@wellbuddy/db';
import {
  type ExchangeRateInput,
  formatJournalNo,
  type JournalLineInput,
  LEDGER_STATUSES,
} from '@wellbuddy/shared';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql, sum } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { requireCompanyContext } from '../common/request-context.js';
import { AppException } from '../common/errors.js';
import { DbService } from '../db/db.service.js';
import { FiscalYearsService } from './fiscal-years.service.js';
import { JournalsService } from './journals.service.js';

type RateRow = typeof exchangeRates.$inferSelect;

const toRate = (r: RateRow) => ({
  id: r.id,
  currency: r.currency,
  rateDate: r.rateDate,
  rate: r.rate,
  unit: currencyUnit(r.currency),
});

export interface RevaluationRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  partnerId: string | null;
  partnerName: string | null;
  currency: string;
  side: FxSide;
  /** 정상잔액 방향의 외화 잔액·장부 원화 잔액 */
  foreignBalance: string;
  bookKrw: number;
  /** 평가 환율(없으면 null) */
  rate: string | null;
  rateDate: string | null;
  targetKrw: number | null;
  adjustment: number | null;
  /** 평가이익(+)·평가손실(−) */
  profit: number | null;
}

/**
 * 환율 관리와 기말 외화평가.
 * - 외화 잔액은 통화가 붙은 전표 줄(외화 금액)을 회계연도 기초부터 평가일까지 모아 계산한다.
 * - 평가 전표는 대상 계정 줄에 통화를 붙이고 외화 0 으로 원화만 조정해, 다음 평가의 장부 원화에 반영되게 한다.
 */
@Injectable()
export class FxService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly fiscal: FiscalYearsService,
    private readonly journals: JournalsService,
  ) {}

  // ── 환율 ─────────────────────────────────────────────

  async listRates(query: { currency?: string; from?: string; to?: string }) {
    return this.db.tenant(async (tx) => {
      const rows = await tx
        .select()
        .from(exchangeRates)
        .where(
          and(
            query.currency ? eq(exchangeRates.currency, query.currency) : undefined,
            query.from ? gte(exchangeRates.rateDate, query.from) : undefined,
            query.to ? lte(exchangeRates.rateDate, query.to) : undefined,
          ),
        )
        .orderBy(desc(exchangeRates.rateDate), asc(exchangeRates.currency))
        .limit(1000);
      return rows.map(toRate);
    });
  }

  private async upsertIn(tx: Transaction, input: ExchangeRateInput) {
    const { companyId } = requireCompanyContext();
    const [row] = await tx
      .insert(exchangeRates)
      .values({ ...input, companyId })
      .onConflictDoUpdate({
        target: [exchangeRates.companyId, exchangeRates.currency, exchangeRates.rateDate],
        set: { rate: input.rate, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async upsertRate(input: ExchangeRateInput) {
    return this.db.tenant(async (tx) => {
      const row = await this.upsertIn(tx, input);
      await this.audit.record(
        { action: 'exchange_rate.upsert', entity: 'exchange_rate', entityId: row.id, after: input },
        tx,
      );
      return toRate(row);
    });
  }

  async upsertRates(rows: ExchangeRateInput[]) {
    return this.db.tenant(async (tx) => {
      const existing = new Set(
        (
          await tx
            .select({ currency: exchangeRates.currency, rateDate: exchangeRates.rateDate })
            .from(exchangeRates)
        ).map((r) => `${r.currency}:${r.rateDate}`),
      );
      let created = 0;
      let updated = 0;
      for (const row of rows) {
        if (existing.has(`${row.currency}:${row.rateDate}`)) updated++;
        else created++;
        await this.upsertIn(tx, row);
      }
      await this.audit.record(
        { action: 'exchange_rate.import', entity: 'exchange_rate', after: { created, updated } },
        tx,
      );
      return { created, updated };
    });
  }

  async removeRate(id: string) {
    await this.db.tenant(async (tx) => {
      const [row] = await tx.delete(exchangeRates).where(eq(exchangeRates.id, id)).returning();
      if (!row) throw new NotFoundException();
      await this.audit.record(
        { action: 'exchange_rate.delete', entity: 'exchange_rate', entityId: id, before: row },
        tx,
      );
    });
  }

  /** 그 날짜 또는 그 이전 가장 가까운 날의 환율 */
  async lookupRate(currency: string, date: string) {
    return this.db.tenant(async (tx) => {
      const [row] = await tx
        .select()
        .from(exchangeRates)
        .where(and(eq(exchangeRates.currency, currency), lte(exchangeRates.rateDate, date)))
        .orderBy(desc(exchangeRates.rateDate))
        .limit(1);
      return { exchangeRate: row ? toRate(row) : null };
    });
  }

  // ── 외화평가 ─────────────────────────────────────────

  /** 평가일 현재 (계정, 거래처, 통화)별 외화·원화 잔액과 평가 결과 */
  private async compute(tx: Transaction, date: string) {
    const range = await this.fiscal.rangeFor(tx, date);
    const rows = await tx
      .select({
        accountId: journalLines.accountId,
        accountCode: accounts.code,
        accountName: accounts.name,
        group: accounts.group,
        partnerId: journalLines.partnerId,
        partnerName: partners.name,
        currency: journalLines.currency,
        debit: sum(journalLines.debit).mapWith(Number),
        credit: sum(journalLines.credit).mapWith(Number),
        foreignNet: sql<string>`coalesce(sum(case when ${journalLines.debit} > 0 then ${journalLines.foreignAmount} else -${journalLines.foreignAmount} end), 0)::text`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .leftJoin(partners, eq(partners.id, journalLines.partnerId))
      .where(
        and(
          isNotNull(journalLines.currency),
          inArray(journalEntries.status, [...LEDGER_STATUSES]),
          gte(journalEntries.entryDate, range.startDate),
          lte(journalEntries.entryDate, date),
        ),
      )
      .groupBy(
        journalLines.accountId,
        accounts.code,
        accounts.name,
        accounts.group,
        journalLines.partnerId,
        partners.name,
        journalLines.currency,
      )
      .orderBy(asc(accounts.code), asc(journalLines.currency), asc(partners.name));

    const currencies = [...new Set(rows.map((r) => r.currency!))];
    const rates = new Map<string, { rate: string; rateDate: string }>();
    if (currencies.length > 0) {
      const found = await tx
        .selectDistinctOn([exchangeRates.currency], {
          currency: exchangeRates.currency,
          rate: exchangeRates.rate,
          rateDate: exchangeRates.rateDate,
        })
        .from(exchangeRates)
        .where(and(inArray(exchangeRates.currency, currencies), lte(exchangeRates.rateDate, date)))
        .orderBy(exchangeRates.currency, desc(exchangeRates.rateDate));
      for (const r of found) rates.set(r.currency, { rate: r.rate, rateDate: r.rateDate });
    }

    const result: RevaluationRow[] = [];
    for (const r of rows) {
      // 외화 자산·부채만 평가한다(외화 매출·비용 같은 손익 계정은 거래일 환율 그대로)
      const category = STATEMENT_GROUPS[r.group].category;
      if (category !== 'asset' && category !== 'liability') continue;
      const side: FxSide = category;
      const foreignBalance = side === 'asset' ? r.foreignNet : negateForeign(r.foreignNet);
      const bookKrw = side === 'asset' ? r.debit - r.credit : r.credit - r.debit;
      if (Number(foreignBalance) === 0 && bookKrw === 0) continue;
      const rate = rates.get(r.currency!);
      const computed = rate
        ? revaluation({
            foreignBalance,
            bookKrw,
            closingRate: rate.rate,
            unit: currencyUnit(r.currency!),
            side,
          })
        : null;
      result.push({
        accountId: r.accountId,
        accountCode: r.accountCode,
        accountName: r.accountName,
        partnerId: r.partnerId,
        partnerName: r.partnerName,
        currency: r.currency!,
        side,
        foreignBalance: Number(foreignBalance) === 0 ? '0.00' : foreignBalance,
        bookKrw,
        rate: rate?.rate ?? null,
        rateDate: rate?.rateDate ?? null,
        targetKrw: computed?.targetKrw ?? null,
        adjustment: computed?.adjustment ?? null,
        profit: computed?.profit ?? null,
      });
    }
    const gain = result.reduce((s, r) => s + Math.max(r.profit ?? 0, 0), 0);
    const loss = result.reduce((s, r) => s + Math.max(-(r.profit ?? 0), 0), 0);
    const missingCurrencies = [...new Set(result.filter((r) => !r.rate).map((r) => r.currency))];
    return { date, fiscalYear: range.label, rows: result, gain, loss, missingCurrencies };
  }

  async preview(date: string) {
    return this.db.tenant((tx) => this.compute(tx, date));
  }

  async listRevaluations() {
    return this.db.tenant(async (tx) => {
      const rows = await tx
        .select({
          id: fxRevaluations.id,
          date: fxRevaluations.revaluationDate,
          gain: fxRevaluations.gain,
          loss: fxRevaluations.loss,
          entryId: fxRevaluations.entryId,
          entryDate: journalEntries.entryDate,
          entryNo: journalEntries.entryNo,
          details: fxRevaluations.details,
          createdAt: fxRevaluations.createdAt,
        })
        .from(fxRevaluations)
        .leftJoin(journalEntries, eq(journalEntries.id, fxRevaluations.entryId))
        .orderBy(desc(fxRevaluations.revaluationDate));
      return rows.map((r) => ({
        id: r.id,
        date: r.date,
        gain: r.gain,
        loss: r.loss,
        entryId: r.entryId,
        entryNumber:
          r.entryDate && r.entryNo !== null ? formatJournalNo(r.entryDate, r.entryNo) : null,
        rows: r.details.length,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  private async accountIdByCode(tx: Transaction, code: string) {
    const { companyId } = requireCompanyContext();
    const find = async () =>
      (await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.code, code)))[0]?.id;
    let id = await find();
    if (!id) {
      await ensureStandardAccounts(tx, companyId);
      id = await find();
    }
    if (!id) throw new AppException('ACCOUNT_NOT_FOUND', `${code} 계정이 없습니다.`);
    return id;
  }

  /**
   * 평가일 기준 외화평가 전표를 전기한다(평가일마다 한 번, 날짜 순서대로).
   * (차) 외화자산 증가·외화부채 감소 / 외화환산손실  (대) 외화자산 감소·외화부채 증가 / 외화환산이익
   */
  async revalue(date: string) {
    const { companyId, userId } = requireCompanyContext();
    return this.db.tenant(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`fx:${companyId}`}))`);
      const [latest] = await tx
        .select({ date: fxRevaluations.revaluationDate })
        .from(fxRevaluations)
        .orderBy(desc(fxRevaluations.revaluationDate))
        .limit(1);
      if (latest && latest.date >= date) {
        throw new AppException(
          latest.date === date ? 'FX_REVALUATION_ALREADY_RUN' : 'FX_REVALUATION_ORDER',
          latest.date === date
            ? `${date} 외화평가는 이미 반영했습니다.`
            : `${latest.date} 외화평가가 있어 그 이전 날짜로는 평가할 수 없습니다. 마지막 평가를 취소한 뒤 다시 실행해 주세요.`,
          HttpStatus.CONFLICT,
        );
      }
      const plan = await this.compute(tx, date);
      if (plan.missingCurrencies.length > 0) {
        throw new AppException(
          'FX_RATE_MISSING',
          `${plan.missingCurrencies.join(', ')} 환율이 없습니다. ${date} 이전 환율을 먼저 등록해 주세요.`,
        );
      }
      const targets = plan.rows.filter((r) => r.adjustment);
      let entryId: string | null = null;
      if (targets.length > 0) {
        const memo = `${date} 외화평가`;
        const lines: JournalLineInput[] = targets.map((r) => {
          const amount = Math.abs(r.adjustment!);
          // 원화 잔액을 늘릴 때: 자산은 차변, 부채는 대변
          const debit = r.adjustment! > 0 === (r.side === 'asset');
          return {
            accountId: r.accountId,
            partnerId: r.partnerId,
            debit: debit ? amount : 0,
            credit: debit ? 0 : amount,
            memo: `${memo} ${r.currency} @${r.rate}`,
            currency: r.currency as CurrencyCode,
            foreignAmount: '0.00',
            exchangeRate: r.rate,
          };
        });
        if (plan.loss > 0) {
          lines.push({
            accountId: await this.accountIdByCode(tx, FX_ACCOUNTS.revaluationLoss),
            partnerId: null,
            debit: plan.loss,
            credit: 0,
            memo,
          });
        }
        if (plan.gain > 0) {
          lines.push({
            accountId: await this.accountIdByCode(tx, FX_ACCOUNTS.revaluationGain),
            partnerId: null,
            debit: 0,
            credit: plan.gain,
            memo,
          });
        }
        entryId = await this.journals.createIn(
          tx,
          {
            entry: { entryDate: date, type: 'general', description: memo, lines },
            status: 'posted',
          },
          { source: 'fx_revaluation', sourceRef: date },
        );
      }
      const details: FxRevaluationDetail[] = plan.rows
        .filter((r) => r.rate)
        .map((r) => ({
          accountId: r.accountId,
          partnerId: r.partnerId,
          currency: r.currency,
          foreignBalance: r.foreignBalance,
          bookKrw: r.bookKrw,
          rate: r.rate!,
          targetKrw: r.targetKrw!,
          adjustment: r.adjustment!,
          profit: r.profit!,
        }));
      const [run] = await tx
        .insert(fxRevaluations)
        .values({
          companyId,
          revaluationDate: date,
          entryId,
          gain: plan.gain,
          loss: plan.loss,
          details,
          createdBy: userId,
        })
        .returning({ id: fxRevaluations.id });
      await this.audit.record(
        {
          action: 'fx.revalue',
          entity: 'fx_revaluation',
          entityId: run!.id,
          after: { date, gain: plan.gain, loss: plan.loss, rows: details.length },
        },
        tx,
      );
      return { date, gain: plan.gain, loss: plan.loss, rows: details.length, entryId };
    });
  }

  /** 마지막 외화평가를 취소한다(전표는 역분개). */
  async cancel(date: string) {
    await this.db.tenant(async (tx) => {
      const [latest] = await tx
        .select()
        .from(fxRevaluations)
        .orderBy(desc(fxRevaluations.revaluationDate))
        .limit(1);
      if (!latest || latest.revaluationDate !== date) {
        throw new AppException(
          'FX_REVALUATION_NOT_LATEST',
          '가장 마지막에 실행한 외화평가만 취소할 수 있습니다.',
          HttpStatus.CONFLICT,
        );
      }
      if (latest.entryId) {
        await this.journals.reverseIn(
          tx,
          latest.entryId,
          { entryDate: date, description: `[취소] ${date} 외화평가` },
          { system: true },
        );
      }
      await tx.delete(fxRevaluations).where(eq(fxRevaluations.id, latest.id));
      await this.audit.record(
        {
          action: 'fx.cancel',
          entity: 'fx_revaluation',
          entityId: latest.id,
          before: { date, gain: latest.gain, loss: latest.loss },
        },
        tx,
      );
    });
  }
}
