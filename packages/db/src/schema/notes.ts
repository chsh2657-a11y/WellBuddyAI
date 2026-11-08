import type { NoteKind, NoteStatus } from '@wellbuddy/accounting-core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_columns.js';
import { tenantIsolationPolicy } from './_rls.js';
import { partners } from './accounting-master.js';
import { users } from './auth.js';
import { companies } from './companies.js';
import { journalEntries } from './journal.js';

const companyRef = () =>
  uuid()
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' });

const won = () => bigint({ mode: 'number' });

/** 받을어음·지급어음 대장. 상태가 바뀔 때마다 전표를 만들고 note_events 에 남긴다. */
export const notes = pgTable(
  'notes',
  {
    id: id(),
    companyId: companyRef(),
    kind: text().$type<NoteKind>().notNull(),
    noteNo: text().notNull(),
    /** 받을어음은 받은 곳(발행인·배서인), 지급어음은 준 곳(수취인) */
    partnerId: uuid()
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    issueDate: date().notNull(),
    dueDate: date().notNull(),
    amount: won().notNull(),
    /** 지급 은행(지급지) */
    bank: text(),
    status: text().$type<NoteStatus>().notNull().default('holding'),
    /** 마지막 상태가 바뀐 날(결제·할인·배서·부도일) */
    statusDate: date(),
    endorsedToPartnerId: uuid().references(() => partners.id, { onDelete: 'restrict' }),
    memo: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('notes_company_kind_no_uq').on(t.companyId, t.kind, t.noteNo),
    index('notes_company_due_idx').on(t.companyId, t.dueDate),
    check('notes_amount_ck', sql`amount > 0 and due_date >= issue_date`),
    check('notes_kind_ck', sql`kind in ('receivable', 'payable')`),
    check(
      'notes_status_ck',
      sql`status in ('holding', 'settled', 'discounted', 'endorsed', 'dishonored')`,
    ),
    tenantIsolationPolicy(),
  ],
);

export const NOTE_ACTIONS = ['register', 'settle', 'discount', 'endorse', 'dishonor'] as const;
export type NoteAction = (typeof NOTE_ACTIONS)[number];

/** 어음 처리 이력(수취·발행, 결제, 할인, 배서, 부도)과 그 전표 */
export const noteEvents = pgTable(
  'note_events',
  {
    id: id(),
    companyId: companyRef(),
    noteId: uuid()
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    action: text().$type<NoteAction>().notNull(),
    eventDate: date().notNull(),
    entryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
    fromStatus: text().$type<NoteStatus>(),
    toStatus: text().$type<NoteStatus>().notNull(),
    /** 할인료·할인일수·할인율, 배서 상대 등 */
    detail: jsonb().$type<Record<string, unknown>>(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('note_events_note_idx').on(t.noteId),
    check(
      'note_events_action_ck',
      sql`action in ('register', 'settle', 'discount', 'endorse', 'dishonor')`,
    ),
    tenantIsolationPolicy(),
  ],
);
