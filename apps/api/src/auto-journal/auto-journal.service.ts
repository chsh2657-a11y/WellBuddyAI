import { HttpStatus, Injectable } from '@nestjs/common';
import { STATEMENT_GROUPS, SYSTEM_ACCOUNTS } from '@wellbuddy/accounting-core';
import {
  accounts,
  autoJournalMemory,
  autoJournalRules,
  autoJournalSettings,
  bankTransactions,
  cardTransactions,
  cashReceipts,
  companies,
  departments,
  evidenceSuggestions,
  partners,
  projects,
  receipts,
  taxInvoices,
  type Transaction,
} from '@wellbuddy/db';
import {
  AUTO_JOURNAL_KIND_LABELS,
  type AutoJournalKind,
  type AutoJournalSettings,
  CARD_COMPANIES,
  type EvidenceRef,
  type SuggestionMethod,
  type SuggestionUpdateInput,
  type UploadKind,
} from '@wellbuddy/shared';
import {
  type AiClassifier,
  type ClassifyInput,
  type ClassifySuggestion,
  ProviderRegistry,
} from '@wellbuddy/integrations';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { JournalsService } from '../accounting/journals.service.js';
import { PartnersService } from '../accounting/partners.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { defaultSuggestion } from './engine/defaults.js';
import { historyKeys, type MemoryRow, recommendFromHistory } from './engine/history.js';
import { entryDescription, normalizeName } from './engine/items.js';
import { buildEntry } from './engine/lines.js';
import { type CardLike, matchReceipts, pairCancellations } from './engine/matching.js';
import { findRule } from './engine/rules.js';
import { matchSettlement, type OpenInvoice } from './engine/settlement.js';
import { type LoadedItem, loadItems } from './evidence-items.js';

const EVIDENCE_TABLES = {
  bank: bankTransactions,
  card: cardTransactions,
  tax_invoice: taxInvoices,
  cash_receipt: cashReceipts,
} as const;

/** 전표 적요 앞말 */
const ENTRY_LABEL: Record<AutoJournalKind, string> = {
  bank_in: '입금',
  bank_out: '출금',
  card: '카드',
  card_cancel: '카드 취소',
  tax_sales: '매출',
  tax_purchase: '매입',
  cash_sales: '현금매출',
  cash_purchase: '현금영수증',
};

const DEFAULT_SETTINGS: AutoJournalSettings = { autoPost: false, threshold: 0.9 };
/** 한 번에 AI 에 보내는 거래 수 */
const AI_BATCH = 50;

/** AI 에 보내는 거래: 들어온 돈은 +, 나간 돈은 − */
function classifyInput(item: LoadedItem): ClassifyInput {
  const inflow = ['bank_in', 'tax_sales', 'cash_sales'].includes(item.kind);
  const sign = (inflow ? 1 : -1) * (item.reversal ? -1 : 1);
  return {
    kind: item.evidenceKind,
    date: item.date,
    description: item.description,
    counterparty: item.counterparty === item.description ? null : item.counterparty,
    amount: sign * item.amount,
    vatAmount: item.vat,
  };
}

export interface Suggestion {
  accountId: string | null;
  deductible: boolean | null;
  partnerId: string | null;
  departmentId: string | null;
  projectId: string | null;
  memo: string | null;
  confidence: number;
  method: SuggestionMethod;
  reason: string | null;
  ruleId: string | null;
  edited: boolean;
  error: string | null;
  /** 이 입출금으로 반제할 세금계산서(P2-27) */
  settles: string[] | null;
}

/** 반제를 기다리는 외상 세금계산서(방향별, 오래된 순) */
interface OpenInvoiceRow extends OpenInvoice {
  partnerId: string | null;
  /** 정규화한 상대 이름 */
  name: string;
}

interface AccountInfo {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  requiresPartner: boolean;
  category: string;
}

interface Context {
  accountById: Map<string, AccountInfo>;
  accountByCode: Map<string, AccountInfo>;
  rules: (typeof autoJournalRules.$inferSelect)[];
  memory: Map<AutoJournalKind, MemoryRow[]>;
  settings: AutoJournalSettings;
  postStatus: 'posted' | 'pending';
  openInvoices: { sales: OpenInvoiceRow[]; purchase: OpenInvoiceRow[] };
  /** 이번 실행에서 이미 다른 입출금에 짝지은 세금계산서 */
  claimed: Set<string>;
}

const refKey = (r: { evidenceKind: string; evidenceId: string }) =>
  `${r.evidenceKind}:${r.evidenceId}`;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * 자동분개(P2-19~24): 자동 매칭 → 분류(회사 규칙 → 과거 이력 → 기본 추천) →
 * 신뢰도가 기준 이상이면 자동 전기, 아니면 검토함. 검토함에서 고치고 승인하면 이력으로 배운다.
 */
@Injectable()
export class AutoJournalService {
  constructor(
    private readonly db: DbService,
    private readonly journals: JournalsService,
    private readonly partnersService: PartnersService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
    private readonly registry: ProviderRegistry,
  ) {}

  // ── 설정 ───────────────────────────────────────────

  private async settingsIn(tx: Transaction): Promise<AutoJournalSettings> {
    const [row] = await tx.select().from(autoJournalSettings);
    return row ? { autoPost: row.autoPost, threshold: row.threshold } : DEFAULT_SETTINGS;
  }

  getSettings() {
    return this.db.tenant((tx) => this.settingsIn(tx));
  }

  async updateSettings(input: AutoJournalSettings) {
    const { companyId } = requireCompanyContext();
    return this.db.tenant(async (tx) => {
      const before = await this.settingsIn(tx);
      await tx
        .insert(autoJournalSettings)
        .values({ companyId, ...input })
        .onConflictDoUpdate({
          target: autoJournalSettings.companyId,
          set: { ...input, updatedAt: new Date() },
        });
      await this.audit.record(
        {
          action: 'auto_journal.settings',
          entity: 'company',
          entityId: companyId,
          before,
          after: input,
        },
        tx,
      );
      return input;
    });
  }

  // ── 분류 ───────────────────────────────────────────

  private async context(tx: Transaction): Promise<Context> {
    const { role } = requireCompanyContext();
    const accountRows = (
      await tx
        .select({
          id: accounts.id,
          code: accounts.code,
          name: accounts.name,
          isActive: accounts.isActive,
          requiresPartner: accounts.requiresPartner,
          group: accounts.group,
        })
        .from(accounts)
    ).map(({ group, ...a }) => ({ ...a, category: STATEMENT_GROUPS[group].category }));
    const rules = await tx
      .select()
      .from(autoJournalRules)
      .where(eq(autoJournalRules.isActive, true));
    const memoryRows = await tx.select().from(autoJournalMemory);
    const memory = new Map<AutoJournalKind, MemoryRow[]>();
    for (const m of memoryRows) {
      memory.set(m.kind, [...(memory.get(m.kind) ?? []), m]);
    }
    const [company] = await tx
      .select({ approval: companies.journalApprovalRequired })
      .from(companies);
    const manager = role === 'owner' || role === 'admin';
    const invoiceRows = await tx
      .select({
        id: taxInvoices.id,
        direction: taxInvoices.direction,
        date: taxInvoices.issueDate,
        total: taxInvoices.totalAmount,
        partnerId: taxInvoices.partnerId,
        supplierName: taxInvoices.supplierName,
        buyerName: taxInvoices.buyerName,
      })
      .from(taxInvoices)
      .where(and(eq(taxInvoices.status, 'posted'), isNull(taxInvoices.settledAt)))
      .orderBy(asc(taxInvoices.issueDate), asc(taxInvoices.createdAt));
    const openInvoices = { sales: [] as OpenInvoiceRow[], purchase: [] as OpenInvoiceRow[] };
    for (const r of invoiceRows) {
      openInvoices[r.direction].push({
        id: r.id,
        date: r.date,
        total: r.total,
        partnerId: r.partnerId,
        name: normalizeName(r.direction === 'sales' ? r.buyerName : r.supplierName),
      });
    }
    return {
      accountById: new Map(accountRows.map((a) => [a.id, a])),
      accountByCode: new Map(accountRows.map((a) => [a.code, a])),
      rules,
      memory,
      settings: await this.settingsIn(tx),
      postStatus: company?.approval && !manager ? 'pending' : 'posted',
      openInvoices,
      claimed: new Set(),
    };
  }

  /**
   * 외상 반제(P2-27): 통장 입금은 매출, 출금은 매입 세금계산서 중 같은 거래처(또는 같은 이름)의
   * 미결분과 금액을 맞춘다. 맞춘 세금계산서는 이번 실행의 다른 입출금에 다시 쓰지 않는다.
   */
  private settle(item: LoadedItem, ctx: Context): Suggestion | null {
    if (item.kind !== 'bank_in' && item.kind !== 'bank_out') return null;
    const sales = item.kind === 'bank_in';
    const name = item.counterparty ? normalizeName(item.counterparty) : '';
    const candidates = ctx.openInvoices[sales ? 'sales' : 'purchase'].filter(
      (inv) =>
        !ctx.claimed.has(inv.id) &&
        ((item.partnerId && inv.partnerId === item.partnerId) || (!!name && inv.name === name)),
    );
    if (candidates.length === 0) return null;
    const label = sales ? '외상매출금' : '외상매입금';
    const found = matchSettlement(item.amount, candidates, label);
    const account = ctx.accountByCode.get(
      sales ? SYSTEM_ACCOUNTS.accountsReceivable : SYSTEM_ACCOUNTS.accountsPayable,
    );
    if (!found || !account?.isActive) return null;
    for (const id of found.ids) ctx.claimed.add(id);
    const partnerId = item.partnerId ?? candidates.find((c) => c.partnerId)?.partnerId ?? null;
    return {
      accountId: account.id,
      deductible: null,
      partnerId,
      departmentId: null,
      projectId: null,
      memo: null,
      confidence: found.confidence,
      method: 'settlement',
      reason: found.reason,
      ruleId: null,
      edited: false,
      error: null,
      settles: found.ids.length ? found.ids : null,
    };
  }

  /** 회사 규칙 → 외상 반제 → 과거 이력 → 기본 추천 순서로 계정을 고른다(AI 는 run 에서) */
  classify(item: LoadedItem, ctx: Context): Suggestion {
    const base = {
      departmentId: null,
      projectId: null,
      memo: null,
      ruleId: null,
      edited: false,
      error: null,
      settles: null,
    };
    const rule = findRule(ctx.rules, item);
    if (rule) {
      return {
        ...base,
        accountId: rule.accountId,
        deductible: rule.deductible,
        partnerId: rule.assignPartnerId ?? item.partnerId,
        departmentId: rule.departmentId,
        projectId: rule.projectId,
        memo: rule.memo,
        confidence: 1,
        method: 'rule',
        reason: `회사 규칙 '${rule.name}'`,
        ruleId: rule.id,
      };
    }
    const settlement = this.settle(item, ctx);
    if (settlement) return settlement;
    const history = recommendFromHistory(item, ctx.memory.get(item.kind) ?? []);
    if (history && ctx.accountById.get(history.accountId)?.isActive) {
      return {
        ...base,
        accountId: history.accountId,
        deductible: history.deductible,
        partnerId: item.partnerId ?? history.partnerId,
        confidence: history.confidence,
        method: 'history',
        reason: history.reason,
      };
    }
    const fallback = defaultSuggestion(item);
    const account = fallback ? ctx.accountByCode.get(fallback.accountCode) : undefined;
    if (fallback && account?.isActive) {
      return {
        ...base,
        accountId: account.id,
        deductible: fallback.deductible,
        partnerId: item.partnerId,
        confidence: fallback.confidence,
        method: 'default',
        reason: fallback.reason,
      };
    }
    return {
      ...base,
      accountId: null,
      deductible: null,
      partnerId: item.partnerId,
      confidence: 0,
      method: 'none',
      reason: '추천할 계정이 없습니다. 계정을 골라 주세요.',
    };
  }

  private async saveSuggestion(tx: Transaction, item: LoadedItem, s: Suggestion) {
    const { companyId } = requireCompanyContext();
    const values = {
      itemKind: item.kind,
      accountId: s.accountId,
      deductible: s.deductible,
      partnerId: s.partnerId,
      departmentId: s.departmentId,
      projectId: s.projectId,
      memo: s.memo,
      confidence: s.confidence,
      method: s.method,
      reason: s.reason,
      ruleId: s.ruleId,
      edited: s.edited,
      error: s.error,
      settles: s.settles,
      updatedAt: new Date(),
    };
    await tx
      .insert(evidenceSuggestions)
      .values({
        companyId,
        evidenceKind: item.evidenceKind,
        evidenceId: item.evidenceId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          evidenceSuggestions.companyId,
          evidenceSuggestions.evidenceKind,
          evidenceSuggestions.evidenceId,
        ],
        set: values,
      });
  }

  private async setEvidenceStatus(
    tx: Transaction,
    kind: UploadKind,
    ids: string[],
    status: 'review' | 'matched' | 'posted',
    entryId: string | null = null,
  ) {
    if (ids.length === 0) return;
    const table = EVIDENCE_TABLES[kind];
    await tx
      .update(table)
      .set({ status, ...(status === 'posted' ? { entryId } : {}), updatedAt: new Date() })
      .where(inArray(table.id, ids));
  }

  private async suggestionsFor(tx: Transaction, items: LoadedItem[]) {
    const map = new Map<string, Suggestion>();
    if (items.length === 0) return map;
    const rows = await tx
      .select()
      .from(evidenceSuggestions)
      .where(
        inArray(
          evidenceSuggestions.evidenceId,
          items.map((i) => i.evidenceId),
        ),
      );
    for (const r of rows) map.set(refKey(r), r);
    return map;
  }

  // ── 자동 매칭(P2-19) ──────────────────────────────

  /** 카드 승인·취소 상쇄, 영수증 ↔ 카드 승인. 매칭된 증빙 열쇠를 돌려준다 */
  private async match(tx: Transaction, items: LoadedItem[]): Promise<Set<string>> {
    const matched = new Set<string>();
    const cards: CardLike[] = items
      .filter((i) => i.card)
      .map((i) => ({
        id: i.evidenceId,
        cardId: i.card!.cardId,
        approvalNo: i.card!.approvalNo,
        amount: i.amount,
        cancelled: i.reversal,
        date: i.date,
        merchantBizNo: i.bizNo,
      }));
    const pairs = pairCancellations(cards);
    const pairIds = pairs.flatMap((p) => [p.originalId, p.cancelId]);
    await this.setEvidenceStatus(tx, 'card', pairIds, 'matched');
    for (const id of pairIds) matched.add(`card:${id}`);

    // 영수증(OCR) ↔ 카드 승인: 이미 전기한 카드와도 짝지어 영수증을 중복 분개하지 않는다
    const pendingReceipts = await tx
      .select({
        id: receipts.id,
        date: receipts.txDate,
        totalAmount: receipts.totalAmount,
        bizNo: receipts.bizNo,
      })
      .from(receipts)
      .where(inArray(receipts.status, ['pending', 'review']));
    if (pendingReceipts.length > 0) {
      const amounts = [
        ...new Set(pendingReceipts.flatMap((r) => (r.totalAmount ? [r.totalAmount] : []))),
      ];
      const cardRows = amounts.length
        ? await tx
            .select()
            .from(cardTransactions)
            .where(
              and(
                inArray(cardTransactions.amount, amounts),
                eq(cardTransactions.cancelled, false),
                inArray(cardTransactions.status, ['pending', 'review', 'posted']),
              ),
            )
        : [];
      const found = matchReceipts(
        pendingReceipts,
        cardRows.map((c) => ({
          id: c.id,
          cardId: c.cardId,
          approvalNo: c.approvalNo,
          amount: c.amount,
          cancelled: c.cancelled,
          date: c.approvedDate,
          merchantBizNo: c.merchantBizNo,
        })),
      );
      for (const m of found) {
        await tx
          .update(receipts)
          .set({ status: 'matched', cardTransactionId: m.cardId, updatedAt: new Date() })
          .where(eq(receipts.id, m.receiptId));
      }
    }
    return matched;
  }

  // ── 전표 만들기 ────────────────────────────────────

  /** 추천대로 전표를 만들고 증빙을 전표와 잇는다 */
  private async post(tx: Transaction, item: LoadedItem, s: Suggestion, ctx: Context) {
    if (!s.accountId) throw new AppException('ACCOUNT_REQUIRED', '분개할 계정을 골라 주세요.');
    const account = ctx.accountById.get(s.accountId);
    if (!account?.isActive) {
      throw new AppException(
        'ACCOUNT_INACTIVE',
        '사용할 수 없는 계정입니다. 계정을 다시 골라 주세요.',
      );
    }
    const ledgerCode = item.ledgerAccountId
      ? (ctx.accountById.get(item.ledgerAccountId)?.code ?? null)
      : null;
    const draft = buildEntry(
      item,
      { accountCode: account.code, deductible: s.deductible },
      ledgerCode,
    );
    const needsPartner = (role: 'counterparty' | 'issuer') =>
      draft.lines.some(
        (l) => l.partnerRole === role && ctx.accountByCode.get(l.accountCode)?.requiresPartner,
      );

    let partnerId = s.partnerId ?? item.partnerId;
    // 세금계산서·현금영수증 상대는 사업자번호로 거래처를 자동 등록한다
    if (!partnerId && item.counterparty && item.bizNo && item.evidenceKind !== 'card') {
      partnerId = await this.partnersService.ensureIn(tx, {
        name: item.counterparty,
        bizRegNo: item.bizNo,
        kind: item.kind === 'tax_sales' || item.kind === 'cash_sales' ? 'customer' : 'supplier',
      });
      if (item.evidenceKind === 'tax_invoice') {
        await tx.update(taxInvoices).set({ partnerId }).where(eq(taxInvoices.id, item.evidenceId));
      }
    }
    // 카드대금 출금(미지급금 상환)의 상대가 카드사면, 카드 승인 전표와 같은 카드사 거래처로 찾거나 등록한다.
    // 카드 승인보다 카드대금을 먼저 전기해도 거래처가 없어 실패하지 않게 한다.
    const cardCompany =
      item.evidenceKind === 'bank' && item.counterparty
        ? CARD_COMPANIES.find((c) => item.counterparty!.replace(/\s/g, '').includes(c.name))
        : undefined;
    if (needsPartner('counterparty') && !partnerId && cardCompany) {
      partnerId = await this.partnersService.ensureIn(tx, {
        name: cardCompany.name,
        kind: 'other',
      });
    }
    if (needsPartner('counterparty') && !partnerId) {
      throw new AppException(
        'PARTNER_REQUIRED',
        `'${ctx.accountByCode.get(draft.lines.find((l) => l.partnerRole === 'counterparty')!.accountCode)?.name}' 계정은 거래처가 필요합니다. 거래처를 골라 주세요.`,
      );
    }
    const issuerId = needsPartner('issuer')
      ? await this.partnersService.ensureIn(tx, {
          name: item.issuerName ?? '카드사',
          kind: 'other',
        })
      : null;

    const lines = draft.lines.map((l) => {
      const target = ctx.accountByCode.get(l.accountCode);
      if (!target) {
        throw new AppException(
          'ACCOUNT_NOT_FOUND',
          `${l.accountCode} 계정이 없습니다. 계정과목을 확인해 주세요.`,
        );
      }
      return {
        accountId: target.id,
        debit: l.debit,
        credit: l.credit,
        partnerId:
          l.partnerRole === 'counterparty'
            ? partnerId
            : l.partnerRole === 'issuer'
              ? issuerId
              : null,
        departmentId: l.main ? s.departmentId : null,
        projectId: l.main ? s.projectId : null,
        memo: l.main ? s.memo : null,
      };
    });
    const entryId = await this.journals.createIn(
      tx,
      {
        entry: {
          entryDate: item.date,
          type: draft.type,
          description: s.memo ?? entryDescription(item, ENTRY_LABEL[item.kind]),
          lines,
          vat: draft.vat ? { ...draft.vat, partnerId } : null,
        },
        status: ctx.postStatus,
      },
      { source: 'evidence', sourceRef: refKey(item) },
    );
    await this.setEvidenceStatus(tx, item.evidenceKind, [item.evidenceId], 'posted', entryId);
    if (s.settles?.length) {
      await tx
        .update(taxInvoices)
        .set({ settledAt: new Date(), settledEntryId: entryId, updatedAt: new Date() })
        .where(and(inArray(taxInvoices.id, s.settles), isNull(taxInvoices.settledAt)));
    }
    return entryId;
  }

  /** 사용자가 승인한 분개를 이력으로 남긴다(과거 이력 추천·규칙 제안의 바탕) */
  private async learn(tx: Transaction, item: LoadedItem, s: Suggestion) {
    const { companyId } = requireCompanyContext();
    if (!s.accountId) return;
    for (const key of historyKeys(item)) {
      const label = (key.startsWith('desc:') ? item.description : item.counterparty) ?? null;
      await tx
        .insert(autoJournalMemory)
        .values({
          companyId,
          kind: item.kind,
          key,
          label,
          accountId: s.accountId,
          deductible: s.deductible,
          partnerId: s.partnerId,
          useCount: 1,
        })
        .onConflictDoUpdate({
          target: [
            autoJournalMemory.companyId,
            autoJournalMemory.kind,
            autoJournalMemory.key,
            autoJournalMemory.accountId,
          ],
          set: {
            useCount: sql`${autoJournalMemory.useCount} + 1`,
            label,
            deductible: s.deductible,
            partnerId: s.partnerId,
            lastUsedAt: new Date(),
          },
        });
    }
  }

  // ── 실행·검토·승인 ────────────────────────────────

  /** 연동관리에서 AI 분류(Claude)를 켰으면 분류기를 만든다 */
  private async aiClassifier(): Promise<{ ai: AiClassifier | null; error: string | null }> {
    const setting = await this.integrations.providerSetting('ai');
    if (!setting.enabled || !this.registry.has('ai', setting.provider)) {
      return { ai: null, error: null };
    }
    const { companyId } = requireCompanyContext();
    try {
      const ai = this.registry.resolve('ai', setting, { companyId, companyName: '', bizNo: null });
      return { ai, error: null };
    } catch (e) {
      return { ai: null, error: message(e) };
    }
  }

  /**
   * 분개 전 증빙(검토함에 있는 것 포함)을 매칭·분류하고, 기준 이상이면 자동 전기한다.
   *  ① 매칭·분류(트랜잭션) → ② 규칙·이력이 없는 거래만 AI 분류(트랜잭션 밖, 실패해도 계속)
   *  → ③ 자동 전기 또는 검토함(트랜잭션)
   */
  async run() {
    const { ai, error: aiSetupError } = await this.aiClassifier();
    const plan = await this.db.tenant(async (tx) => {
      const ctx = await this.context(tx);
      const items = await loadItems(tx, { statuses: ['pending', 'review'] });
      const matched = await this.match(tx, items);
      const existing = await this.suggestionsFor(tx, items);
      const planned = items
        .filter((item) => !matched.has(refKey(item)))
        .map((item) => {
          const prev = existing.get(refKey(item));
          const s: Suggestion = prev?.edited ? { ...prev, error: null } : this.classify(item, ctx);
          return { item, s, edited: !!prev?.edited };
        });
      const examples = [...ctx.memory.values()]
        .flat()
        .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
        .flatMap((m) => {
          const code = ctx.accountById.get(m.accountId)?.code;
          return code
            ? [
                {
                  description: m.key.slice(m.key.indexOf(':') + 1),
                  counterparty: null,
                  accountCode: code,
                },
              ]
            : [];
        })
        .slice(0, 30);
      const accountsForAi = [...ctx.accountById.values()]
        .filter((a) => a.isActive)
        .map((a) => ({ code: a.code, name: a.name, category: a.category }));
      const accountIdByCode = new Map(
        [...ctx.accountById.values()].filter((a) => a.isActive).map((a) => [a.code, a.id]),
      );
      return {
        planned,
        total: items.length,
        matched: matched.size,
        examples,
        accountsForAi,
        accountIdByCode,
      };
    });

    let aiClassified = 0;
    let aiError = aiSetupError;
    if (ai) {
      const candidates = plan.planned.filter(
        (p) => !p.edited && (p.s.method === 'none' || p.s.method === 'default'),
      );
      try {
        const results: (ClassifySuggestion | null)[] = [];
        for (let i = 0; i < candidates.length; i += AI_BATCH) {
          const chunk = candidates.slice(i, i + AI_BATCH);
          results.push(
            ...(await ai.classifyMany(
              chunk.map((p) => classifyInput(p.item)),
              { accounts: plan.accountsForAi, examples: plan.examples },
            )),
          );
        }
        candidates.forEach((p, i) => {
          const r = results[i];
          const accountId = r ? plan.accountIdByCode.get(r.accountCode) : undefined;
          if (!r || !accountId || (p.s.accountId && r.confidence <= p.s.confidence)) return;
          p.s = {
            ...p.s,
            accountId,
            deductible: r.vatType === 'non_deductible' ? false : p.s.deductible,
            confidence: r.confidence,
            method: 'ai',
            reason: `AI: ${r.reason}`,
          };
          aiClassified++;
        });
      } catch (e) {
        aiError = message(e);
      }
    }

    return this.db.tenant(async (tx) => {
      const ctx = await this.context(tx);
      // ①과 ③ 사이에 다른 사람이 처리한 증빙은 건너뛴다
      const current = new Map(
        (
          await loadItems(tx, {
            refs: plan.planned.map((p) => p.item),
            statuses: ['pending', 'review'],
          })
        ).map((i) => [refKey(i), i]),
      );
      const summary = {
        total: plan.total,
        matched: plan.matched,
        posted: 0,
        review: 0,
        failed: 0,
        aiClassified,
        aiError,
      };
      const ruleHits = new Map<string, number>();
      for (const planned of plan.planned) {
        const item = current.get(refKey(planned.item));
        if (!item) continue;
        const s = planned.s;
        if (s.ruleId && !planned.edited) ruleHits.set(s.ruleId, (ruleHits.get(s.ruleId) ?? 0) + 1);
        const auto =
          ctx.settings.autoPost && !!s.accountId && s.confidence >= ctx.settings.threshold;
        if (auto) {
          try {
            await tx.transaction((sp) => this.post(sp, item, s, ctx));
            await this.saveSuggestion(tx, item, s);
            summary.posted++;
            continue;
          } catch (e) {
            s.error = message(e);
            summary.failed++;
          }
        }
        await this.saveSuggestion(tx, item, s);
        await this.setEvidenceStatus(tx, item.evidenceKind, [item.evidenceId], 'review');
        summary.review++;
      }
      for (const [id, hits] of ruleHits) {
        await tx
          .update(autoJournalRules)
          .set({ hitCount: sql`${autoJournalRules.hitCount} + ${hits}`, lastHitAt: new Date() })
          .where(eq(autoJournalRules.id, id));
      }
      await this.audit.record(
        { action: 'auto_journal.run', entity: 'auto_journal', after: summary },
        tx,
      );
      return summary;
    });
  }

  /** 검토함: 추천 분개와 전표 미리보기 */
  async review(kind?: AutoJournalKind) {
    return this.db.tenant(async (tx) => {
      const items = (await loadItems(tx, { statuses: ['review'] })).filter(
        (i) => !kind || i.kind === kind,
      );
      const suggestions = await this.suggestionsFor(tx, items);
      const accountRows = await tx
        .select({ id: accounts.id, code: accounts.code, name: accounts.name })
        .from(accounts);
      const accountById = new Map(accountRows.map((a) => [a.id, a]));
      const accountByCode = new Map(accountRows.map((a) => [a.code, a]));
      const names = async (
        table: typeof partners | typeof departments | typeof projects,
        ids: (string | null)[],
      ) => {
        const list = [...new Set(ids.filter((v): v is string => !!v))];
        if (list.length === 0) return new Map<string, string>();
        const rows = await tx
          .select({ id: table.id, name: table.name })
          .from(table)
          .where(inArray(table.id, list));
        return new Map(rows.map((r) => [r.id, r.name]));
      };
      const all = [...suggestions.values()];
      const partnerNames = await names(partners, [
        ...all.map((s) => s.partnerId),
        ...items.map((i) => i.partnerId),
      ]);

      return items
        .map((item) => {
          const s = suggestions.get(refKey(item));
          const account = s?.accountId ? accountById.get(s.accountId) : undefined;
          let lines: { accountCode: string; accountName: string; debit: number; credit: number }[] =
            [];
          if (account) {
            try {
              const ledgerCode = item.ledgerAccountId
                ? (accountById.get(item.ledgerAccountId)?.code ?? null)
                : null;
              lines = buildEntry(
                item,
                { accountCode: account.code, deductible: s!.deductible },
                ledgerCode,
              ).lines.map((l) => ({
                accountCode: l.accountCode,
                accountName: accountByCode.get(l.accountCode)?.name ?? l.accountCode,
                debit: l.debit,
                credit: l.credit,
              }));
            } catch {
              lines = [];
            }
          }
          const partnerId = s?.partnerId ?? item.partnerId;
          return {
            evidenceKind: item.evidenceKind,
            evidenceId: item.evidenceId,
            kind: item.kind,
            kindLabel: AUTO_JOURNAL_KIND_LABELS[item.kind],
            date: item.date,
            description: item.description,
            counterparty: item.counterparty,
            sourceLabel: item.sourceLabel,
            amount: item.amount,
            reversal: item.reversal,
            accountId: s?.accountId ?? null,
            accountCode: account?.code ?? null,
            accountName: account?.name ?? null,
            deductible: s?.deductible ?? null,
            partnerId,
            partnerName: partnerId ? (partnerNames.get(partnerId) ?? null) : null,
            departmentId: s?.departmentId ?? null,
            projectId: s?.projectId ?? null,
            memo: s?.memo ?? null,
            confidence: s?.confidence ?? 0,
            method: s?.method ?? 'none',
            reason: s?.reason ?? null,
            error: s?.error ?? null,
            edited: s?.edited ?? false,
            settleCount: s?.settles?.length ?? 0,
            lines,
          };
        })
        .sort((a, b) => b.date.localeCompare(a.date) || a.evidenceId.localeCompare(b.evidenceId));
    });
  }

  private async oneItem(tx: Transaction, ref: EvidenceRef) {
    const [item] = await loadItems(tx, { refs: [ref], statuses: ['pending', 'review'] });
    if (!item) {
      throw new AppException('NOT_FOUND', '분개할 수 있는 증빙이 아닙니다.', HttpStatus.NOT_FOUND);
    }
    return item;
  }

  /** 검토함에서 추천을 고친다(사용자가 고친 추천은 다시 분류하지 않는다) */
  async updateSuggestion(ref: EvidenceRef, input: SuggestionUpdateInput) {
    await this.db.tenant(async (tx) => {
      const item = await this.oneItem(tx, ref);
      const prev = (await this.suggestionsFor(tx, [item])).get(refKey(item));
      const accountId = input.accountId === undefined ? (prev?.accountId ?? null) : input.accountId;
      const s: Suggestion = {
        accountId,
        deductible: input.deductible === undefined ? (prev?.deductible ?? null) : input.deductible,
        partnerId:
          input.partnerId === undefined ? (prev?.partnerId ?? item.partnerId) : input.partnerId,
        departmentId:
          input.departmentId === undefined ? (prev?.departmentId ?? null) : input.departmentId,
        projectId: input.projectId === undefined ? (prev?.projectId ?? null) : input.projectId,
        memo: input.memo === undefined ? (prev?.memo ?? null) : input.memo,
        confidence: 1,
        method: 'manual',
        reason: '직접 지정',
        ruleId: null,
        edited: true,
        error: null,
        // 계정을 바꾸면 반제 짝도 버린다
        settles: accountId === prev?.accountId ? (prev?.settles ?? null) : null,
      };
      await this.saveSuggestion(tx, item, s);
      await this.setEvidenceStatus(tx, item.evidenceKind, [item.evidenceId], 'review');
    });
  }

  /** 골라서 전표로 만든다. 하나가 실패해도 나머지는 만든다 */
  async approve(refs: EvidenceRef[]) {
    return this.db.tenant(async (tx) => {
      const ctx = await this.context(tx);
      const items = await loadItems(tx, { refs, statuses: ['pending', 'review'] });
      const suggestions = await this.suggestionsFor(tx, items);
      const posted: { evidenceKind: UploadKind; evidenceId: string; entryId: string }[] = [];
      const failed: { evidenceKind: UploadKind; evidenceId: string; message: string }[] = [];
      const found = new Set(items.map(refKey));
      for (const ref of refs) {
        if (!found.has(refKey(ref))) {
          failed.push({ ...ref, message: '이미 처리했거나 없는 증빙입니다.' });
        }
      }
      for (const item of items) {
        const s = suggestions.get(refKey(item)) ?? this.classify(item, ctx);
        try {
          const entryId = await tx.transaction((sp) => this.post(sp, item, s, ctx));
          await this.learn(tx, item, s);
          await this.saveSuggestion(tx, item, { ...s, error: null });
          posted.push({ evidenceKind: item.evidenceKind, evidenceId: item.evidenceId, entryId });
        } catch (e) {
          failed.push({
            evidenceKind: item.evidenceKind,
            evidenceId: item.evidenceId,
            message: message(e),
          });
          await this.saveSuggestion(tx, item, { ...s, error: message(e) });
          await this.setEvidenceStatus(tx, item.evidenceKind, [item.evidenceId], 'review');
        }
      }
      await this.audit.record(
        {
          action: 'auto_journal.approve',
          entity: 'auto_journal',
          after: { posted: posted.length, failed: failed.length },
        },
        tx,
      );
      return { posted, failed };
    });
  }
}
