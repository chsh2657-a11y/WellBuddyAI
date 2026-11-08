import { daysBetween } from '@wellbuddy/accounting-core';

/**
 * 자동 매칭(P2-19): 같은 거래가 두 번 분개되지 않게 짝을 찾는다.
 *  - 카드 승인과 그 취소(같은 카드·승인번호·금액)가 둘 다 분개 전이면 서로 상쇄 → 둘 다 매칭 처리
 *  - 영수증(사진)과 카드 승인(같은 금액, 하루 이내, 사업자번호가 있으면 같아야)이 같은 지출이면 영수증을 매칭 처리
 */
export interface CardLike {
  id: string;
  cardId: string;
  approvalNo: string;
  amount: number;
  cancelled: boolean;
  date: string;
  merchantBizNo: string | null;
}

export function pairCancellations(cards: CardLike[]): { originalId: string; cancelId: string }[] {
  const used = new Set<string>();
  const pairs: { originalId: string; cancelId: string }[] = [];
  for (const cancel of cards.filter((c) => c.cancelled)) {
    const original = cards.find(
      (c) =>
        !c.cancelled &&
        !used.has(c.id) &&
        c.cardId === cancel.cardId &&
        c.approvalNo === cancel.approvalNo &&
        c.amount === cancel.amount,
    );
    if (!original) continue;
    used.add(original.id);
    pairs.push({ originalId: original.id, cancelId: cancel.id });
  }
  return pairs;
}

export interface ReceiptLike {
  id: string;
  date: string | null;
  totalAmount: number | null;
  bizNo: string | null;
}

export function matchReceipts(
  receipts: ReceiptLike[],
  cards: CardLike[],
): { receiptId: string; cardId: string }[] {
  const used = new Set<string>();
  const matches: { receiptId: string; cardId: string }[] = [];
  for (const r of receipts) {
    if (!r.date || !r.totalAmount) continue;
    const candidates = cards
      .filter(
        (c) =>
          !c.cancelled &&
          !used.has(c.id) &&
          c.amount === r.totalAmount &&
          Math.abs(daysBetween(r.date!, c.date)) <= 1 &&
          (!r.bizNo || !c.merchantBizNo || r.bizNo === c.merchantBizNo),
      )
      .sort(
        (a, b) =>
          Number(b.merchantBizNo === r.bizNo) - Number(a.merchantBizNo === r.bizNo) ||
          Math.abs(daysBetween(r.date!, a.date)) - Math.abs(daysBetween(r.date!, b.date)),
      );
    const best = candidates[0];
    if (!best) continue;
    used.add(best.id);
    matches.push({ receiptId: r.id, cardId: best.id });
  }
  return matches;
}

/** 홈택스 카드매입(사업용 카드 등록분) 한 건 */
export interface CardPurchaseLike {
  date: string;
  approvalNo: string;
  amount: number;
  cancelled: boolean;
  merchantBizNo?: string | null;
  vatAmount?: number | null;
}

/**
 * 홈택스 카드매입 ↔ 카드 승인: 승인번호·금액·취소 여부가 같고 하루 이내면 같은 거래다.
 * 카드사 자료에 없는 가맹점 사업자번호·부가세를 채우는 데 쓴다(같은 거래를 두 번 분개하지 않는다).
 */
export function matchCardPurchases(
  purchases: CardPurchaseLike[],
  cards: CardLike[],
): { cardTransactionId: string; merchantBizNo: string | null; vatAmount: number | null }[] {
  const used = new Set<string>();
  const out: {
    cardTransactionId: string;
    merchantBizNo: string | null;
    vatAmount: number | null;
  }[] = [];
  for (const p of purchases) {
    const card = cards.find(
      (c) =>
        !used.has(c.id) &&
        c.approvalNo === p.approvalNo &&
        c.amount === p.amount &&
        c.cancelled === p.cancelled &&
        Math.abs(daysBetween(p.date, c.date)) <= 1,
    );
    if (!card) continue;
    used.add(card.id);
    out.push({
      cardTransactionId: card.id,
      merchantBizNo: p.merchantBizNo ?? null,
      vatAmount: p.vatAmount ?? null,
    });
  }
  return out;
}
