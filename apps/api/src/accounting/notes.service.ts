import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  discountCharge,
  MoneyError,
  NOTE_ACCOUNTS,
  NOTE_STATUS_LABELS,
  type NoteStatus,
  SYSTEM_ACCOUNTS,
} from '@wellbuddy/accounting-core';
import {
  journalEntries,
  type NoteAction,
  noteEvents,
  notes,
  partners,
  type Transaction,
} from '@wellbuddy/db';
import {
  formatJournalNo,
  type JournalLineInput,
  type NoteDiscountInput,
  type NoteDishonorInput,
  type NoteEndorseInput,
  type NoteListQuery,
  type NoteRegisterInput,
  type NoteSettleInput,
} from '@wellbuddy/shared';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../common/db-errors.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';
import { accountIdByCode } from './account-lookup.js';
import { JournalsService } from './journals.service.js';

type NoteRow = typeof notes.$inferSelect;

const ACTION_LABELS: Record<NoteAction, string> = {
  register: '등록',
  settle: '만기 결제',
  discount: '할인',
  endorse: '배서양도',
  dishonor: '부도',
};

/** 배서 상대 거래처명 */
const endorsedToName = sql<
  string | null
>`(select p.name from ${partners} p where p.id = ${notes.endorsedToPartnerId})`;

export interface NoteView {
  id: string;
  kind: NoteRow['kind'];
  noteNo: string;
  partnerId: string;
  partnerName: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  bank: string | null;
  status: NoteStatus;
  statusDate: string | null;
  endorsedToPartnerId: string | null;
  endorsedToName: string | null;
  memo: string | null;
}

export interface NoteDetail extends NoteView {
  events: {
    id: string;
    action: NoteAction;
    eventDate: string;
    entryId: string | null;
    entryNumber: string | null;
    detail: Record<string, unknown>;
  }[];
}

/**
 * 받을어음·지급어음 대장과 상태 처리 자동전표.
 *  받을어음: 수취 (차)받을어음/(대)외상매출금 → 만기 결제 (차)예금/(대)받을어음
 *           할인 (차)예금·매출채권처분손실/(대)받을어음, 배서 (차)외상매입금/(대)받을어음,
 *           부도 (차)부도어음과수표/(대)받을어음
 *  지급어음: 발행 (차)외상매입금/(대)지급어음 → 만기 결제 (차)지급어음/(대)예금
 * 처리는 보유(발행) 상태에서만 하고, 마지막 처리는 역분개로 취소할 수 있다.
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly journals: JournalsService,
  ) {}

  async list(query: NoteListQuery) {
    return this.db.tenant(async (tx) => {
      const rows = await tx
        .select({ n: notes, partnerName: partners.name, endorsedToName })
        .from(notes)
        .innerJoin(partners, eq(partners.id, notes.partnerId))
        .where(
          and(
            query.kind ? eq(notes.kind, query.kind) : undefined,
            query.status ? eq(notes.status, query.status) : undefined,
            query.dueFrom ? gte(notes.dueDate, query.dueFrom) : undefined,
            query.dueTo ? lte(notes.dueDate, query.dueTo) : undefined,
          ),
        )
        .orderBy(asc(notes.dueDate), asc(notes.noteNo));
      return rows.map(({ n, partnerName, endorsedToName }) =>
        this.toNote(n, partnerName, endorsedToName),
      );
    });
  }

  private toNote(n: NoteRow, partnerName: string, endorsedToName: string | null): NoteView {
    return {
      id: n.id,
      kind: n.kind,
      noteNo: n.noteNo,
      partnerId: n.partnerId,
      partnerName,
      issueDate: n.issueDate,
      dueDate: n.dueDate,
      amount: n.amount,
      bank: n.bank,
      status: n.status,
      statusDate: n.statusDate,
      endorsedToPartnerId: n.endorsedToPartnerId,
      endorsedToName,
      memo: n.memo,
    };
  }

  async get(id: string): Promise<NoteDetail> {
    return this.db.tenant(async (tx) => {
      const [row] = await tx
        .select({ n: notes, partnerName: partners.name, endorsedToName })
        .from(notes)
        .innerJoin(partners, eq(partners.id, notes.partnerId))
        .where(eq(notes.id, id));
      if (!row) throw new NotFoundException();
      const events = await tx
        .select({
          id: noteEvents.id,
          action: noteEvents.action,
          eventDate: noteEvents.eventDate,
          entryId: noteEvents.entryId,
          entryDate: journalEntries.entryDate,
          entryNo: journalEntries.entryNo,
          detail: noteEvents.detail,
        })
        .from(noteEvents)
        .leftJoin(journalEntries, eq(journalEntries.id, noteEvents.entryId))
        .where(eq(noteEvents.noteId, id))
        .orderBy(asc(noteEvents.createdAt));
      return {
        ...this.toNote(row.n, row.partnerName, row.endorsedToName),
        events: events.map((e) => ({
          id: e.id,
          action: e.action,
          eventDate: e.eventDate,
          entryId: e.entryId,
          entryNumber:
            e.entryDate && e.entryNo !== null ? formatJournalNo(e.entryDate, e.entryNo) : null,
          detail: e.detail ?? {},
        })),
      };
    });
  }

  private async lockNote(tx: Transaction, id: string): Promise<NoteRow> {
    const [row] = await tx.select().from(notes).where(eq(notes.id, id)).for('update');
    if (!row) throw new NotFoundException();
    return row;
  }

  private async partnerName(tx: Transaction, id: string) {
    const [row] = await tx
      .select({ name: partners.name })
      .from(partners)
      .where(eq(partners.id, id));
    if (!row) throw new AppException('NOT_FOUND', '없는 거래처입니다.');
    return row.name;
  }

  /** 자동전표 전기(source=note) */
  private post(
    tx: Transaction,
    note: NoteRow,
    date: string,
    description: string,
    lines: JournalLineInput[],
  ) {
    return this.journals.createIn(
      tx,
      { entry: { entryDate: date, type: 'general', description, lines }, status: 'posted' },
      { source: 'note', sourceRef: note.id },
    );
  }

  private async recordEvent(
    tx: Transaction,
    note: NoteRow,
    action: NoteAction,
    eventDate: string,
    entryId: string | null,
    toStatus: NoteStatus,
    detail: Record<string, unknown> = {},
  ) {
    const { companyId, userId } = requireCompanyContext();
    await tx.insert(noteEvents).values({
      companyId,
      noteId: note.id,
      action,
      eventDate,
      entryId,
      fromStatus: action === 'register' ? null : note.status,
      toStatus,
      detail,
      createdBy: userId,
    });
  }

  // ── 등록 ─────────────────────────────────────────────

  async register(input: NoteRegisterInput) {
    const { companyId } = requireCompanyContext();
    try {
      const id = await this.db.tenant(async (tx) => {
        const partnerName = await this.partnerName(tx, input.partnerId);
        const [note] = await tx
          .insert(notes)
          .values({
            companyId,
            kind: input.kind,
            noteNo: input.noteNo,
            partnerId: input.partnerId,
            issueDate: input.issueDate,
            dueDate: input.dueDate,
            amount: input.amount,
            bank: input.bank ?? null,
            memo: input.memo ?? null,
          })
          .returning();
        const entryDate = input.entryDate ?? input.issueDate;
        let entryId: string | null = null;
        if (input.createEntry) {
          const receivable = input.kind === 'receivable';
          const noteAccount = await accountIdByCode(
            tx,
            receivable ? NOTE_ACCOUNTS.receivable : NOTE_ACCOUNTS.payable,
          );
          const counter =
            input.counterAccountId ??
            (await accountIdByCode(
              tx,
              receivable ? SYSTEM_ACCOUNTS.accountsReceivable : SYSTEM_ACCOUNTS.accountsPayable,
            ));
          const memo = `${partnerName} 어음 ${receivable ? '수취' : '발행'} ${input.noteNo}`;
          const noteLine = { accountId: noteAccount, partnerId: input.partnerId, memo };
          const counterLine = { accountId: counter, partnerId: input.partnerId, memo };
          entryId = await this.post(
            tx,
            note!,
            entryDate,
            memo,
            receivable
              ? [
                  { ...noteLine, debit: input.amount, credit: 0 },
                  { ...counterLine, debit: 0, credit: input.amount },
                ]
              : [
                  { ...counterLine, debit: input.amount, credit: 0 },
                  { ...noteLine, debit: 0, credit: input.amount },
                ],
          );
        }
        await this.recordEvent(tx, note!, 'register', entryDate, entryId, 'holding');
        await this.audit.record(
          { action: 'note.register', entity: 'note', entityId: note!.id, after: input },
          tx,
        );
        return note!.id;
      });
      return this.get(id);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new AppException(
          'DUPLICATE_NOTE_NO',
          `어음번호 ${input.noteNo} 가 이미 있습니다.`,
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }
  }

  // ── 상태 처리 ────────────────────────────────────────

  private assertActionable(note: NoteRow, date: string, receivableOnly: boolean, label: string) {
    if (receivableOnly && note.kind !== 'receivable') {
      throw new AppException('NOTE_ACTION_INVALID', `${label}은(는) 받을어음만 할 수 있습니다.`);
    }
    if (note.status !== 'holding') {
      throw new AppException(
        'NOTE_NOT_HOLDING',
        `이미 ${NOTE_STATUS_LABELS[note.status]} 처리한 어음입니다.`,
        HttpStatus.CONFLICT,
      );
    }
    if (date < note.issueDate) {
      throw new AppException('NOTE_DATE_INVALID', '처리일이 발행일보다 빠릅니다.');
    }
  }

  private async act(
    id: string,
    action: Exclude<NoteAction, 'register'>,
    run: (
      tx: Transaction,
      note: NoteRow,
      partnerName: string,
    ) => Promise<{
      date: string;
      entryId: string;
      toStatus: NoteStatus;
      detail?: Record<string, unknown>;
      patch?: Partial<NoteRow>;
    }>,
  ) {
    await this.db.tenant(async (tx) => {
      const note = await this.lockNote(tx, id);
      const partnerName = await this.partnerName(tx, note.partnerId);
      const result = await run(tx, note, partnerName);
      await this.recordEvent(
        tx,
        note,
        action,
        result.date,
        result.entryId,
        result.toStatus,
        result.detail,
      );
      await tx
        .update(notes)
        .set({
          ...result.patch,
          status: result.toStatus,
          statusDate: result.date,
          updatedAt: new Date(),
        })
        .where(eq(notes.id, id));
      await this.audit.record(
        {
          action: `note.${action}`,
          entity: 'note',
          entityId: id,
          after: { date: result.date, entryId: result.entryId, ...result.detail },
        },
        tx,
      );
    });
    return this.get(id);
  }

  settle(id: string, input: NoteSettleInput) {
    return this.act(id, 'settle', async (tx, note, partnerName) => {
      this.assertActionable(note, input.date, false, '만기 결제');
      const receivable = note.kind === 'receivable';
      const noteAccount = await accountIdByCode(
        tx,
        receivable ? NOTE_ACCOUNTS.receivable : NOTE_ACCOUNTS.payable,
      );
      const memo = `${partnerName} 어음 만기 결제 ${note.noteNo}`;
      const noteLine = { accountId: noteAccount, partnerId: note.partnerId, memo };
      const cashLine = { accountId: input.accountId, memo };
      const entryId = await this.post(
        tx,
        note,
        input.date,
        memo,
        receivable
          ? [
              { ...cashLine, debit: note.amount, credit: 0 },
              { ...noteLine, debit: 0, credit: note.amount },
            ]
          : [
              { ...noteLine, debit: note.amount, credit: 0 },
              { ...cashLine, debit: 0, credit: note.amount },
            ],
      );
      return { date: input.date, entryId, toStatus: 'settled' };
    });
  }

  discount(id: string, input: NoteDiscountInput) {
    return this.act(id, 'discount', async (tx, note, partnerName) => {
      this.assertActionable(note, input.date, true, '할인');
      let calc: ReturnType<typeof discountCharge>;
      try {
        calc = discountCharge({
          faceAmount: note.amount,
          annualRatePercent: input.annualRate,
          discountDate: input.date,
          maturityDate: note.dueDate,
        });
      } catch (e) {
        if (e instanceof MoneyError) throw new AppException('NOTE_DATE_INVALID', e.message);
        throw e;
      }
      const memo = `${partnerName} 어음 할인 ${note.noteNo}`;
      const lines: JournalLineInput[] = [];
      if (calc.proceeds > 0) {
        lines.push({ accountId: input.accountId, debit: calc.proceeds, credit: 0, memo });
      }
      if (calc.charge > 0) {
        lines.push({
          accountId: await accountIdByCode(tx, NOTE_ACCOUNTS.discountLoss),
          debit: calc.charge,
          credit: 0,
          memo: `${memo} 할인료(${calc.days}일 × 연 ${input.annualRate}%)`,
        });
      }
      lines.push({
        accountId: await accountIdByCode(tx, NOTE_ACCOUNTS.receivable),
        partnerId: note.partnerId,
        debit: 0,
        credit: note.amount,
        memo,
      });
      const entryId = await this.post(tx, note, input.date, memo, lines);
      return {
        date: input.date,
        entryId,
        toStatus: 'discounted',
        detail: {
          annualRate: input.annualRate,
          days: calc.days,
          charge: calc.charge,
          proceeds: calc.proceeds,
        },
      };
    });
  }

  endorse(id: string, input: NoteEndorseInput) {
    return this.act(id, 'endorse', async (tx, note, partnerName) => {
      this.assertActionable(note, input.date, true, '배서양도');
      const toName = await this.partnerName(tx, input.toPartnerId);
      const memo = `${partnerName} 어음 ${toName}에 배서 ${note.noteNo}`;
      const entryId = await this.post(tx, note, input.date, memo, [
        {
          accountId:
            input.accountId ?? (await accountIdByCode(tx, SYSTEM_ACCOUNTS.accountsPayable)),
          partnerId: input.toPartnerId,
          debit: note.amount,
          credit: 0,
          memo,
        },
        {
          accountId: await accountIdByCode(tx, NOTE_ACCOUNTS.receivable),
          partnerId: note.partnerId,
          debit: 0,
          credit: note.amount,
          memo,
        },
      ]);
      return {
        date: input.date,
        entryId,
        toStatus: 'endorsed',
        detail: { toPartnerId: input.toPartnerId, toPartnerName: toName },
        patch: { endorsedToPartnerId: input.toPartnerId },
      };
    });
  }

  dishonor(id: string, input: NoteDishonorInput) {
    return this.act(id, 'dishonor', async (tx, note, partnerName) => {
      this.assertActionable(note, input.date, true, '부도 처리');
      const memo = `${partnerName} 어음 부도 ${note.noteNo}`;
      const entryId = await this.post(tx, note, input.date, memo, [
        {
          accountId: await accountIdByCode(tx, NOTE_ACCOUNTS.dishonored),
          partnerId: note.partnerId,
          debit: note.amount,
          credit: 0,
          memo,
        },
        {
          accountId: await accountIdByCode(tx, NOTE_ACCOUNTS.receivable),
          partnerId: note.partnerId,
          debit: 0,
          credit: note.amount,
          memo,
        },
      ]);
      return { date: input.date, entryId, toStatus: 'dishonored' };
    });
  }

  // ── 취소 ─────────────────────────────────────────────

  /**
   * 마지막 처리를 취소한다(전표는 그 처리일로 역분개). 등록만 남은 어음이면 어음을 지운다.
   * 지웠으면 null 을 돌려준다.
   */
  async undo(id: string) {
    const deleted = await this.db.tenant(async (tx) => {
      const note = await this.lockNote(tx, id);
      const [last] = await tx
        .select()
        .from(noteEvents)
        .where(eq(noteEvents.noteId, id))
        .orderBy(desc(noteEvents.createdAt))
        .limit(1);
      if (!last) throw new NotFoundException();
      if (last.entryId) {
        await this.journals.reverseIn(
          tx,
          last.entryId,
          {
            entryDate: last.eventDate,
            description: `[취소] 어음 ${ACTION_LABELS[last.action]} ${note.noteNo}`,
          },
          { system: true },
        );
      }
      if (last.action === 'register') {
        await tx.delete(notes).where(eq(notes.id, id));
      } else {
        await tx.delete(noteEvents).where(eq(noteEvents.id, last.id));
        const [previous] = await tx
          .select({ eventDate: noteEvents.eventDate, action: noteEvents.action })
          .from(noteEvents)
          .where(eq(noteEvents.noteId, id))
          .orderBy(desc(noteEvents.createdAt))
          .limit(1);
        await tx
          .update(notes)
          .set({
            status: last.fromStatus ?? 'holding',
            statusDate: previous && previous.action !== 'register' ? previous.eventDate : null,
            ...(last.action === 'endorse' ? { endorsedToPartnerId: null } : {}),
            updatedAt: new Date(),
          })
          .where(eq(notes.id, id));
      }
      await this.audit.record(
        {
          action: 'note.undo',
          entity: 'note',
          entityId: id,
          before: { action: last.action, eventDate: last.eventDate, entryId: last.entryId },
        },
        tx,
      );
      return last.action === 'register';
    });
    return { note: deleted ? null : await this.get(id) };
  }
}
