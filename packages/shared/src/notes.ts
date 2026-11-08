import { NOTE_KINDS, NOTE_STATUSES } from '@wellbuddy/accounting-core';
import { z } from 'zod';
import { IsoDateSchema, WonSchema } from './journal.js';

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalUuid = z.preprocess(emptyToNull, z.uuid().nullish());

/** 어음 수취(받을어음)·발행(지급어음) 등록 */
export const NoteRegisterSchema = z
  .object({
    kind: z.enum(NOTE_KINDS),
    noteNo: z
      .string()
      .trim()
      .min(1, { error: '어음번호를 입력해 주세요.' })
      .max(30, { error: '어음번호는 30자 이내입니다.' }),
    partnerId: z.uuid({ error: '거래처를 선택해 주세요.' }),
    issueDate: IsoDateSchema,
    dueDate: IsoDateSchema,
    amount: WonSchema.min(1, { error: '금액을 입력해 주세요.' }),
    bank: z.preprocess(emptyToNull, z.string().trim().max(50).nullish()),
    memo: z.preprocess(emptyToNull, z.string().trim().max(200).nullish()),
    /** 전표 일자(받은 날·발행한 날). 비우면 발행일 */
    entryDate: z.preprocess(emptyToNull, IsoDateSchema.nullish()),
    /** 상대 계정. 비우면 받을어음은 외상매출금, 지급어음은 외상매입금 */
    counterAccountId: optionalUuid,
    /** false 면 전표 없이 대장에만 올린다(기초잔액에 이미 들어 있는 어음) */
    createEntry: z.boolean().default(true),
  })
  .refine((v) => v.dueDate >= v.issueDate, {
    error: '만기일은 발행일보다 빠를 수 없습니다.',
    path: ['dueDate'],
  });
export type NoteRegisterInput = z.infer<typeof NoteRegisterSchema>;

/** 만기 결제(받을어음 입금·지급어음 지급) */
export const NoteSettleSchema = z.object({
  date: IsoDateSchema,
  accountId: z.uuid({ error: '입금·지급 계정을 선택해 주세요.' }),
});
export type NoteSettleInput = z.infer<typeof NoteSettleSchema>;

/** 받을어음 할인(매각거래): 할인료는 매출채권처분손실 */
export const NoteDiscountSchema = z.object({
  date: IsoDateSchema,
  /** 연 할인율(%) — 소수 둘째 자리까지 */
  annualRate: z
    .number({ error: '할인율을 입력해 주세요.' })
    .min(0, { error: '할인율은 0~100% 입니다.' })
    .max(100, { error: '할인율은 0~100% 입니다.' })
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
      error: '할인율은 소수 둘째 자리까지 입력합니다.',
    }),
  accountId: z.uuid({ error: '할인 대금을 받을 계정을 선택해 주세요.' }),
});
export type NoteDiscountInput = z.infer<typeof NoteDiscountSchema>;

/** 받을어음 배서양도: 받는 거래처의 외상매입금 등을 갚는다 */
export const NoteEndorseSchema = z.object({
  date: IsoDateSchema,
  toPartnerId: z.uuid({ error: '배서할 거래처를 선택해 주세요.' }),
  /** 비우면 외상매입금 */
  accountId: optionalUuid,
});
export type NoteEndorseInput = z.infer<typeof NoteEndorseSchema>;

/** 받을어음 부도 */
export const NoteDishonorSchema = z.object({ date: IsoDateSchema });
export type NoteDishonorInput = z.infer<typeof NoteDishonorSchema>;

export const NoteListQuerySchema = z.object({
  kind: z.enum(NOTE_KINDS).optional(),
  status: z.enum(NOTE_STATUSES).optional(),
  dueFrom: IsoDateSchema.optional(),
  dueTo: IsoDateSchema.optional(),
});
export type NoteListQuery = z.infer<typeof NoteListQuerySchema>;
