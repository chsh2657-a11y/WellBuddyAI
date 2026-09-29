import { AUTO_JOURNAL_KINDS, SUGGESTION_METHODS, UPLOAD_KINDS } from '@wellbuddy/shared';
import { z } from 'zod';

const int = z.number().int();
const nullableString = z.string().nullable();
const nullableUuid = z.uuid().nullable();

export const ReviewItemSchema = z.object({
  evidenceKind: z.enum(UPLOAD_KINDS),
  evidenceId: z.uuid(),
  kind: z.enum(AUTO_JOURNAL_KINDS),
  kindLabel: z.string(),
  date: z.string(),
  description: z.string(),
  counterparty: nullableString,
  /** 계좌·카드 별칭 */
  sourceLabel: nullableString,
  amount: int,
  /** 취소·마이너스 증빙 */
  reversal: z.boolean(),
  accountId: nullableUuid,
  accountCode: nullableString,
  accountName: nullableString,
  deductible: z.boolean().nullable(),
  partnerId: nullableUuid,
  partnerName: nullableString,
  departmentId: nullableUuid,
  projectId: nullableUuid,
  memo: nullableString,
  confidence: z.number(),
  method: z.enum(SUGGESTION_METHODS),
  reason: nullableString,
  /** 전기하지 못한 이유 */
  error: nullableString,
  edited: z.boolean(),
  /** 이 입출금으로 반제할 세금계산서 수 */
  settleCount: int,
  /** 만들 전표 미리보기 */
  lines: z.array(
    z.object({ accountCode: z.string(), accountName: z.string(), debit: int, credit: int }),
  ),
});

export const RunSummarySchema = z.object({
  total: int,
  matched: int,
  posted: int,
  review: int,
  failed: int,
  /** AI 가 추천한 거래 수 */
  aiClassified: int,
  /** AI 분류를 못 했으면 이유(나머지는 규칙·이력·기본 추천대로) */
  aiError: nullableString,
});

const RefSchema = z.object({ evidenceKind: z.enum(UPLOAD_KINDS), evidenceId: z.uuid() });
export const ApproveResultSchema = z.object({
  posted: z.array(RefSchema.extend({ entryId: z.uuid() })),
  failed: z.array(RefSchema.extend({ message: z.string() })),
});

export const RuleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  priority: int,
  isActive: z.boolean(),
  kinds: z.array(z.enum(AUTO_JOURNAL_KINDS)),
  keywords: nullableString,
  partnerId: nullableUuid,
  partnerName: nullableString,
  minAmount: int.nullable(),
  maxAmount: int.nullable(),
  accountId: z.uuid(),
  account: z.string(),
  assignPartnerId: nullableUuid,
  assignPartnerName: nullableString,
  deductible: z.boolean().nullable(),
  departmentId: nullableUuid,
  projectId: nullableUuid,
  memo: nullableString,
  hitCount: int,
  lastHitAt: nullableString,
});

export const RuleSuggestionSchema = z.object({
  kind: z.enum(AUTO_JOURNAL_KINDS),
  kindLabel: z.string(),
  /** 바탕이 된 이력 열쇠(수락·무시할 때 그대로 보낸다) */
  keys: z.array(z.string()),
  label: z.string(),
  partnerId: nullableUuid,
  partnerName: nullableString,
  keywords: nullableString,
  accountId: z.uuid(),
  account: z.string(),
  deductible: z.boolean().nullable(),
  /** 그 계정으로 승인한 횟수 / 전체 승인 횟수 */
  useCount: int,
  total: int,
  /** 만들 규칙 이름 */
  name: z.string(),
});
