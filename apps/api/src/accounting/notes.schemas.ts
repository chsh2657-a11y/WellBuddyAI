import { NOTE_KINDS, NOTE_STATUSES } from '@wellbuddy/accounting-core';
import { NOTE_ACTIONS } from '@wellbuddy/db';
import { z } from 'zod';

const nullableString = z.string().nullable();

export const NoteSchema = z.object({
  id: z.uuid(),
  kind: z.enum(NOTE_KINDS),
  noteNo: z.string(),
  partnerId: z.uuid(),
  partnerName: z.string(),
  issueDate: z.string(),
  dueDate: z.string(),
  amount: z.number().int(),
  bank: nullableString,
  status: z.enum(NOTE_STATUSES),
  statusDate: nullableString,
  endorsedToPartnerId: z.uuid().nullable(),
  endorsedToName: nullableString,
  memo: nullableString,
});

export const NoteDetailSchema = NoteSchema.extend({
  events: z.array(
    z.object({
      id: z.uuid(),
      action: z.enum(NOTE_ACTIONS),
      eventDate: z.string(),
      entryId: z.uuid().nullable(),
      entryNumber: nullableString,
      /** 할인료·할인일수·할인율, 배서 상대 등 */
      detail: z.record(z.string(), z.unknown()),
    }),
  ),
});

export const NoteUndoResultSchema = z.object({
  /** 등록까지 취소해 어음을 지웠으면 null */
  note: NoteDetailSchema.nullable(),
});
