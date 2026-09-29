import { HttpStatus, Injectable } from '@nestjs/common';
import { addDays, daysBetween, todayInKorea } from '@wellbuddy/accounting-core';
import { companies, type EvidenceSource, type Transaction } from '@wellbuddy/db';
import {
  type BankProvider,
  type BankTransactionRecord,
  type CardApprovalRecord,
  type CardProvider,
  type DateRange,
  type HometaxProvider,
  ProviderError,
  ProviderRegistry,
} from '@wellbuddy/integrations';
import {
  COLLECT_CHANNEL_LABELS,
  COLLECT_CHANNELS,
  type CollectChannel,
  type CollectRequest,
  DEFAULT_COLLECT_DAYS,
  getProvider,
  MAX_COLLECT_DAYS,
} from '@wellbuddy/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { EvidenceStore, type InsertResult } from './evidence-store.service.js';
import { SourcesService } from './sources.service.js';

export interface CollectResult extends InsertResult {
  runId: string;
  status: 'success' | 'error';
  from: string;
  to: string;
  message: string;
}

/** 공급자에서 받아 온 기록을 한 트랜잭션 안에서 저장하는 함수 */
type Save = (tx: Transaction, runId: string) => Promise<{ result: InsertResult; detail: string }>;

const sum = (results: InsertResult[]): InsertResult =>
  results.reduce(
    (a, r) => ({
      fetched: a.fetched + r.fetched,
      inserted: a.inserted + r.inserted,
      duplicates: a.duplicates + r.duplicates,
    }),
    { fetched: 0, inserted: 0, duplicates: 0 },
  );

const counts = (r: InsertResult) => `${r.fetched}건(새로 ${r.inserted}건)`;

/**
 * 자동 수집: 연동관리에서 고른 공급자(모의·CODEF·팝빌)로 통장·카드·홈택스 자료를 가져온다.
 * 외부 호출은 DB 트랜잭션 밖에서 하고, 저장은 한 번에 한다. 실패해도 수집 이력에 남긴다.
 */
@Injectable()
export class CollectionService {
  constructor(
    private readonly db: DbService,
    private readonly store: EvidenceStore,
    private readonly sources: SourcesService,
    private readonly integrations: IntegrationsService,
    private readonly registry: ProviderRegistry,
    private readonly audit: AuditService,
  ) {}

  /** 증빙 화면에서 보는 채널별 수집 설정과 마지막 결과 */
  async status() {
    return Promise.all(
      COLLECT_CHANNELS.map(async (channel) => {
        const s = await this.integrations.get(channel);
        const def = getProvider(channel, s.provider);
        return {
          channel,
          label: COLLECT_CHANNEL_LABELS[channel],
          provider: s.provider,
          providerLabel: def?.label ?? s.provider,
          enabled: s.enabled,
          /** 켜져 있고 자동 수집 공급자(파일 업로드가 아님)인지 */
          collectable: s.enabled && this.registry.has(channel, s.provider),
          schedule: s.schedule,
          lastStatus: s.lastStatus,
          lastMessage: s.lastMessage,
          lastRunAt: s.lastRunAt,
        };
      }),
    );
  }

  private range(req: CollectRequest): DateRange {
    const today = todayInKorea();
    const to = req.to && req.to < today ? req.to : today;
    const from = req.from ?? addDays(to, -(DEFAULT_COLLECT_DAYS - 1));
    if (from > to) {
      throw new AppException('INVALID_RANGE', '시작일이 오늘 또는 종료일보다 늦습니다.');
    }
    if (daysBetween(from, to) + 1 > MAX_COLLECT_DAYS) {
      throw new AppException(
        'RANGE_TOO_LONG',
        `한 번에 ${MAX_COLLECT_DAYS}일까지 수집할 수 있습니다. 기간을 나눠 주세요.`,
      );
    }
    return { from, to };
  }

  private resolve<C extends CollectChannel>(
    channel: C,
    setting: Awaited<ReturnType<IntegrationsService['providerSetting']>>,
    context: { companyId: string; companyName: string; bizNo: string | null },
  ) {
    try {
      return this.registry.resolve(channel, setting, context);
    } catch (e) {
      if (e instanceof ProviderError) throw new AppException(e.code, e.message);
      throw e;
    }
  }

  async collect(channel: CollectChannel, req: CollectRequest): Promise<CollectResult> {
    const { companyId } = requireCompanyContext();
    const range = this.range(req);
    const setting = await this.integrations.providerSetting(channel);
    const { company, banks, cards } = await this.db.tenant(async (tx) => {
      const [company] = await tx
        .select({ name: companies.name, bizRegNo: companies.bizRegNo })
        .from(companies)
        .where(eq(companies.id, companyId));
      return {
        company: company!,
        banks: channel === 'bank' ? await this.sources.activeBankRefs(tx) : [],
        cards: channel === 'card' ? await this.sources.activeCardRefs(tx) : [],
      };
    });
    const context = { companyId, companyName: company.name, bizNo: company.bizRegNo || null };
    const provider = this.resolve(channel, setting, context);
    const source = setting.provider as EvidenceSource;
    if (channel === 'bank' && banks.length === 0) {
      throw new AppException(
        'NO_SOURCES',
        '사용 중인 계좌가 없습니다. 계좌·카드에서 등록해 주세요.',
      );
    }
    if (channel === 'card' && cards.length === 0) {
      throw new AppException(
        'NO_SOURCES',
        '사용 중인 카드가 없습니다. 계좌·카드에서 등록해 주세요.',
      );
    }

    const runId = await this.db.tenant((tx) =>
      this.store.startRun(tx, channel, setting.provider, 'manual'),
    );
    try {
      let save: Save;
      if (channel === 'bank') {
        const bank = provider as BankProvider;
        const fetched: { account: (typeof banks)[number]; records: BankTransactionRecord[] }[] = [];
        for (const account of banks) {
          fetched.push({ account, records: await bank.fetchTransactions(account, range) });
        }
        save = async (tx, run) => {
          const results = [];
          for (const f of fetched) {
            results.push(await this.store.insertBank(tx, f.account.id, f.records, source, run));
          }
          return { result: sum(results), detail: `계좌 ${fetched.length}개` };
        };
      } else if (channel === 'card') {
        const card = provider as CardProvider;
        const fetched: { card: (typeof cards)[number]; records: CardApprovalRecord[] }[] = [];
        for (const c of cards) {
          fetched.push({ card: c, records: await card.fetchApprovals(c, range) });
        }
        save = async (tx, run) => {
          const results = [];
          for (const f of fetched) {
            results.push(await this.store.insertCards(tx, f.card.id, f.records, source, run));
          }
          return { result: sum(results), detail: `카드 ${fetched.length}장` };
        };
      } else {
        const hometax = provider as HometaxProvider;
        const invoices = [
          ...(await hometax.fetchTaxInvoices('sales', range)),
          ...(await hometax.fetchTaxInvoices('purchase', range)),
        ];
        const receipts = [
          ...(await hometax.fetchCashReceipts('sales', range)),
          ...(await hometax.fetchCashReceipts('purchase', range)),
        ];
        save = async (tx, run) => {
          const inv = await this.store.insertTaxInvoices(tx, invoices, source, run);
          const cash = await this.store.insertCashReceipts(tx, receipts, source, run);
          return {
            result: sum([inv, cash]),
            detail: `세금계산서 ${counts(inv)}, 현금영수증 ${counts(cash)}`,
          };
        };
      }

      return await this.db.tenant(async (tx) => {
        const { result, detail } = await save(tx, runId);
        const message = `${range.from}~${range.to} ${detail}: ${result.fetched}건 중 새로 ${result.inserted}건, 중복 ${result.duplicates}건`;
        await this.store.finishRun(tx, runId, channel, { ...result, status: 'success', message });
        await this.audit.record(
          {
            action: 'evidence.collect',
            entity: 'collection_run',
            entityId: runId,
            after: { channel, provider: setting.provider, ...range, ...result },
          },
          tx,
        );
        return { runId, status: 'success' as const, ...range, ...result, message };
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      const message = `수집하지 못했습니다: ${reason}`;
      await this.db.tenant((tx) =>
        this.store.finishRun(tx, runId, channel, {
          fetched: 0,
          inserted: 0,
          duplicates: 0,
          status: 'error',
          message,
        }),
      );
      throw new AppException('COLLECTION_FAILED', message, HttpStatus.BAD_GATEWAY, { runId });
    }
  }
}
