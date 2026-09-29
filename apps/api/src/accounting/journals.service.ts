import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { reverseLines, SYSTEM_ACCOUNTS, validateJournal } from '@wellbuddy/accounting-core';
import {
  accounts,
  companies,
  departments,
  fileObjects,
  journalAttachments,
  journalCounters,
  journalEntries,
  journalLines,
  partners,
  projects,
  type Transaction,
  users,
} from '@wellbuddy/db';
import {
  formatJournalNo,
  type JournalCreateInput,
  type JournalEntryInput,
  type JournalReverseInput,
  type JournalStatus,
  type JournalType,
} from '@wellbuddy/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service.js';
import { todayKst } from '../common/dates.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';
import { FiscalYearsService } from './fiscal-years.service.js';

export interface JournalListQuery {
  from?: string;
  to?: string;
  status?: JournalStatus;
  type?: JournalType;
  q?: string;
  accountId?: string;
  partnerId?: string;
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
}

type EntryRow = typeof journalEntries.$inferSelect;

const createdByUser = alias(users, 'created_by_user');
const submittedByUser = alias(users, 'submitted_by_user');
const postedByUser = alias(users, 'posted_by_user');
const vatPartner = alias(partners, 'vat_partner');

/** 다른 모듈이 만든 자동 전표(그 모듈에서만 취소한다) */
export const SYSTEM_SOURCES = new Set(['depreciation', 'asset_disposal', 'fx_revaluation', 'note']);

const STATUS_LABEL: Record<JournalStatus, string> = {
  draft: '작성중',
  pending: '승인요청',
  posted: '전기',
  reversed: '역분개된',
};

/**
 * 전표 작성·수정·삭제와 상태 흐름.
 * 작성중(draft) → 승인요청(pending) → 전기(posted) → 역분개됨(reversed)
 * - 고치거나 지울 수 있는 것은 작성중 전표뿐이다.
 * - 회사가 전표 승인을 켜면 대표·관리자·결재권자의 승인을 거쳐야 전기된다(대표·관리자는 바로 전기 가능).
 * - 전기한 전표는 역분개 전표(차대 반대)를 새로 만들어 취소한다.
 */
@Injectable()
export class JournalsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly fiscal: FiscalYearsService,
  ) {}

  // ── 조회 ─────────────────────────────────────────────

  async list(query: JournalListQuery) {
    return this.db.tenant(async (tx) => {
      const q = query.q ? `%${query.q}%` : undefined;
      const lineMatch = (cond: SQL | undefined) =>
        exists(
          tx
            .select({ one: sql`1` })
            .from(journalLines)
            .where(and(eq(journalLines.entryId, journalEntries.id), cond)),
        );
      const where = and(
        query.from ? gte(journalEntries.entryDate, query.from) : undefined,
        query.to ? lte(journalEntries.entryDate, query.to) : undefined,
        query.status ? eq(journalEntries.status, query.status) : undefined,
        query.type ? eq(journalEntries.type, query.type) : undefined,
        q
          ? or(ilike(journalEntries.description, q), lineMatch(ilike(journalLines.memo, q)))
          : undefined,
        query.accountId ? lineMatch(eq(journalLines.accountId, query.accountId)) : undefined,
        query.partnerId ? lineMatch(eq(journalLines.partnerId, query.partnerId)) : undefined,
      );
      const [total] = await tx.select({ n: count() }).from(journalEntries).where(where);
      const dir = query.order === 'desc' ? desc : asc;
      const ids = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(where)
        .orderBy(dir(journalEntries.entryDate), dir(journalEntries.entryNo))
        .limit(query.limit)
        .offset(query.offset);
      return {
        items: await this.load(
          tx,
          ids.map((r) => r.id),
        ),
        total: total!.n,
      };
    });
  }

  get(id: string) {
    return this.db.tenant((tx) => this.getIn(tx, id));
  }

  private async getIn(tx: Transaction, id: string) {
    const [entry] = await this.load(tx, [id]);
    if (!entry) throw new NotFoundException();
    return entry;
  }

  /** 전표(줄·첨부 포함)를 ids 순서대로 읽는다. */
  private async load(tx: Transaction, ids: string[]) {
    if (ids.length === 0) return [];
    const headers = await tx
      .select({
        e: journalEntries,
        createdByName: createdByUser.name,
        submittedByName: submittedByUser.name,
        postedByName: postedByUser.name,
        vatPartnerName: vatPartner.name,
      })
      .from(journalEntries)
      .leftJoin(createdByUser, eq(createdByUser.id, journalEntries.createdBy))
      .leftJoin(submittedByUser, eq(submittedByUser.id, journalEntries.submittedBy))
      .leftJoin(postedByUser, eq(postedByUser.id, journalEntries.postedBy))
      .leftJoin(vatPartner, eq(vatPartner.id, journalEntries.vatPartnerId))
      .where(inArray(journalEntries.id, ids));
    const lines = await tx
      .select({
        entryId: journalLines.entryId,
        id: journalLines.id,
        lineNo: journalLines.lineNo,
        accountId: journalLines.accountId,
        accountCode: accounts.code,
        accountName: accounts.name,
        debit: journalLines.debit,
        credit: journalLines.credit,
        partnerId: journalLines.partnerId,
        partnerName: partners.name,
        departmentId: journalLines.departmentId,
        departmentName: departments.name,
        projectId: journalLines.projectId,
        projectName: projects.name,
        memo: journalLines.memo,
      })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .leftJoin(partners, eq(partners.id, journalLines.partnerId))
      .leftJoin(departments, eq(departments.id, journalLines.departmentId))
      .leftJoin(projects, eq(projects.id, journalLines.projectId))
      .where(inArray(journalLines.entryId, ids))
      .orderBy(asc(journalLines.lineNo));
    const files = await tx
      .select({
        entryId: journalAttachments.entryId,
        id: fileObjects.id,
        filename: fileObjects.filename,
        mimeType: fileObjects.mimeType,
        sizeBytes: fileObjects.sizeBytes,
      })
      .from(journalAttachments)
      .innerJoin(fileObjects, eq(fileObjects.id, journalAttachments.fileId))
      .where(inArray(journalAttachments.entryId, ids))
      .orderBy(asc(journalAttachments.createdAt));

    const byId = new Map(headers.map((h) => [h.e.id, h]));
    return ids.flatMap((id) => {
      const h = byId.get(id);
      if (!h) return [];
      const e = h.e;
      return [
        {
          id: e.id,
          fiscalYearId: e.fiscalYearId,
          entryDate: e.entryDate,
          entryNo: e.entryNo,
          number: formatJournalNo(e.entryDate, e.entryNo),
          type: e.type,
          status: e.status,
          description: e.description,
          source: e.source,
          sourceRef: e.sourceRef,
          vat:
            e.vatType && e.evidenceType
              ? {
                  vatType: e.vatType,
                  evidenceType: e.evidenceType,
                  supplyAmount: e.supplyAmount ?? 0,
                  vatAmount: e.vatAmount ?? 0,
                  deductible: e.vatDeductible ?? true,
                  partnerId: e.vatPartnerId,
                  partnerName: h.vatPartnerName,
                }
              : null,
          totalAmount: e.totalAmount,
          reversalOfId: e.reversalOfId,
          reversedById: e.reversedById,
          createdByName: h.createdByName,
          submittedAt: e.submittedAt?.toISOString() ?? null,
          submittedByName: h.submittedByName,
          rejectionReason: e.rejectionReason,
          postedAt: e.postedAt?.toISOString() ?? null,
          postedByName: h.postedByName,
          createdAt: e.createdAt.toISOString(),
          updatedAt: e.updatedAt.toISOString(),
          lines: lines.filter((l) => l.entryId === id).map(({ entryId: _, ...l }) => l),
          attachments: files.filter((f) => f.entryId === id).map(({ entryId: _, ...f }) => f),
        },
      ];
    });
  }

  // ── 작성·수정·삭제 ───────────────────────────────────

  async create(input: JournalCreateInput) {
    const id = await this.db.tenant((tx) => this.createIn(tx, input));
    return this.get(id);
  }

  /**
   * 트랜잭션 안에서 전표를 만든다. 고정자산 상각·외화평가·어음처럼 다른 모듈이 만드는
   * 자동 전표도 이 경로를 써서 같은 검증(차대·계정·마감·승인)을 거친다.
   */
  async createIn(
    tx: Transaction,
    input: JournalCreateInput,
    origin: { source?: string; sourceRef?: string | null } = {},
  ): Promise<string> {
    const { companyId, userId } = requireCompanyContext();
    const { entry, status } = input;
    const year = await this.fiscal.ensureFor(tx, entry.entryDate);
    await this.fiscal.assertOpen(tx, entry.entryDate);
    const lines = await this.validate(tx, entry);
    const [row] = await tx
      .insert(journalEntries)
      .values({
        companyId,
        fiscalYearId: year.id,
        entryDate: entry.entryDate,
        entryNo: await this.nextNo(tx, entry.entryDate),
        type: entry.type,
        status: 'draft',
        ...this.header(entry),
        source: origin.source ?? 'manual',
        sourceRef: origin.sourceRef ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    await this.insertLines(tx, row!.id, lines);
    if (entry.attachmentIds?.length) await this.attach(tx, row!.id, entry.attachmentIds);
    await this.audit.record(
      { action: 'journal.create', entity: 'journal', entityId: row!.id, after: { entry } },
      tx,
    );
    if (status === 'pending') await this.toPending(tx, row!);
    if (status === 'posted') await this.toPosted(tx, row!, 'post');
    return row!.id;
  }

  /** 작성중 전표를 통째로 바꾼다(날짜가 바뀌면 전표번호를 새로 받는다). */
  async update(id: string, entry: JournalEntryInput) {
    const { userId } = requireCompanyContext();
    await this.db.tenant(async (tx) => {
      const before = await this.lockEntry(tx, id);
      this.assertStatus(before, ['draft'], '수정');
      await this.fiscal.assertOpen(tx, before.entryDate);
      const dateChanged = entry.entryDate !== before.entryDate;
      const year = dateChanged ? await this.fiscal.ensureFor(tx, entry.entryDate) : null;
      if (dateChanged) await this.fiscal.assertOpen(tx, entry.entryDate);
      const lines = await this.validate(tx, entry);
      await tx.delete(journalLines).where(eq(journalLines.entryId, id));
      await tx
        .update(journalEntries)
        .set({
          ...(year
            ? {
                fiscalYearId: year.id,
                entryDate: entry.entryDate,
                entryNo: await this.nextNo(tx, entry.entryDate),
              }
            : {}),
          type: entry.type,
          ...this.header(entry),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(journalEntries.id, id));
      await this.insertLines(tx, id, lines);
      if (entry.attachmentIds) {
        await tx.delete(journalAttachments).where(eq(journalAttachments.entryId, id));
        if (entry.attachmentIds.length) await this.attach(tx, id, entry.attachmentIds);
      }
      await this.audit.record(
        {
          action: 'journal.update',
          entity: 'journal',
          entityId: id,
          before: { entryDate: before.entryDate, entryNo: before.entryNo },
          after: { entry },
        },
        tx,
      );
    });
    return this.get(id);
  }

  async remove(id: string) {
    await this.db.tenant(async (tx) => {
      const before = await this.lockEntry(tx, id);
      this.assertStatus(before, ['draft'], '삭제');
      await this.fiscal.assertOpen(tx, before.entryDate);
      await tx.delete(journalEntries).where(eq(journalEntries.id, id));
      await this.audit.record(
        {
          action: 'journal.delete',
          entity: 'journal',
          entityId: id,
          before: {
            number: formatJournalNo(before.entryDate, before.entryNo),
            total: before.totalAmount,
          },
        },
        tx,
      );
    });
  }

  // ── 상태 흐름 ────────────────────────────────────────

  /** 작성중 → 승인요청 */
  async submit(id: string) {
    await this.db.tenant(async (tx) => {
      const entry = await this.lockEntry(tx, id);
      this.assertStatus(entry, ['draft'], '승인요청');
      await this.toPending(tx, entry);
    });
    return this.get(id);
  }

  /** 승인요청 → 작성중(요청한 사람 또는 대표·관리자) */
  async withdraw(id: string) {
    const { userId, role } = requireCompanyContext();
    await this.db.tenant(async (tx) => {
      const entry = await this.lockEntry(tx, id);
      this.assertStatus(entry, ['pending'], '회수');
      if (entry.submittedBy !== userId && role !== 'owner' && role !== 'admin') {
        throw new AppException(
          'FORBIDDEN',
          '승인요청한 사람이나 관리자만 회수할 수 있습니다.',
          HttpStatus.FORBIDDEN,
        );
      }
      await this.fiscal.assertOpen(tx, entry.entryDate);
      await tx
        .update(journalEntries)
        .set({ status: 'draft', updatedBy: userId, updatedAt: new Date() })
        .where(eq(journalEntries.id, id));
      await this.audit.record({ action: 'journal.withdraw', entity: 'journal', entityId: id }, tx);
    });
    return this.get(id);
  }

  /** 승인요청 → 전기(승인) */
  async approve(id: string) {
    await this.db.tenant(async (tx) => {
      const entry = await this.lockEntry(tx, id);
      this.assertStatus(entry, ['pending'], '승인');
      await this.toPosted(tx, entry, 'approve');
    });
    return this.get(id);
  }

  /** 승인요청 → 작성중(반려 사유 기록) */
  async reject(id: string, reason: string) {
    const { userId } = requireCompanyContext();
    await this.db.tenant(async (tx) => {
      const entry = await this.lockEntry(tx, id);
      this.assertStatus(entry, ['pending'], '반려');
      this.assertApprover(entry);
      await this.fiscal.assertOpen(tx, entry.entryDate);
      await tx
        .update(journalEntries)
        .set({
          status: 'draft',
          rejectionReason: reason,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(journalEntries.id, id));
      await this.audit.record(
        { action: 'journal.reject', entity: 'journal', entityId: id, after: { reason } },
        tx,
      );
    });
    return this.get(id);
  }

  /** 작성중 → 전기(승인 절차를 쓰지 않거나 대표·관리자일 때) */
  async post(id: string) {
    await this.db.tenant(async (tx) => {
      const entry = await this.lockEntry(tx, id);
      this.assertStatus(entry, ['draft'], '전기');
      await this.toPosted(tx, entry, 'post');
    });
    return this.get(id);
  }

  /** 전기한 전표를 취소하는 역분개 전표(차대 반대)를 만들고 원래 전표를 역분개됨으로 표시한다. */
  async reverse(id: string, input: JournalReverseInput) {
    const reversalId = await this.db.tenant((tx) => this.reverseIn(tx, id, input));
    return this.get(reversalId);
  }

  /**
   * 트랜잭션 안에서 역분개한다. 자동 전표(상각·외화평가·어음)는 그 메뉴에서만 취소할 수 있어
   * 일반 역분개로는 막고, 해당 모듈이 system=true 로 부른다.
   */
  async reverseIn(
    tx: Transaction,
    id: string,
    input: JournalReverseInput,
    opts: { system?: boolean } = {},
  ): Promise<string> {
    const { companyId, userId } = requireCompanyContext();
    {
      const original = await this.lockEntry(tx, id);
      if (original.type === 'opening' || original.type === 'closing') {
        throw new AppException(
          'JOURNAL_NOT_REVERSIBLE',
          '기초잔액·결산 전표는 역분개할 수 없습니다.',
        );
      }
      // 자동 전표의 취소 전표를 다시 뒤집는 것도 자동 전표를 되살리는 일이므로 같이 막는다
      const reversedSource =
        original.source === 'reversal' && original.reversalOfId
          ? (
              await tx
                .select({ source: journalEntries.source })
                .from(journalEntries)
                .where(eq(journalEntries.id, original.reversalOfId))
            )[0]?.source
          : undefined;
      if (
        !opts.system &&
        (SYSTEM_SOURCES.has(original.source) || SYSTEM_SOURCES.has(reversedSource ?? ''))
      ) {
        throw new AppException(
          'SYSTEM_ENTRY',
          '자동으로 만든 전표는 만든 메뉴(고정자산·외화평가·어음)에서 취소해 주세요.',
          HttpStatus.CONFLICT,
        );
      }
      this.assertStatus(original, ['posted'], '역분개');
      if (await this.approvalRequired(tx)) this.assertManager('역분개');

      const today = todayKst();
      const entryDate =
        input.entryDate ?? (today < original.entryDate ? original.entryDate : today);
      if (entryDate < original.entryDate) {
        throw new AppException(
          'REVERSAL_DATE_INVALID',
          '역분개 날짜는 원래 전표 날짜보다 빠를 수 없습니다.',
        );
      }
      const year = await this.fiscal.ensureFor(tx, entryDate);
      await this.fiscal.assertOpen(tx, entryDate);

      const lines = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.entryId, id))
        .orderBy(asc(journalLines.lineNo));
      const now = new Date();
      const [reversal] = await tx
        .insert(journalEntries)
        .values({
          companyId,
          fiscalYearId: year.id,
          entryDate,
          entryNo: await this.nextNo(tx, entryDate),
          type: original.type,
          status: 'draft',
          description:
            input.description ??
            `[역분개] ${formatJournalNo(original.entryDate, original.entryNo)} ${original.description ?? ''}`.trim(),
          source: 'reversal',
          sourceRef: original.id,
          vatType: original.vatType,
          evidenceType: original.evidenceType,
          supplyAmount: original.supplyAmount === null ? null : -original.supplyAmount,
          vatAmount: original.vatAmount === null ? null : -original.vatAmount,
          vatDeductible: original.vatDeductible,
          vatPartnerId: original.vatPartnerId,
          totalAmount: original.totalAmount,
          reversalOfId: original.id,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning({ id: journalEntries.id });
      await this.insertLines(tx, reversal!.id, reverseLines(lines));
      await tx
        .update(journalEntries)
        .set({ status: 'posted', postedAt: now, postedBy: userId })
        .where(eq(journalEntries.id, reversal!.id));
      await tx
        .update(journalEntries)
        .set({ status: 'reversed', reversedById: reversal!.id, updatedBy: userId, updatedAt: now })
        .where(eq(journalEntries.id, id));
      await this.audit.record(
        {
          action: 'journal.reverse',
          entity: 'journal',
          entityId: id,
          after: { reversalId: reversal!.id, entryDate },
        },
        tx,
      );
      return reversal!.id;
    }
  }

  // ── 첨부 ─────────────────────────────────────────────

  /** 증빙은 어느 상태에서나 추가할 수 있다(전기 후에 받은 영수증 등). */
  async addAttachments(id: string, fileIds: string[]) {
    await this.db.tenant(async (tx) => {
      await this.lockEntry(tx, id);
      await this.attach(tx, id, fileIds);
      await this.audit.record(
        { action: 'journal.attach', entity: 'journal', entityId: id, after: { fileIds } },
        tx,
      );
    });
    return this.get(id);
  }

  /** 전기한 전표의 증빙은 뗄 수 없다(감사 추적). */
  async removeAttachment(id: string, fileId: string) {
    await this.db.tenant(async (tx) => {
      const entry = await this.lockEntry(tx, id);
      this.assertStatus(entry, ['draft', 'pending'], '증빙 삭제');
      const deleted = await tx
        .delete(journalAttachments)
        .where(and(eq(journalAttachments.entryId, id), eq(journalAttachments.fileId, fileId)))
        .returning({ id: journalAttachments.id });
      if (deleted.length === 0) throw new NotFoundException();
      await this.audit.record(
        { action: 'journal.detach', entity: 'journal', entityId: id, before: { fileId } },
        tx,
      );
    });
  }

  private async attach(tx: Transaction, entryId: string, fileIds: string[]) {
    const { companyId } = requireCompanyContext();
    const unique = [...new Set(fileIds)];
    const found = await tx
      .select({ id: fileObjects.id })
      .from(fileObjects)
      .where(inArray(fileObjects.id, unique));
    if (found.length !== unique.length) {
      throw new AppException('FILE_NOT_FOUND', '첨부할 파일을 찾을 수 없습니다.');
    }
    await tx
      .insert(journalAttachments)
      .values(unique.map((fileId) => ({ companyId, entryId, fileId })))
      .onConflictDoNothing();
  }

  // ── 내부 ─────────────────────────────────────────────

  /** 동시에 같은 전표의 상태를 바꾸지 않도록 행을 잠그고 읽는다. */
  private async lockEntry(tx: Transaction, id: string): Promise<EntryRow> {
    const [row] = await tx
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, id))
      .for('update');
    if (!row) throw new NotFoundException();
    if (row.type === 'opening') {
      throw new AppException(
        'OPENING_ENTRY',
        '기초잔액 전표는 회계기간 화면의 기초잔액에서 고칩니다.',
      );
    }
    return row;
  }

  private assertStatus(entry: EntryRow, allowed: JournalStatus[], action: string) {
    if (!allowed.includes(entry.status)) {
      throw new AppException(
        'JOURNAL_STATUS',
        `${STATUS_LABEL[entry.status]} 전표는 ${action}할 수 없습니다.`,
        HttpStatus.CONFLICT,
        { status: entry.status },
      );
    }
  }

  private async approvalRequired(tx: Transaction): Promise<boolean> {
    const { companyId } = requireCompanyContext();
    const [company] = await tx
      .select({ required: companies.journalApprovalRequired })
      .from(companies)
      .where(eq(companies.id, companyId));
    return company?.required ?? false;
  }

  private assertManager(action: string) {
    const { role } = requireCompanyContext();
    if (role !== 'owner' && role !== 'admin') {
      throw new AppException(
        'APPROVAL_REQUIRED',
        `전표 승인을 사용 중이라 ${action}은(는) 대표·관리자만 할 수 있습니다. 승인요청해 주세요.`,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /** 승인·반려: 대표·관리자·결재권자. 대표가 아니면 자기가 요청한 전표는 승인할 수 없다. */
  private assertApprover(entry: EntryRow) {
    const { role, userId } = requireCompanyContext();
    if (role !== 'owner' && role !== 'admin' && role !== 'approver') {
      throw new AppException(
        'APPROVER_ONLY',
        '전표 승인·반려는 대표·관리자·결재권자만 할 수 있습니다.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (role !== 'owner' && entry.submittedBy === userId) {
      throw new AppException(
        'SELF_APPROVAL',
        '자기가 승인요청한 전표는 다른 사람이 승인해야 합니다.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async toPending(tx: Transaction, entry: EntryRow) {
    const { userId } = requireCompanyContext();
    await this.fiscal.assertOpen(tx, entry.entryDate);
    const now = new Date();
    await tx
      .update(journalEntries)
      .set({
        status: 'pending',
        submittedAt: now,
        submittedBy: userId,
        rejectionReason: null,
        updatedBy: userId,
        updatedAt: now,
      })
      .where(eq(journalEntries.id, entry.id));
    await this.audit.record(
      { action: 'journal.submit', entity: 'journal', entityId: entry.id },
      tx,
    );
  }

  private async toPosted(tx: Transaction, entry: EntryRow, via: 'post' | 'approve') {
    const { userId } = requireCompanyContext();
    if (via === 'approve') this.assertApprover(entry);
    else if (await this.approvalRequired(tx)) this.assertManager('바로 전기');
    await this.fiscal.assertOpen(tx, entry.entryDate);
    const now = new Date();
    await tx
      .update(journalEntries)
      .set({ status: 'posted', postedAt: now, postedBy: userId, updatedBy: userId, updatedAt: now })
      .where(eq(journalEntries.id, entry.id));
    await this.audit.record(
      {
        action: via === 'approve' ? 'journal.approve' : 'journal.post',
        entity: 'journal',
        entityId: entry.id,
      },
      tx,
    );
  }

  /** 날짜별 전표번호 발급(upsert 로 증가시켜 동시에 저장해도 겹치지 않는다) */
  private async nextNo(tx: Transaction, entryDate: string): Promise<number> {
    const { companyId } = requireCompanyContext();
    const [row] = await tx
      .insert(journalCounters)
      .values({ companyId, entryDate, lastNo: 1 })
      .onConflictDoUpdate({
        target: [journalCounters.companyId, journalCounters.entryDate],
        set: { lastNo: sql`${journalCounters.lastNo} + 1` },
      })
      .returning({ no: journalCounters.lastNo });
    return row!.no;
  }

  private header(entry: JournalEntryInput) {
    const lines = entry.lines;
    return {
      description: entry.description ?? null,
      vatType: entry.vat?.vatType ?? null,
      evidenceType: entry.vat?.evidenceType ?? null,
      supplyAmount: entry.vat?.supplyAmount ?? null,
      vatAmount: entry.vat?.vatAmount ?? null,
      vatDeductible: entry.vat ? entry.vat.deductible : null,
      vatPartnerId: entry.vat?.partnerId ?? null,
      totalAmount: lines.reduce((s, l) => s + l.debit, 0),
    };
  }

  private async insertLines(
    tx: Transaction,
    entryId: string,
    lines: {
      accountId: string;
      debit: number;
      credit: number;
      partnerId?: string | null;
      departmentId?: string | null;
      projectId?: string | null;
      memo?: string | null;
    }[],
  ) {
    const { companyId } = requireCompanyContext();
    await tx.insert(journalLines).values(
      lines.map((l, i) => ({
        companyId,
        entryId,
        lineNo: i + 1,
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        partnerId: l.partnerId ?? null,
        departmentId: l.departmentId ?? null,
        projectId: l.projectId ?? null,
        memo: l.memo ?? null,
      })),
    );
  }

  /**
   * 업무 규칙 검사: 차대 균형, 사용 중인 계정, 계정별 필수 관리항목(거래처·부서),
   * 거래처·부서·프로젝트 존재, 매입매출전표의 부가세 금액과 부가세 계정 분개 일치.
   */
  private async validate(tx: Transaction, entry: JournalEntryInput) {
    const lines = entry.lines;
    const issues = validateJournal(lines);
    if (issues.length > 0) {
      throw new AppException('JOURNAL_INVALID', issues[0]!.message, HttpStatus.BAD_REQUEST, {
        issues,
      });
    }

    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accountRows = await tx
      .select({
        id: accounts.id,
        code: accounts.code,
        name: accounts.name,
        isActive: accounts.isActive,
        requiresPartner: accounts.requiresPartner,
        requiresDepartment: accounts.requiresDepartment,
      })
      .from(accounts)
      .where(inArray(accounts.id, accountIds));
    const accountById = new Map(accountRows.map((a) => [a.id, a]));
    lines.forEach((l, i) => {
      const a = accountById.get(l.accountId);
      const row = `${i + 1}행`;
      if (!a) throw new AppException('ACCOUNT_NOT_FOUND', `${row}: 없는 계정과목입니다.`);
      if (!a.isActive) {
        throw new AppException(
          'ACCOUNT_INACTIVE',
          `${row}: '${a.name}'은(는) 사용중지된 계정입니다.`,
        );
      }
      if (a.requiresPartner && !l.partnerId) {
        throw new AppException(
          'PARTNER_REQUIRED',
          `${row}: '${a.name}' 계정은 거래처를 입력해야 합니다.`,
        );
      }
      if (a.requiresDepartment && !l.departmentId) {
        throw new AppException(
          'DEPARTMENT_REQUIRED',
          `${row}: '${a.name}' 계정은 부서를 입력해야 합니다.`,
        );
      }
    });

    const ids = (pick: (l: (typeof lines)[number]) => string | null | undefined) => [
      ...new Set(lines.flatMap((l) => (pick(l) ? [pick(l)!] : []))),
    ];
    const partnerIds = ids((l) => l.partnerId);
    if (entry.vat?.partnerId && !partnerIds.includes(entry.vat.partnerId)) {
      partnerIds.push(entry.vat.partnerId);
    }
    const checks = [
      { label: '거래처', ids: partnerIds, table: partners },
      { label: '부서', ids: ids((l) => l.departmentId), table: departments },
      { label: '프로젝트', ids: ids((l) => l.projectId), table: projects },
    ] as const;
    for (const check of checks) {
      if (check.ids.length === 0) continue;
      const found = await tx
        .select({ id: check.table.id })
        .from(check.table)
        .where(inArray(check.table.id, [...check.ids]));
      if (found.length !== check.ids.length) {
        throw new AppException('NOT_FOUND', `없는 ${check.label}가 있습니다.`);
      }
    }

    if (entry.vat) this.validateVat(entry, accountById);
    return lines;
  }

  private validateVat(
    entry: JournalEntryInput,
    accountById: Map<string, { code: string; name: string }>,
  ) {
    const vat = entry.vat!;
    if ((vat.evidenceType === 'tax_invoice' || vat.evidenceType === 'invoice') && !vat.partnerId) {
      throw new AppException(
        'VAT_PARTNER_REQUIRED',
        '세금계산서·계산서는 거래처를 입력해야 합니다.',
      );
    }
    if (vat.vatType !== 'taxable' && vat.vatAmount !== 0) {
      throw new AppException('VAT_MISMATCH', '영세·면세 거래는 부가세가 0원입니다.');
    }
    const code = entry.type === 'sales' ? SYSTEM_ACCOUNTS.vatReceived : SYSTEM_ACCOUNTS.vatPaid;
    const booked = entry.lines.reduce((s, l) => {
      if (accountById.get(l.accountId)?.code !== code) return s;
      return s + (entry.type === 'sales' ? l.credit - l.debit : l.debit - l.credit);
    }, 0);
    const expected = entry.type === 'purchase' && !vat.deductible ? 0 : vat.vatAmount;
    if (booked !== expected) {
      const accountLabel = entry.type === 'sales' ? '부가세예수금' : '부가세대급금';
      throw new AppException(
        'VAT_MISMATCH',
        entry.type === 'purchase' && !vat.deductible
          ? '불공제 매입은 부가세대급금으로 분개하지 않습니다(부가세를 비용·자산에 포함).'
          : `부가세 ${expected.toLocaleString('ko-KR')}원과 ${accountLabel} 분개 ${booked.toLocaleString('ko-KR')}원이 다릅니다.`,
      );
    }
  }
}
