import { type EvidenceItem, normalizeName } from './items.js';

/**
 * 과거 이력 열쇠: 사업자번호 → 거래처 → 이름 → 적요 순으로 정확하다.
 * 통장은 거래처 이름이 없으면 적요(급여·임대료 등)로도 찾는다.
 */
export function historyKeys(item: EvidenceItem): string[] {
  const keys: string[] = [];
  if (item.bizNo) keys.push(`biz:${item.bizNo}`);
  if (item.partnerId) keys.push(`partner:${item.partnerId}`);
  const name = item.counterparty ? normalizeName(item.counterparty) : '';
  if (name) keys.push(`name:${name}`);
  const desc = normalizeName(item.description);
  if (desc && (item.evidenceKind === 'bank' || !name)) keys.push(`desc:${desc}`);
  return keys;
}

export interface MemoryRow {
  key: string;
  accountId: string;
  deductible: boolean | null;
  partnerId: string | null;
  useCount: number;
  lastUsedAt: Date;
}

export interface HistorySuggestion {
  accountId: string;
  deductible: boolean | null;
  partnerId: string | null;
  confidence: number;
  reason: string;
}

const KEY_LABEL: Record<string, string> = {
  biz: '같은 사업자',
  partner: '같은 거래처',
  name: '같은 이름',
  desc: '같은 적요',
};

/**
 * 가장 정확한 열쇠부터 이력을 찾아, 그 열쇠에서 가장 많이(같으면 최근에) 쓴 계정을 고른다.
 * 신뢰도 = 그 계정을 쓴 비율 × 횟수 가중(1번 0.7, 2번 0.8, 3번 이상 0.9, 최대 0.95)
 */
export function recommendFromHistory(
  item: EvidenceItem,
  rows: MemoryRow[],
): HistorySuggestion | null {
  for (const key of historyKeys(item)) {
    const hits = rows.filter((r) => r.key === key && r.useCount > 0);
    if (hits.length === 0) continue;
    const total = hits.reduce((s, r) => s + r.useCount, 0);
    const top = [...hits].sort(
      (a, b) => b.useCount - a.useCount || b.lastUsedAt.getTime() - a.lastUsedAt.getTime(),
    )[0]!;
    const share = top.useCount / total;
    const weight = Math.min(1, 0.6 + 0.1 * top.useCount);
    const confidence = Math.min(0.95, Math.round(share * weight * 100) / 100);
    const label = KEY_LABEL[key.split(':')[0]!] ?? '같은 거래';
    return {
      accountId: top.accountId,
      deductible: top.deductible,
      partnerId: top.partnerId,
      confidence,
      reason: `${label} 거래 ${total}번 중 ${top.useCount}번 이 계정으로 분개`,
    };
  }
  return null;
}
