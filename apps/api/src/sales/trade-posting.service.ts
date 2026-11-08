import { Injectable } from '@nestjs/common';
import { SYSTEM_ACCOUNTS, type VatType } from '@wellbuddy/accounting-core';
import {
  accounts,
  items,
  journalEntries,
  journalLines,
  partners,
  stockMoves,
  tradeDocLines,
  tradeDocs,
  type Transaction,
} from '@wellbuddy/db';
import {
  ITEM_KIND_ACCOUNTS,
  isStockItem,
  type JournalEntryInput,
  TRADE_DOC_KIND_LABELS,
} from '@wellbuddy/shared';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { JournalsService } from '../accounting/journals.service.js';
import { AppException } from '../common/errors.js';

type Doc = typeof tradeDocs.$inferSelect;
type Item = typeof items.$inferSelect;
type Line = typeof tradeDocLines.$inferSelect & { item: Item };

/** 전표 한 장의 줄(계정·차대·거래처) */
interface EntryLine {
  accountId: string;
  debit: number;
  credit: number;
  partnerId: string | null;
}

/** 문서 금액·재고 이동으로 정한 "있어야 할" 전표 */
type DesiredEntry = Omit<JournalEntryInput, 'lines'> & { lines: EntryLine[] };

const lineKey = (l: EntryLine) => `${l.accountId}|${l.debit}|${l.credit}|${l.partnerId ?? ''}`;

/**
 * 거래 문서 ↔ 전표 동기화.
 * 문서의 지금 상태(확정·취소, 다음 단계로 넘어갔는지, 재고 이동 금액)로 "있어야 할 전표"를 계산하고,
 * 연결된 전표와 다르면 기존 전표를 역분개(전기 전이면 삭제)한 뒤 새로 만든다.
 * 전환·취소·소급 재원가를 모두 이 한 경로로 처리한다.
 */
@Injectable()
export class TradePostingService {
  constructor(private readonly journals: JournalsService) {}

  /** 문서의 매출·매입(main)·원가(cost) 전표를 맞춘다. */
  async syncIn(tx: Transaction, docId: string): Promise<void> {
    const [doc] = await tx.select().from(tradeDocs).where(eq(tradeDocs.id, docId));
    if (!doc) return;
    const ctx = await this.context(tx, doc);
    const main = ctx ? await this.mainEntry(tx, doc, ctx) : null;
    const cost = ctx ? await this.costEntry(tx, doc, ctx) : null;
    const entryId = await this.reconcile(tx, doc, doc.entryId, main, 'entryId');
    const costEntryId = await this.reconcile(tx, doc, doc.costEntryId, cost, 'costEntryId');
    if (entryId !== doc.entryId || costEntryId !== doc.costEntryId) {
      await tx
        .update(tradeDocs)
        .set({ entryId, costEntryId, updatedAt: new Date() })
        .where(eq(tradeDocs.id, doc.id));
    }
  }

  // ── 있어야 할 전표 ───────────────────────────────────

  private async context(tx: Transaction, doc: Doc) {
    if (doc.status !== 'posted') return null;
    const lineRows = await tx
      .select({ line: tradeDocLines, item: items })
      .from(tradeDocLines)
      .innerJoin(items, eq(items.id, tradeDocLines.itemId))
      .where(eq(tradeDocLines.docId, doc.id))
      .orderBy(tradeDocLines.lineNo);
    const lines: Line[] = lineRows.map((r) => ({ ...r.line, item: r.item }));
    const accountRows = await tx.select({ id: accounts.id, code: accounts.code }).from(accounts);
    const byCode = new Map(accountRows.map((a) => [a.code, a.id]));
    const account = (code: string) => {
      const id = byCode.get(code);
      if (!id) {
        throw new AppException(
          'ACCOUNT_NOT_FOUND',
          `${code} 계정이 없습니다. 계정과목에서 표준 계정을 복원해 주세요.`,
        );
      }
      return id;
    };
    const [partner] = doc.partnerId
      ? await tx
          .select({ name: partners.name })
          .from(partners)
          .where(eq(partners.id, doc.partnerId))
      : [];
    return { lines, account, partnerName: partner?.name ?? '' };
  }

  /** 품목의 재고자산 계정(재고 품목) 또는 매입 비용 계정(서비스) */
  private purchaseAccount(item: Item, account: (code: string) => string) {
    return item.purchaseAccountId ?? account(ITEM_KIND_ACCOUNTS[item.kind].purchase);
  }

  private description(doc: Doc, partnerName: string) {
    return `[${TRADE_DOC_KIND_LABELS[doc.kind]}] ${doc.docNo}${partnerName ? ` ${partnerName}` : ''}`;
  }

  private vatType(lines: Line[]): VatType {
    return lines[0]?.item.vatType ?? 'taxable';
  }

  private evidence(doc: Doc, lines: Line[]) {
    const fallback = this.vatType(lines) === 'exempt' ? 'invoice' : 'tax_invoice';
    return (doc.evidenceType ?? fallback) as NonNullable<JournalEntryInput['vat']>['evidenceType'];
  }

  private async mainEntry(
    tx: Transaction,
    doc: Doc,
    ctx: NonNullable<Awaited<ReturnType<TradePostingService['context']>>>,
  ): Promise<DesiredEntry | null> {
    const { lines, account } = ctx;
    const sum = (pick: (l: Line) => number) => lines.reduce((s, l) => s + pick(l), 0);
    const byAccount = (pick: (l: Line) => [string, number] | null) => {
      const map = new Map<string, number>();
      for (const l of lines) {
        const v = pick(l);
        if (v && v[1] !== 0) map.set(v[0], (map.get(v[0]) ?? 0) + v[1]);
      }
      return [...map.entries()];
    };
    const payable = account(SYSTEM_ACCOUNTS.accountsPayable);
    const base = {
      entryDate: doc.docDate,
      description: this.description(doc, ctx.partnerName),
    };

    switch (doc.kind) {
      case 'receipt': {
        // 구매로 넘어간 입고는 구매 전표가 대신한다
        if (await this.hasActiveChild(tx, doc.id, 'purchase')) return null;
        const supply = sum((l) => l.supply);
        if (supply === 0) return null;
        return {
          ...base,
          type: 'general',
          vat: null,
          lines: [
            ...byAccount((l) => [this.purchaseAccount(l.item, account), l.supply]).map(
              ([accountId, amount]) => ({ accountId, debit: amount, credit: 0, partnerId: null }),
            ),
            { accountId: payable, debit: 0, credit: supply, partnerId: doc.partnerId },
          ],
        };
      }
      case 'purchase':
      case 'purchase_return': {
        const sign = doc.kind === 'purchase' ? 1 : -1;
        const supply = sum((l) => l.supply);
        const vat = sum((l) => l.vat);
        if (supply + vat === 0) return null;
        const goods = byAccount((l) => [this.purchaseAccount(l.item, account), l.supply]);
        const debitSide: EntryLine[] = goods.map(([accountId, amount]) => ({
          accountId,
          debit: amount,
          credit: 0,
          partnerId: null,
        }));
        if (vat > 0) {
          debitSide.push({
            accountId: account(SYSTEM_ACCOUNTS.vatPaid),
            debit: vat,
            credit: 0,
            partnerId: null,
          });
        }
        const creditSide: EntryLine = {
          accountId: payable,
          debit: 0,
          credit: supply + vat,
          partnerId: doc.partnerId,
        };
        const flip = (l: EntryLine): EntryLine => ({ ...l, debit: l.credit, credit: l.debit });
        return {
          ...base,
          type: 'purchase',
          vat: {
            vatType: this.vatType(lines),
            evidenceType: this.evidence(doc, lines),
            supplyAmount: sign * supply,
            vatAmount: sign * vat,
            deductible: true,
            partnerId: doc.partnerId,
          },
          lines: sign > 0 ? [...debitSide, creditSide] : [flip(creditSide), ...debitSide.map(flip)],
        };
      }
      default:
        return null;
    }
  }

  /** 매출원가·재고조정 전표(판매 쪽은 다음 단계에서 채운다) */
  private async costEntry(
    _tx: Transaction,
    _doc: Doc,
    _ctx: NonNullable<Awaited<ReturnType<TradePostingService['context']>>>,
  ): Promise<DesiredEntry | null> {
    return null;
  }

  private async hasActiveChild(tx: Transaction, docId: string, kind: Doc['kind']) {
    const [child] = await tx
      .select({ id: tradeDocs.id })
      .from(tradeDocs)
      .where(
        and(
          eq(tradeDocs.sourceDocId, docId),
          eq(tradeDocs.kind, kind),
          ne(tradeDocs.status, 'cancelled'),
        ),
      )
      .limit(1);
    return !!child;
  }

  // ── 맞추기 ───────────────────────────────────────────

  private async reconcile(
    tx: Transaction,
    doc: Doc,
    existingId: string | null,
    desired: DesiredEntry | null,
    field: 'entryId' | 'costEntryId',
  ): Promise<string | null> {
    if (existingId) {
      if (desired && (await this.sameAs(tx, existingId, desired))) return existingId;
      // 문서가 전표를 가리키면 지울 수 없으므로 먼저 연결을 끊는다
      await tx
        .update(tradeDocs)
        .set({ [field]: null })
        .where(eq(tradeDocs.id, doc.id));
      await this.retire(tx, existingId, doc);
    }
    if (!desired) return null;
    return this.journals.createIn(
      tx,
      {
        entry: { ...desired, lines: desired.lines.map((l) => ({ ...l })) } as JournalEntryInput,
        status: await this.journals.postStatusIn(tx),
      },
      { source: 'trade', sourceRef: doc.id },
    );
  }

  /** 전기한 전표는 역분개, 아직 전기 전이면 지운다. */
  private async retire(tx: Transaction, entryId: string, doc: Doc) {
    const [entry] = await tx
      .select({ status: journalEntries.status, entryDate: journalEntries.entryDate })
      .from(journalEntries)
      .where(eq(journalEntries.id, entryId));
    if (!entry || entry.status === 'reversed') return;
    if (entry.status === 'posted') {
      await this.journals.reverseIn(
        tx,
        entryId,
        {
          entryDate: doc.docDate > entry.entryDate ? doc.docDate : entry.entryDate,
          description: `[${TRADE_DOC_KIND_LABELS[doc.kind]} 정정] ${doc.docNo}`,
        },
        { system: true },
      );
    } else {
      await this.journals.discardIn(tx, entryId);
    }
  }

  /** 연결된 전표가 있어야 할 전표와 같은가(날짜·유형·부가세·줄) */
  private async sameAs(tx: Transaction, entryId: string, desired: DesiredEntry) {
    const [entry] = await tx.select().from(journalEntries).where(eq(journalEntries.id, entryId));
    if (!entry || entry.status === 'reversed') return false;
    if (entry.entryDate !== desired.entryDate || entry.type !== desired.type) return false;
    const vat = desired.vat ?? null;
    if ((entry.vatType ?? null) !== (vat?.vatType ?? null)) return false;
    if (vat) {
      if (
        entry.evidenceType !== vat.evidenceType ||
        entry.supplyAmount !== vat.supplyAmount ||
        entry.vatAmount !== vat.vatAmount ||
        (entry.vatPartnerId ?? null) !== (vat.partnerId ?? null)
      ) {
        return false;
      }
    }
    const rows = await tx
      .select({
        accountId: journalLines.accountId,
        debit: journalLines.debit,
        credit: journalLines.credit,
        partnerId: journalLines.partnerId,
      })
      .from(journalLines)
      .where(eq(journalLines.entryId, entryId));
    const a = rows.map(lineKey).sort();
    const b = desired.lines.map(lineKey).sort();
    return a.length === b.length && a.every((k, i) => k === b[i]);
  }

  /** 재고 품목의 이동 금액 합계(원가 전표용) */
  async moveAmountsIn(tx: Transaction, docId: string) {
    const rows = await tx
      .select({ docLineId: stockMoves.docLineId, amount: stockMoves.amount })
      .from(stockMoves)
      .where(eq(stockMoves.docId, docId));
    const map = new Map<string, number>();
    for (const r of rows)
      if (r.docLineId) map.set(r.docLineId, (map.get(r.docLineId) ?? 0) + r.amount);
    return map;
  }

  /** 품목들이 재고 품목인지 */
  async stockItemIdsIn(tx: Transaction, itemIds: string[]) {
    if (itemIds.length === 0) return new Set<string>();
    const rows = await tx
      .select({ id: items.id, kind: items.kind })
      .from(items)
      .where(inArray(items.id, itemIds));
    return new Set(rows.filter((r) => isStockItem(r.kind)).map((r) => r.id));
  }
}
