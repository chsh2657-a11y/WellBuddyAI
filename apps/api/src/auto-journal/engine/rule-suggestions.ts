import type { AutoJournalKind, UploadKind } from '@wellbuddy/shared';
import { type EvidenceItem, normalizeName } from './items.js';
import { type RuleLike, ruleMatches } from './rules.js';

/** 규칙을 제안하려면 같은 거래를 이만큼 승인했고, 이 비율 이상 같은 계정이어야 한다 */
export const MIN_USES = 3;
export const MIN_SHARE = 0.8;

export interface MemoryEntry {
  kind: AutoJournalKind;
  key: string;
  label: string | null;
  accountId: string;
  deductible: boolean | null;
  useCount: number;
  lastUsedAt: Date;
  suggestionDismissed: boolean;
}

export interface PartnerRef {
  id: string;
  name: string;
  bizRegNo: string | null;
}

export interface RuleSuggestion {
  kind: AutoJournalKind;
  /** 이 제안의 바탕이 된 이력 열쇠(무시·수락하면 모두 표시한다) */
  keys: string[];
  label: string;
  /** 조건: 거래처 또는 키워드 */
  partnerId: string | null;
  keywords: string | null;
  accountId: string;
  deductible: boolean | null;
  /** 그 계정으로 승인한 횟수 / 전체 승인 횟수 */
  useCount: number;
  total: number;
}

const EVIDENCE_OF: Record<AutoJournalKind, UploadKind> = {
  bank_in: 'bank',
  bank_out: 'bank',
  card: 'card',
  card_cancel: 'card',
  tax_sales: 'tax_invoice',
  tax_purchase: 'tax_invoice',
  cash_sales: 'cash_receipt',
  cash_purchase: 'cash_receipt',
};

/** 이 조건의 거래를 지금 규칙들이 이미 처리하는지(금액 조건은 따지지 않는다) */
function covered(rules: RuleLike[], s: Omit<RuleSuggestion, 'keys' | 'useCount' | 'total'>) {
  const text = s.keywords ?? s.label;
  const item: EvidenceItem = {
    evidenceKind: EVIDENCE_OF[s.kind],
    evidenceId: 'suggestion',
    kind: s.kind,
    date: '2000-01-01',
    description: text,
    counterparty: text,
    bizNo: null,
    partnerId: s.partnerId,
    amount: 1,
    supply: null,
    vat: null,
    vatType: 'taxable',
    ledgerAccountId: null,
    category: null,
    issuerName: null,
    reversal: false,
  };
  return rules.some((r) => ruleMatches({ ...r, minAmount: null, maxAmount: null }, item));
}

/**
 * 사용자 승인 이력 → 규칙 제안(P2-25). 같은 거래(종류·열쇠)를 3번 이상 승인했고 80% 이상 같은 계정이면,
 * 거래처(사업자번호·이름으로 찾은) 또는 키워드 조건의 규칙을 제안한다. 무시한 것과 이미 규칙이
 * 처리하는 것은 빼고, 같은 거래처·키워드·계정으로 모이는 제안은 하나로 합친다.
 */
export function suggestRules(
  memory: MemoryEntry[],
  rules: RuleLike[],
  partners: PartnerRef[],
): RuleSuggestion[] {
  const byName = new Map<string, PartnerRef | null>();
  for (const p of partners) {
    const k = normalizeName(p.name);
    byName.set(k, byName.has(k) ? null : p);
  }
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  const groups = new Map<string, MemoryEntry[]>();
  for (const m of memory) {
    const g = `${m.kind}|${m.key}`;
    groups.set(g, [...(groups.get(g) ?? []), m]);
  }

  const merged = new Map<string, RuleSuggestion>();
  for (const rows of groups.values()) {
    if (rows.some((r) => r.suggestionDismissed)) continue;
    const total = rows.reduce((s, r) => s + r.useCount, 0);
    const top = [...rows].sort(
      (a, b) => b.useCount - a.useCount || b.lastUsedAt.getTime() - a.lastUsedAt.getTime(),
    )[0]!;
    if (total < MIN_USES || top.useCount / total < MIN_SHARE) continue;

    const [prefix, ...rest] = top.key.split(':');
    const value = rest.join(':');
    let partner: PartnerRef | null | undefined = null;
    if (prefix === 'partner') partner = partnerById.get(value);
    if (prefix === 'biz') partner = partners.find((p) => p.bizRegNo === value);
    if (prefix === 'name') partner = byName.get(value);
    if (prefix === 'partner' && !partner) continue;
    const label = partner?.name ?? top.label ?? value;
    const condition = {
      kind: top.kind,
      label,
      partnerId: partner?.id ?? null,
      keywords: partner ? null : label,
      accountId: top.accountId,
      deductible: top.deductible,
    };
    if (covered(rules, condition)) continue;

    const id = `${top.kind}|${top.accountId}|${
      condition.partnerId ? `p:${condition.partnerId}` : `k:${normalizeName(label)}`
    }`;
    const prev = merged.get(id);
    const keys = rows.map((r) => r.key).filter((k, i, a) => a.indexOf(k) === i);
    if (!prev) {
      merged.set(id, { ...condition, keys, useCount: top.useCount, total });
    } else {
      prev.keys.push(...keys.filter((k) => !prev.keys.includes(k)));
      if (total > prev.total) Object.assign(prev, { useCount: top.useCount, total });
    }
  }
  return [...merged.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}
