import type { AutoJournalKind } from '@wellbuddy/shared';
import { type EvidenceItem, normalizeName, searchText } from './items.js';

/** 규칙 조건(DB 행에서 필요한 것만) */
export interface RuleLike {
  id: string;
  priority: number;
  isActive: boolean;
  kinds: AutoJournalKind[];
  keywords: string | null;
  partnerId: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  createdAt: Date;
}

export function splitKeywords(keywords: string | null): string[] {
  return (keywords ?? '')
    .split(/[,，\n]/)
    .map((k) => normalizeName(k))
    .filter(Boolean);
}

/** 모든 조건이 맞아야 한다(비운 조건은 따지지 않는다) */
export function ruleMatches(rule: RuleLike, item: EvidenceItem): boolean {
  if (!rule.isActive) return false;
  if (rule.kinds.length > 0 && !rule.kinds.includes(item.kind)) return false;
  if (rule.partnerId && rule.partnerId !== item.partnerId) return false;
  if (rule.minAmount != null && item.amount < rule.minAmount) return false;
  if (rule.maxAmount != null && item.amount > rule.maxAmount) return false;
  const keywords = splitKeywords(rule.keywords);
  if (keywords.length > 0) {
    const text = searchText(item);
    if (!keywords.some((k) => text.includes(k))) return false;
  }
  return true;
}

/** 우선순위가 작은 것부터, 같으면 먼저 만든 규칙부터 보고 처음 맞는 규칙 */
export function findRule<T extends RuleLike>(rules: T[], item: EvidenceItem): T | null {
  const ordered = [...rules].sort(
    (a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  return ordered.find((r) => ruleMatches(r, item)) ?? null;
}
