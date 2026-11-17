import {
  evidenceSuggestions,
  partners,
  taxInvoiceIssues,
  taxInvoices,
  tradeDocs,
  type Transaction,
} from '@wellbuddy/db';
import type { TradeDocKind } from '@wellbuddy/shared';
import { and, asc, eq, gte, inArray, isNull, lte, ne, notExists, or, sql } from 'drizzle-orm';
import {
  MATCHABLE_DOC_KINDS,
  planTradeInvoiceMatches,
} from '../auto-journal/engine/trade-matching.js';

/**
 * 판매·구매 문서 ↔ 세금계산서(증빙) 연결(P3-08). 증빙·영업 두 모듈이 함께 쓰는 트랜잭션 함수들이다.
 *
 * 문서가 이미 매출·매입 전표를 만들었으므로 짝지은 계산서는 분개하지 않는다:
 * 증빙을 'posted' 로 두고 entryId 를 문서 전표로 잇는다. 그러면 외상 반제(P2-27)가 이 계산서를 그대로 쓴다.
 */

const MATCHABLE_KINDS = Object.keys(MATCHABLE_DOC_KINDS) as TradeDocKind[];

/** 계산서와 문서들을 잇는다(월합계는 여러 문서). 첫 문서의 전표·거래처를 증빙에 남긴다 */
export async function linkInvoiceIn(tx: Transaction, invoiceId: string, docIds: string[]) {
  if (docIds.length === 0) return;
  const docs = await tx
    .select({ id: tradeDocs.id, entryId: tradeDocs.entryId, partnerId: tradeDocs.partnerId })
    .from(tradeDocs)
    .where(inArray(tradeDocs.id, docIds))
    .orderBy(asc(tradeDocs.docNo));
  const first = docs[0];
  if (!first) return;
  await tx
    .update(tradeDocs)
    .set({ taxInvoiceId: invoiceId, updatedAt: new Date() })
    .where(inArray(tradeDocs.id, docIds));
  await tx
    .update(taxInvoices)
    .set({
      status: 'posted',
      entryId: first.entryId,
      ...(first.partnerId ? { partnerId: first.partnerId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(taxInvoices.id, invoiceId));
  // 검토함에 남은 추천은 지운다
  await tx
    .delete(evidenceSuggestions)
    .where(
      and(
        eq(evidenceSuggestions.evidenceKind, 'tax_invoice'),
        eq(evidenceSuggestions.evidenceId, invoiceId),
      ),
    );
}

/**
 * 문서를 취소할 때: 연결을 끊는다. 같은 계산서에 남은 문서가 없으면 증빙을 대기로 돌려
 * 자동분개 대상이 되게 하고, 남은 문서가 있으면(월합계) 그 문서 전표로 다시 잇는다.
 */
export async function unlinkDocIn(tx: Transaction, docId: string) {
  const [doc] = await tx
    .select({ taxInvoiceId: tradeDocs.taxInvoiceId })
    .from(tradeDocs)
    .where(eq(tradeDocs.id, docId));
  const invoiceId = doc?.taxInvoiceId;
  if (!invoiceId) return;
  await tx
    .update(tradeDocs)
    .set({ taxInvoiceId: null, updatedAt: new Date() })
    .where(eq(tradeDocs.id, docId));
  const [rest] = await tx
    .select({ entryId: tradeDocs.entryId })
    .from(tradeDocs)
    .where(and(eq(tradeDocs.taxInvoiceId, invoiceId), ne(tradeDocs.status, 'cancelled')))
    .orderBy(asc(tradeDocs.docNo))
    .limit(1);
  await tx
    .update(taxInvoices)
    .set(
      rest
        ? { entryId: rest.entryId, updatedAt: new Date() }
        : { status: 'pending', entryId: null, updatedAt: new Date() },
    )
    .where(eq(taxInvoices.id, invoiceId));
}

/** 발행을 취소할 때: 문서 연결을 모두 풀고 증빙은 분개하지 않음으로 둔다 */
export async function releaseInvoiceIn(tx: Transaction, invoiceId: string) {
  await tx
    .update(tradeDocs)
    .set({ taxInvoiceId: null, updatedAt: new Date() })
    .where(eq(tradeDocs.taxInvoiceId, invoiceId));
  await tx
    .update(taxInvoices)
    .set({ status: 'ignored', entryId: null, updatedAt: new Date() })
    .where(eq(taxInvoices.id, invoiceId));
}

/** 문서 전표가 새로 만들어지면 연결된 증빙도 새 전표를 가리키게 한다 */
export async function moveInvoiceEntryIn(
  tx: Transaction,
  invoiceId: string,
  from: string | null,
  to: string,
) {
  await tx
    .update(taxInvoices)
    .set({ entryId: to, updatedAt: new Date() })
    .where(
      and(
        eq(taxInvoices.id, invoiceId),
        from ? or(isNull(taxInvoices.entryId), eq(taxInvoices.entryId, from)) : undefined,
      ),
    );
}

const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const monthEnd = (d: string) => {
  const [y, m] = d.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${d.slice(0, 7)}-${String(last).padStart(2, '0')}`;
};

/**
 * 대기·검토 중인 세금계산서와 판매·구매 문서를 짝짓는다. invoiceIds 는 자동분개가, docIds 는 문서를 만들 때 준다.
 * 짝지은 증빙 id 를 돌려준다.
 */
export async function matchTradeInvoicesIn(
  tx: Transaction,
  filter: { invoiceIds?: string[]; docIds?: string[] },
): Promise<string[]> {
  if (filter.invoiceIds?.length === 0 || filter.docIds?.length === 0) return [];
  const counterparty = sql<string>`case when ${taxInvoices.direction} = 'sales' then ${taxInvoices.buyerBizNo} else ${taxInvoices.supplierBizNo} end`;
  const openInvoice = inArray(taxInvoices.status, ['pending', 'review']);

  let invoiceRows: {
    id: string;
    direction: 'sales' | 'purchase';
    issueDate: string;
    bizNo: string;
    supply: number;
    vat: number;
  }[];
  const invoiceSelect = {
    id: taxInvoices.id,
    direction: taxInvoices.direction,
    issueDate: taxInvoices.issueDate,
    bizNo: counterparty,
    supply: taxInvoices.supplyAmount,
    vat: taxInvoices.vatAmount,
  };
  if (filter.docIds) {
    // 문서 쪽에서 시작: 그 문서 거래처·달의 대기 계산서
    const docs = await tx
      .select({ docDate: tradeDocs.docDate, bizNo: partners.bizRegNo })
      .from(tradeDocs)
      .innerJoin(partners, eq(partners.id, tradeDocs.partnerId))
      .where(inArray(tradeDocs.id, filter.docIds));
    const bizNos = [...new Set(docs.flatMap((d) => (d.bizNo ? [d.bizNo] : [])))];
    if (bizNos.length === 0) return [];
    const dates = docs.map((d) => d.docDate).sort();
    invoiceRows = await tx
      .select(invoiceSelect)
      .from(taxInvoices)
      .where(
        and(
          openInvoice,
          inArray(counterparty, bizNos),
          gte(taxInvoices.issueDate, monthStart(dates[0]!)),
          lte(taxInvoices.issueDate, monthEnd(dates.at(-1)!)),
        ),
      );
  } else {
    invoiceRows = await tx
      .select(invoiceSelect)
      .from(taxInvoices)
      .where(
        and(
          openInvoice,
          filter.invoiceIds ? inArray(taxInvoices.id, filter.invoiceIds) : undefined,
        ),
      );
  }
  if (invoiceRows.length === 0) return [];

  const bizNos = [...new Set(invoiceRows.map((i) => i.bizNo))];
  const dates = invoiceRows.map((i) => i.issueDate).sort();
  const docRows = await tx
    .select({
      id: tradeDocs.id,
      kind: tradeDocs.kind,
      docNo: tradeDocs.docNo,
      docDate: tradeDocs.docDate,
      bizNo: partners.bizRegNo,
      supply: tradeDocs.supplyTotal,
      vat: tradeDocs.vatTotal,
    })
    .from(tradeDocs)
    .innerJoin(partners, eq(partners.id, tradeDocs.partnerId))
    .where(
      and(
        inArray(tradeDocs.kind, MATCHABLE_KINDS),
        eq(tradeDocs.status, 'posted'),
        isNull(tradeDocs.taxInvoiceId),
        or(
          isNull(tradeDocs.evidenceType),
          inArray(tradeDocs.evidenceType, ['tax_invoice', 'invoice']),
        ),
        inArray(partners.bizRegNo, bizNos),
        gte(tradeDocs.docDate, monthStart(dates[0]!)),
        lte(tradeDocs.docDate, monthEnd(dates.at(-1)!)),
        // 이 판매에서 발행 중인 계산서가 있으면(승인번호 대기) 그 발행이 잇는다
        notExists(
          tx
            .select({ one: sql`1` })
            .from(taxInvoiceIssues)
            .where(
              and(
                eq(taxInvoiceIssues.tradeDocId, tradeDocs.id),
                ne(taxInvoiceIssues.status, 'cancelled'),
              ),
            ),
        ),
      ),
    );

  const matches = planTradeInvoiceMatches(
    invoiceRows,
    docRows.map((d) => ({ ...d, bizNo: d.bizNo ?? '' })),
  );
  for (const m of matches) await linkInvoiceIn(tx, m.invoiceId, m.docIds);
  return matches.map((m) => m.invoiceId);
}
