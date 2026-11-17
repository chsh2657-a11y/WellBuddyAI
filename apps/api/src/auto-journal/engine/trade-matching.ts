/**
 * 수집한 세금계산서 ↔ 판매·구매 문서 짝짓기(P3-08).
 * 판매·구매 문서가 이미 매출·매입 전표를 만들었으므로, 같은 거래의 계산서는 분개하지 않고 문서 전표에 잇는다.
 *
 *  - 같은 방향(매출: 판매·판매반품, 매입: 구매·구매반품), 같은 사업자번호, 작성일자와 문서일자가 같은 달
 *  - 공급가액·세액이 모두 같으면 1:1(반품은 음수 금액의 수정세금계산서와). 여럿이면 날짜가 가장 가까운 문서
 *  - 1:1 로 남은 계산서는 같은 거래처·같은 달에 남은 문서(2건 이상)의 합계가 같으면 월합계로 모두 잇는다
 */

export interface MatchInvoice {
  id: string;
  direction: 'sales' | 'purchase';
  issueDate: string;
  /** 상대 사업자번호(매출은 공급받는자, 매입은 공급자) */
  bizNo: string;
  supply: number;
  vat: number;
}

export interface MatchDoc {
  id: string;
  kind: string;
  docNo: string;
  docDate: string;
  bizNo: string;
  /** 문서의 공급가액·세액(반품도 양수로 저장된 그대로) */
  supply: number;
  vat: number;
}

export interface TradeInvoiceMatch {
  invoiceId: string;
  docIds: string[];
}

/** 문서 종류 → 계산서 방향과 금액 부호 */
export const MATCHABLE_DOC_KINDS: Record<
  string,
  { direction: 'sales' | 'purchase'; sign: 1 | -1 }
> = {
  sale: { direction: 'sales', sign: 1 },
  sales_return: { direction: 'sales', sign: -1 },
  purchase: { direction: 'purchase', sign: 1 },
  purchase_return: { direction: 'purchase', sign: -1 },
};

const digits = (s: string) => s.replace(/\D/g, '');
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

export function planTradeInvoiceMatches(
  invoices: MatchInvoice[],
  docs: MatchDoc[],
): TradeInvoiceMatch[] {
  const candidates = docs.flatMap((d) => {
    const m = MATCHABLE_DOC_KINDS[d.kind];
    if (!m) return [];
    return [
      {
        id: d.id,
        docNo: d.docNo,
        docDate: d.docDate,
        month: d.docDate.slice(0, 7),
        direction: m.direction,
        bizNo: digits(d.bizNo),
        supply: d.supply * m.sign,
        vat: d.vat * m.sign,
      },
    ];
  });
  const used = new Set<string>();
  const sameGroup = (inv: MatchInvoice) => {
    const bizNo = digits(inv.bizNo);
    const month = inv.issueDate.slice(0, 7);
    return candidates.filter(
      (d) =>
        !used.has(d.id) && d.direction === inv.direction && d.bizNo === bizNo && d.month === month,
    );
  };

  const ordered = [...invoices].sort(
    (a, b) => a.issueDate.localeCompare(b.issueDate) || a.id.localeCompare(b.id),
  );
  const matches: TradeInvoiceMatch[] = [];
  const leftover: MatchInvoice[] = [];
  for (const inv of ordered) {
    const [best] = sameGroup(inv)
      .filter((d) => d.supply === inv.supply && d.vat === inv.vat)
      .sort(
        (a, b) =>
          days(a.docDate, inv.issueDate) - days(b.docDate, inv.issueDate) ||
          a.docNo.localeCompare(b.docNo),
      );
    if (best) {
      used.add(best.id);
      matches.push({ invoiceId: inv.id, docIds: [best.id] });
    } else {
      leftover.push(inv);
    }
  }
  // 월합계 세금계산서
  for (const inv of leftover) {
    const group = sameGroup(inv);
    if (group.length < 2) continue;
    const supply = group.reduce((s, d) => s + d.supply, 0);
    const vat = group.reduce((s, d) => s + d.vat, 0);
    if (supply !== inv.supply || vat !== inv.vat) continue;
    for (const d of group) used.add(d.id);
    matches.push({
      invoiceId: inv.id,
      docIds: group.sort((a, b) => a.docNo.localeCompare(b.docNo)).map((d) => d.id),
    });
  }
  return matches;
}
