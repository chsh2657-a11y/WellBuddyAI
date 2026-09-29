import { formatWon } from '@wellbuddy/accounting-core';

/** 아직 반제하지 않은 외상 세금계산서(전기한 것만) */
export interface OpenInvoice {
  id: string;
  date: string;
  total: number;
}

export interface SettlementMatch {
  /** 반제할 세금계산서(부분 입출금이면 비어 있다) */
  ids: string[];
  confidence: number;
  reason: string;
}

/** 조합을 찾아볼 오래된 세금계산서 수, 한 번에 묶는 최대 장수 */
const SEARCH_LIMIT = 12;
const MAX_GROUP = 4;

function* combinations(
  n: number,
  k: number,
  start = 0,
  prefix: number[] = [],
): Generator<number[]> {
  if (prefix.length === k) {
    yield prefix;
    return;
  }
  for (let i = start; i <= n - (k - prefix.length); i++) {
    yield* combinations(n, k, i + 1, [...prefix, i]);
  }
}

const span = (list: OpenInvoice[]) =>
  list.length === 1
    ? `${list[0]!.date} 세금계산서 ${formatWon(list[0]!.total)}원`
    : `세금계산서 ${list.length}장(${list[0]!.date}~${list.at(-1)!.date}) 합계 ${formatWon(
        list.reduce((s, i) => s + i.total, 0),
      )}원`;

/**
 * 외상 반제 매칭(P2-27): 입금(출금) 금액과 같은 미결 세금계산서를 찾는다.
 *  ① 금액이 같은 한 장(가장 오래된 것) 0.95
 *  ② 오래된 순서대로 더한 합이 같음 0.93
 *  ③ 오래된 12장 중 2~4장 조합의 합이 같음 0.9
 *  ④ 맞는 조합은 없지만 미결 잔액이 있음: 일부 입출금 0.7, 잔액보다 많으면 0.6
 * invoices 는 오래된 순서여야 한다. label 은 '외상매출금' 또는 '외상매입금'.
 */
export function matchSettlement(
  amount: number,
  invoices: OpenInvoice[],
  label: string,
): SettlementMatch | null {
  const open = invoices.filter((i) => i.total > 0);
  if (open.length === 0 || amount <= 0) return null;

  const single = open.find((i) => i.total === amount);
  if (single) {
    return { ids: [single.id], confidence: 0.95, reason: `${label} 반제: ${span([single])}` };
  }

  let running = 0;
  for (let k = 0; k < open.length; k++) {
    running += open[k]!.total;
    if (running === amount) {
      const list = open.slice(0, k + 1);
      return {
        ids: list.map((i) => i.id),
        confidence: 0.93,
        reason: `${label} 반제: ${span(list)}`,
      };
    }
    if (running > amount) break;
  }

  const head = open.slice(0, SEARCH_LIMIT);
  for (let size = 2; size <= Math.min(MAX_GROUP, head.length); size++) {
    for (const combo of combinations(head.length, size)) {
      const list = combo.map((i) => head[i]!);
      if (list.reduce((s, i) => s + i.total, 0) === amount) {
        return {
          ids: list.map((i) => i.id),
          confidence: 0.9,
          reason: `${label} 반제: ${span(list)}`,
        };
      }
    }
  }

  const balance = open.reduce((s, i) => s + i.total, 0);
  return amount < balance
    ? {
        ids: [],
        confidence: 0.7,
        reason: `${label} 일부 반제(미결 ${open.length}장 ${formatWon(balance)}원 중 ${formatWon(amount)}원)`,
      }
    : {
        ids: [],
        confidence: 0.6,
        reason: `미결 ${label}(${formatWon(balance)}원)보다 많습니다. 선수금·선급금인지 확인해 주세요.`,
      };
}
