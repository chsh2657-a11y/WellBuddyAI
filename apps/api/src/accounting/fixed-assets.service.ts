import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  accumulatedDepreciation,
  addDays,
  addMonthsToMonthStart,
  type DepreciationInput,
  depreciationSchedule,
  disposalProfit,
  MoneyError,
  STATEMENT_GROUPS,
} from '@wellbuddy/accounting-core';
import {
  accounts,
  assetDepreciations,
  companies,
  departments,
  depreciationRuns,
  fixedAssets,
  journalEntries,
  type Transaction,
} from '@wellbuddy/db';
import {
  type AssetDisposeInput,
  type FixedAssetInput,
  type FixedAssetUpdateInput,
  formatJournalNo,
} from '@wellbuddy/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../common/db-errors.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';
import { JournalsService } from './journals.service.js';

type AssetRow = typeof fixedAssets.$inferSelect;

/** 처분손익 계정 */
const DISPOSAL_GAIN = '914';
const DISPOSAL_LOSS = '970';

/** 그 달의 말일(YYYY-MM → YYYY-MM-DD) */
export function monthEnd(month: string): string {
  return addDays(addMonthsToMonthStart(`${month}-01`, 1), -1);
}

/** 상각 일정을 만들 수 있는 입력인지(엔진 오류는 400 으로) */
function checkSchedule(input: DepreciationInput) {
  try {
    depreciationSchedule(input);
  } catch (e) {
    if (e instanceof MoneyError) throw new AppException('ASSET_INVALID', e.message);
    throw e;
  }
}

function scheduleInput(a: AssetRow, fiscalYearStartMonth: number): DepreciationInput {
  return {
    method: a.method,
    cost: a.cost,
    residualValue: a.residualValue,
    usefulLifeYears: a.usefulLifeYears,
    acquisitionDate: a.acquisitionDate,
    fiscalYearStartMonth,
  };
}

/**
 * 고정자산 대장과 월별 감가상각·처분 자동전표.
 * - 월 상각은 회사·월마다 한 번만 실행되고, 전표 한 장(비용 계정·부서별 차변 / 누계액 계정별 대변)을 전기한다.
 * - 상각액 = 그 달까지 있어야 할 누계 − 이미 반영한 누계(이전 상각 + 실행분). 늦게 등록한 자산도 자동으로 따라잡는다.
 * - 되돌리기는 마지막 실행만, 역분개로 한다.
 */
@Injectable()
export class FixedAssetsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly journals: JournalsService,
  ) {}

  // ── 대장 ─────────────────────────────────────────────

  /** 정률법의 연 단위 계산은 회사 회계연도 기준이다 */
  private async startMonth(tx: Transaction) {
    const { companyId } = requireCompanyContext();
    const [company] = await tx
      .select({ startMonth: companies.fiscalYearStartMonth })
      .from(companies)
      .where(eq(companies.id, companyId));
    return company!.startMonth;
  }

  private async booked(tx: Transaction, assetIds: string[]) {
    if (assetIds.length === 0) return new Map<string, number>();
    const rows = await tx
      .select({
        assetId: assetDepreciations.assetId,
        amount: sql<number>`coalesce(sum(${assetDepreciations.amount}), 0)`.mapWith(Number),
      })
      .from(assetDepreciations)
      .where(inArray(assetDepreciations.assetId, assetIds))
      .groupBy(assetDepreciations.assetId);
    return new Map(rows.map((r) => [r.assetId, r.amount]));
  }

  async list() {
    return this.db.tenant(async (tx) => {
      const rows = await tx
        .select({
          a: fixedAssets,
          assetAccountName: sql<string>`(select name from ${accounts} x where x.id = ${fixedAssets.assetAccountId})`,
          departmentName: departments.name,
        })
        .from(fixedAssets)
        .leftJoin(departments, eq(departments.id, fixedAssets.departmentId))
        .orderBy(asc(fixedAssets.code));
      const booked = await this.booked(
        tx,
        rows.map((r) => r.a.id),
      );
      return rows.map(({ a, assetAccountName, departmentName }) => {
        const depreciated = booked.get(a.id) ?? 0;
        const accumulated = a.priorAccumulated + depreciated;
        return {
          id: a.id,
          code: a.code,
          name: a.name,
          assetAccountId: a.assetAccountId,
          assetAccountName,
          accumulatedAccountId: a.accumulatedAccountId,
          expenseAccountId: a.expenseAccountId,
          departmentId: a.departmentId,
          departmentName,
          acquisitionDate: a.acquisitionDate,
          cost: a.cost,
          residualValue: a.residualValue,
          usefulLifeYears: a.usefulLifeYears,
          method: a.method,
          priorAccumulated: a.priorAccumulated,
          accumulated,
          bookValue: a.cost - accumulated,
          /** 상각 전표가 하나라도 있으면 취득 정보를 고칠 수 없다 */
          locked: depreciated > 0 || !!a.disposedOn,
          disposedOn: a.disposedOn,
          disposalProceeds: a.disposalProceeds,
          disposalEntryId: a.disposalEntryId,
          memo: a.memo,
        };
      });
    });
  }

  private async getAsset(tx: Transaction, id: string): Promise<AssetRow> {
    const [row] = await tx.select().from(fixedAssets).where(eq(fixedAssets.id, id)).for('update');
    if (!row) throw new NotFoundException();
    return row;
  }

  /** 자산·누계액은 재무상태표 자산 계정, 감가상각비는 비용 계정이어야 한다 */
  private async assertAccounts(
    tx: Transaction,
    input: Pick<FixedAssetInput, 'assetAccountId' | 'accumulatedAccountId' | 'expenseAccountId'>,
  ) {
    const ids = [input.assetAccountId, input.accumulatedAccountId, input.expenseAccountId];
    const rows = await tx
      .select({ id: accounts.id, group: accounts.group, name: accounts.name })
      .from(accounts)
      .where(inArray(accounts.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const category = (id: string) => {
      const a = byId.get(id);
      if (!a) throw new AppException('ACCOUNT_NOT_FOUND', '없는 계정과목이 있습니다.');
      return STATEMENT_GROUPS[a.group].category;
    };
    if (
      category(input.assetAccountId) !== 'asset' ||
      category(input.accumulatedAccountId) !== 'asset'
    ) {
      throw new AppException(
        'ASSET_ACCOUNT_INVALID',
        '자산 계정과 상각누계액 계정은 자산 계정(예: 212 비품 / 213 감가상각누계액)이어야 합니다.',
      );
    }
    if (category(input.expenseAccountId) !== 'expense') {
      throw new AppException(
        'ASSET_ACCOUNT_INVALID',
        '감가상각비 계정은 비용 계정(예: 818 감가상각비)이어야 합니다.',
      );
    }
  }

  private async nextCode(tx: Transaction) {
    const [row] = await tx
      .select({
        n: sql<number>`coalesce(max(substring(${fixedAssets.code} from '^FA([0-9]+)$')::int), 0)`.mapWith(
          Number,
        ),
      })
      .from(fixedAssets);
    return `FA${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
  }

  async create(input: FixedAssetInput) {
    const { companyId } = requireCompanyContext();
    try {
      const id = await this.db.tenant(async (tx) => {
        await this.assertAccounts(tx, input);
        checkSchedule({
          method: input.method,
          cost: input.cost,
          residualValue: input.residualValue,
          usefulLifeYears: input.usefulLifeYears,
          acquisitionDate: input.acquisitionDate,
          fiscalYearStartMonth: await this.startMonth(tx),
        });
        const [row] = await tx
          .insert(fixedAssets)
          .values({
            ...input,
            code: input.code ?? (await this.nextCode(tx)),
            departmentId: input.departmentId ?? null,
            memo: input.memo ?? null,
            companyId,
          })
          .returning({ id: fixedAssets.id });
        await this.audit.record(
          { action: 'asset.create', entity: 'fixed_asset', entityId: row!.id, after: input },
          tx,
        );
        return row!.id;
      });
      return this.find(id);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new AppException(
          'DUPLICATE_CODE',
          `자산코드 ${input.code} 가 이미 있습니다.`,
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }
  }

  private async find(id: string) {
    const found = (await this.list()).find((a) => a.id === id);
    if (!found) throw new NotFoundException();
    return found;
  }

  async update(id: string, input: FixedAssetUpdateInput) {
    await this.db.tenant(async (tx) => {
      const before = await this.getAsset(tx, id);
      const depreciated = (await this.booked(tx, [id])).get(id) ?? 0;
      const changesCost = (
        [
          'acquisitionDate',
          'cost',
          'residualValue',
          'usefulLifeYears',
          'method',
          'priorAccumulated',
        ] as const
      ).some((k) => input[k] !== undefined && input[k] !== before[k]);
      if (changesCost && (depreciated > 0 || before.disposedOn)) {
        throw new AppException(
          'ASSET_LOCKED',
          '상각 전표가 있는 자산은 취득 정보를 바꿀 수 없습니다. 이름·부서·메모만 바꿀 수 있습니다.',
          HttpStatus.CONFLICT,
        );
      }
      if (changesCost) {
        checkSchedule(
          scheduleInput({ ...before, ...input } as AssetRow, await this.startMonth(tx)),
        );
      }
      await tx
        .update(fixedAssets)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(fixedAssets.id, id));
      await this.audit.record(
        { action: 'asset.update', entity: 'fixed_asset', entityId: id, before, after: input },
        tx,
      );
    });
    return this.find(id);
  }

  async remove(id: string) {
    await this.db.tenant(async (tx) => {
      const before = await this.getAsset(tx, id);
      const depreciated = (await this.booked(tx, [id])).get(id) ?? 0;
      if (depreciated > 0 || before.disposedOn) {
        throw new AppException(
          'ASSET_LOCKED',
          '상각하거나 처분한 자산은 지울 수 없습니다.',
          HttpStatus.CONFLICT,
        );
      }
      await tx.delete(fixedAssets).where(eq(fixedAssets.id, id));
      await this.audit.record(
        { action: 'asset.delete', entity: 'fixed_asset', entityId: id, before },
        tx,
      );
    });
  }

  /** 내용연수 전체 상각 일정과 실제 반영한 금액 */
  async schedule(id: string) {
    return this.db.tenant(async (tx) => {
      const [asset] = await tx.select().from(fixedAssets).where(eq(fixedAssets.id, id));
      if (!asset) throw new NotFoundException();
      const booked = await tx
        .select({ month: assetDepreciations.month, amount: assetDepreciations.amount })
        .from(assetDepreciations)
        .where(eq(assetDepreciations.assetId, id));
      const byMonth = new Map(booked.map((b) => [b.month, b.amount]));
      return depreciationSchedule(scheduleInput(asset, await this.startMonth(tx))).map((m) => ({
        ...m,
        booked: byMonth.get(m.month) ?? null,
      }));
    });
  }

  // ── 월 상각 ──────────────────────────────────────────

  async listRuns() {
    return this.db.tenant(async (tx) => {
      const rows = await tx
        .select({
          id: depreciationRuns.id,
          month: depreciationRuns.month,
          totalAmount: depreciationRuns.totalAmount,
          entryId: depreciationRuns.entryId,
          entryDate: journalEntries.entryDate,
          entryNo: journalEntries.entryNo,
          createdAt: depreciationRuns.createdAt,
        })
        .from(depreciationRuns)
        .leftJoin(journalEntries, eq(journalEntries.id, depreciationRuns.entryId))
        .orderBy(desc(depreciationRuns.month));
      return rows.map((r) => ({
        id: r.id,
        month: r.month,
        totalAmount: r.totalAmount,
        entryId: r.entryId,
        entryNumber:
          r.entryDate && r.entryNo !== null ? formatJournalNo(r.entryDate, r.entryNo) : null,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  /** 그 달의 감가상각을 계산해 전표 한 장으로 전기한다(같은 달은 한 번만, 달 순서대로). */
  async run(month: string) {
    const { companyId, userId } = requireCompanyContext();
    const result = await this.db
      .tenant(async (tx) => {
        // 같은 회사의 상각 실행이 동시에 돌지 않게 잠근다
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`depreciation:${companyId}`}))`,
        );
        const [latest] = await tx
          .select({ month: depreciationRuns.month })
          .from(depreciationRuns)
          .orderBy(desc(depreciationRuns.month))
          .limit(1);
        if (latest && latest.month >= month) {
          throw new AppException(
            latest.month === month ? 'DEPRECIATION_ALREADY_RUN' : 'DEPRECIATION_ORDER',
            latest.month === month
              ? `${month} 감가상각은 이미 반영했습니다.`
              : `${latest.month} 까지 반영되어 있어 그 이전 달은 실행할 수 없습니다. 마지막 실행을 취소한 뒤 다시 실행해 주세요.`,
            HttpStatus.CONFLICT,
          );
        }
        const end = monthEnd(month);
        const assets = await tx
          .select()
          .from(fixedAssets)
          .where(
            and(
              sql`${fixedAssets.acquisitionDate} <= ${end}`,
              sql`(${fixedAssets.disposedOn} is null or ${fixedAssets.disposedOn} > ${end})`,
            ),
          )
          .orderBy(asc(fixedAssets.code));
        const booked = await this.booked(
          tx,
          assets.map((a) => a.id),
        );
        const startMonth = await this.startMonth(tx);
        const amounts = assets
          .map((a) => ({
            asset: a,
            amount:
              accumulatedDepreciation(scheduleInput(a, startMonth), month) -
              a.priorAccumulated -
              (booked.get(a.id) ?? 0),
          }))
          .filter((x) => x.amount > 0);
        const totalAmount = amounts.reduce((s, x) => s + x.amount, 0);

        let entryId: string | null = null;
        if (totalAmount > 0) {
          // (차) 감가상각비[계정·부서별] / (대) 상각누계액[계정별]
          const debits = new Map<
            string,
            { accountId: string; departmentId: string | null; amount: number }
          >();
          const credits = new Map<string, number>();
          for (const { asset, amount } of amounts) {
            const key = `${asset.expenseAccountId}:${asset.departmentId ?? ''}`;
            const d = debits.get(key) ?? {
              accountId: asset.expenseAccountId,
              departmentId: asset.departmentId,
              amount: 0,
            };
            d.amount += amount;
            debits.set(key, d);
            credits.set(
              asset.accumulatedAccountId,
              (credits.get(asset.accumulatedAccountId) ?? 0) + amount,
            );
          }
          const memo = `${month} 감가상각`;
          entryId = await this.journals.createIn(
            tx,
            {
              entry: {
                entryDate: end,
                type: 'general',
                description: memo,
                lines: [
                  ...[...debits.values()].map((d) => ({
                    accountId: d.accountId,
                    departmentId: d.departmentId,
                    debit: d.amount,
                    credit: 0,
                    memo,
                  })),
                  ...[...credits.entries()].map(([accountId, amount]) => ({
                    accountId,
                    debit: 0,
                    credit: amount,
                    memo,
                  })),
                ],
              },
              status: 'posted',
            },
            { source: 'depreciation', sourceRef: month },
          );
        }
        const [run] = await tx
          .insert(depreciationRuns)
          .values({ companyId, month, entryId, totalAmount, createdBy: userId })
          .returning({ id: depreciationRuns.id });
        if (amounts.length > 0) {
          await tx.insert(assetDepreciations).values(
            amounts.map(({ asset, amount }) => ({
              companyId,
              runId: run!.id,
              assetId: asset.id,
              month,
              amount,
            })),
          );
        }
        await this.audit.record(
          {
            action: 'depreciation.run',
            entity: 'depreciation_run',
            entityId: run!.id,
            after: { month, totalAmount, assets: amounts.length },
          },
          tx,
        );
        return { month, totalAmount, assets: amounts.length, entryId };
      })
      .catch((e: unknown) => {
        if (isUniqueViolation(e)) {
          throw new AppException(
            'DEPRECIATION_ALREADY_RUN',
            `${month} 감가상각은 이미 반영했습니다.`,
            HttpStatus.CONFLICT,
          );
        }
        throw e;
      });
    return result;
  }

  /** 마지막 상각 실행을 취소한다(전표는 역분개). */
  async cancelRun(month: string) {
    await this.db.tenant(async (tx) => {
      const [latest] = await tx
        .select()
        .from(depreciationRuns)
        .orderBy(desc(depreciationRuns.month))
        .limit(1);
      if (!latest || latest.month !== month) {
        throw new AppException(
          'DEPRECIATION_NOT_LATEST',
          '가장 마지막에 실행한 달만 취소할 수 있습니다.',
          HttpStatus.CONFLICT,
        );
      }
      const disposedAfter = await tx
        .select({ id: fixedAssets.id })
        .from(fixedAssets)
        .where(sql`${fixedAssets.disposedOn} >= ${`${month}-01`}`)
        .limit(1);
      if (disposedAfter.length > 0) {
        throw new AppException(
          'DEPRECIATION_LOCKED_BY_DISPOSAL',
          '이 달 이후에 처분한 자산이 있어 취소할 수 없습니다.',
          HttpStatus.CONFLICT,
        );
      }
      if (latest.entryId) {
        await this.journals.reverseIn(
          tx,
          latest.entryId,
          { entryDate: monthEnd(month), description: `[취소] ${month} 감가상각` },
          { system: true },
        );
      }
      await tx.delete(depreciationRuns).where(eq(depreciationRuns.id, latest.id));
      await this.audit.record(
        {
          action: 'depreciation.cancel',
          entity: 'depreciation_run',
          entityId: latest.id,
          before: latest,
        },
        tx,
      );
    });
  }

  // ── 처분 ─────────────────────────────────────────────

  /**
   * 매각·폐기: (차) 상각누계액 + 처분대금 [+ 처분손실] / (대) 자산 취득가 [+ 처분이익].
   * 처분일이 속한 달까지 상각을 먼저 실행해 두어야 장부가가 정확하다.
   */
  async dispose(id: string, input: AssetDisposeInput) {
    await this.db.tenant(async (tx) => {
      const asset = await this.getAsset(tx, id);
      if (asset.disposedOn) {
        throw new AppException('ASSET_DISPOSED', '이미 처분한 자산입니다.', HttpStatus.CONFLICT);
      }
      if (input.disposedOn < asset.acquisitionDate) {
        throw new AppException('DISPOSAL_DATE_INVALID', '처분일이 취득일보다 빠릅니다.');
      }
      const [laterRun] = await tx
        .select({ month: assetDepreciations.month })
        .from(assetDepreciations)
        .where(
          and(
            eq(assetDepreciations.assetId, id),
            sql`${assetDepreciations.month} > ${input.disposedOn.slice(0, 7)}`,
          ),
        )
        .limit(1);
      if (laterRun) {
        throw new AppException(
          'DISPOSAL_DATE_INVALID',
          `처분일 이후(${laterRun.month})에도 상각이 반영되어 있습니다. 그 상각 실행을 먼저 취소해 주세요.`,
        );
      }
      if (input.proceeds > 0 && !input.proceedsAccountId) {
        throw new AppException(
          'PROCEEDS_ACCOUNT_REQUIRED',
          '처분대금을 받을 계정을 선택해 주세요.',
        );
      }
      const accumulated = asset.priorAccumulated + ((await this.booked(tx, [id])).get(id) ?? 0);
      const profit = disposalProfit(asset.cost, accumulated, input.proceeds);
      const plCode = profit >= 0 ? DISPOSAL_GAIN : DISPOSAL_LOSS;
      const [pl] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.code, plCode));
      if (profit !== 0 && !pl) {
        throw new AppException('ACCOUNT_NOT_FOUND', `처분손익 계정(${plCode})이 없습니다.`);
      }
      const memo = `${asset.name} 처분`;
      const lines = [
        ...(accumulated > 0
          ? [{ accountId: asset.accumulatedAccountId, debit: accumulated, credit: 0, memo }]
          : []),
        ...(input.proceeds > 0
          ? [
              {
                accountId: input.proceedsAccountId!,
                partnerId: input.partnerId ?? null,
                debit: input.proceeds,
                credit: 0,
                memo,
              },
            ]
          : []),
        ...(profit < 0 ? [{ accountId: pl!.id, debit: -profit, credit: 0, memo }] : []),
        { accountId: asset.assetAccountId, debit: 0, credit: asset.cost, memo },
        ...(profit > 0 ? [{ accountId: pl!.id, debit: 0, credit: profit, memo }] : []),
      ];
      const entryId = await this.journals.createIn(
        tx,
        {
          entry: { entryDate: input.disposedOn, type: 'general', description: memo, lines },
          status: 'posted',
        },
        { source: 'asset_disposal', sourceRef: asset.id },
      );
      await tx
        .update(fixedAssets)
        .set({
          disposedOn: input.disposedOn,
          disposalProceeds: input.proceeds,
          disposalEntryId: entryId,
          updatedAt: new Date(),
        })
        .where(eq(fixedAssets.id, id));
      await this.audit.record(
        {
          action: 'asset.dispose',
          entity: 'fixed_asset',
          entityId: id,
          after: { ...input, accumulated, profit, entryId },
        },
        tx,
      );
    });
    return this.find(id);
  }
}
