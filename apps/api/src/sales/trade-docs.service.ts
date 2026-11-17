import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  fromMilli,
  lineSupply,
  MoneyError,
  toMilli,
  vatFromSupply,
} from '@wellbuddy/accounting-core';
import {
  items,
  journalEntries,
  partners,
  stockMoves,
  taxInvoiceIssues,
  taxInvoices,
  tradeDocLines,
  tradeDocs,
  type Transaction,
  users,
  warehouses,
} from '@wellbuddy/db';
import {
  ENABLED_TRADE_DOC_KINDS,
  FULL_CONVERSIONS,
  formatJournalNo,
  isOrderKind,
  isStockItem,
  PURCHASE_DOC_KINDS,
  SALES_DOC_KINDS,
  type StockCountInput,
  TRADE_DOC_KIND_LABELS,
  TRADE_DOC_PREFIXES,
  TRADE_DOC_SOURCES,
  type TradeDocInput,
  type TradeDocKind,
  type TradeDocStatus,
} from '@wellbuddy/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  like,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service.js';
import { isForeignKeyViolation, isUniqueViolation } from '../common/db-errors.js';
import { AppException } from '../common/errors.js';
import { requireCompanyContext } from '../common/request-context.js';
import { DbService } from '../db/db.service.js';
import { InventoryService } from './inventory.service.js';
import { ItemsService } from './items.service.js';
import { matchTradeInvoicesIn, unlinkDocIn } from './trade-invoices.js';
import { TradePostingService } from './trade-posting.service.js';
import { WarehousesService } from './warehouses.service.js';

type Doc = typeof tradeDocs.$inferSelect;
type LineRow = typeof tradeDocLines.$inferSelect;
type Item = typeof items.$inferSelect;

/** 재고 품목만 담을 수 있는 문서 */
const STOCK_ONLY_KINDS: readonly TradeDocKind[] = [
  'receipt',
  'shipment',
  'transfer',
  'adjustment',
  'opening',
];

const needsPartner = (kind: TradeDocKind) =>
  (SALES_DOC_KINDS as readonly string[]).includes(kind) ||
  (PURCHASE_DOC_KINDS as readonly string[]).includes(kind);

const qtyText = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 3 });

/** 세금계산서와 짝지을 수 있는 문서(매출·매입) */
const INVOICE_KINDS: readonly TradeDocKind[] = [
  'sale',
  'sales_return',
  'purchase',
  'purchase_return',
];

export interface TradeDocListQuery {
  kinds?: TradeDocKind[];
  from?: string;
  to?: string;
  partnerId?: string;
  status?: TradeDocStatus;
  q?: string;
  limit: number;
  offset: number;
}

/**
 * 거래 문서(견적·주문·발주·입고·구매·반품 …): 작성(앞 문서에서 전환)·취소·조회.
 * 확정 문서는 재고 이동과 전표를 만들고, 고치지 않고 취소한 뒤 다시 입력한다.
 */
@Injectable()
export class TradeDocsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly itemsService: ItemsService,
    private readonly warehousesService: WarehousesService,
    private readonly inventory: InventoryService,
    private readonly posting: TradePostingService,
  ) {}

  // ── 조회 ─────────────────────────────────────────────

  async list(query: TradeDocListQuery) {
    return this.db.tenant(async (tx) => {
      const q = query.q ? `%${query.q}%` : undefined;
      const where = and(
        query.kinds?.length ? inArray(tradeDocs.kind, query.kinds) : undefined,
        query.from ? gte(tradeDocs.docDate, query.from) : undefined,
        query.to ? lte(tradeDocs.docDate, query.to) : undefined,
        query.partnerId ? eq(tradeDocs.partnerId, query.partnerId) : undefined,
        query.status ? eq(tradeDocs.status, query.status) : undefined,
        q
          ? or(ilike(tradeDocs.docNo, q), ilike(partners.name, q), ilike(tradeDocs.memo, q))
          : undefined,
      );
      const [total] = await tx
        .select({ n: count() })
        .from(tradeDocs)
        .leftJoin(partners, eq(partners.id, tradeDocs.partnerId))
        .where(where);
      const source = alias(tradeDocs, 'source_doc');
      const rows = await tx
        .select({
          doc: tradeDocs,
          partnerName: partners.name,
          warehouseName: warehouses.name,
          sourceDocNo: source.docNo,
        })
        .from(tradeDocs)
        .leftJoin(partners, eq(partners.id, tradeDocs.partnerId))
        .leftJoin(warehouses, eq(warehouses.id, tradeDocs.warehouseId))
        .leftJoin(source, eq(source.id, tradeDocs.sourceDocId))
        .where(where)
        .orderBy(desc(tradeDocs.docDate), desc(tradeDocs.docNo))
        .limit(query.limit)
        .offset(query.offset);
      return {
        items: rows.map((r) => ({
          ...this.header(r.doc),
          partnerName: r.partnerName,
          warehouseName: r.warehouseName,
          sourceDocNo: r.sourceDocNo,
        })),
        total: total!.n,
      };
    });
  }

  get(id: string) {
    return this.db.tenant((tx) => this.getIn(tx, id));
  }

  private async getIn(tx: Transaction, id: string) {
    const source = alias(tradeDocs, 'source_doc');
    const toWarehouse = alias(warehouses, 'to_warehouse');
    const [row] = await tx
      .select({
        doc: tradeDocs,
        partnerName: partners.name,
        partnerBizRegNo: partners.bizRegNo,
        warehouseName: warehouses.name,
        toWarehouseName: toWarehouse.name,
        source: { id: source.id, kind: source.kind, docNo: source.docNo },
        createdByName: users.name,
      })
      .from(tradeDocs)
      .leftJoin(partners, eq(partners.id, tradeDocs.partnerId))
      .leftJoin(warehouses, eq(warehouses.id, tradeDocs.warehouseId))
      .leftJoin(toWarehouse, eq(toWarehouse.id, tradeDocs.toWarehouseId))
      .leftJoin(source, eq(source.id, tradeDocs.sourceDocId))
      .leftJoin(users, eq(users.id, tradeDocs.createdBy))
      .where(eq(tradeDocs.id, id));
    if (!row) throw new NotFoundException();
    const doc = row.doc;

    const lineRows = await tx
      .select({ line: tradeDocLines, itemCode: items.code, warehouseName: warehouses.name })
      .from(tradeDocLines)
      .innerJoin(items, eq(items.id, tradeDocLines.itemId))
      .leftJoin(warehouses, eq(warehouses.id, tradeDocLines.warehouseId))
      .where(eq(tradeDocLines.docId, id))
      .orderBy(asc(tradeDocLines.lineNo));
    const processed = await this.processedQtyIn(
      tx,
      lineRows.map((l) => l.line.id),
    );

    const children = await tx
      .select({
        id: tradeDocs.id,
        kind: tradeDocs.kind,
        docNo: tradeDocs.docNo,
        docDate: tradeDocs.docDate,
        status: tradeDocs.status,
        total: tradeDocs.total,
      })
      .from(tradeDocs)
      .where(eq(tradeDocs.sourceDocId, id))
      .orderBy(asc(tradeDocs.docDate), asc(tradeDocs.docNo));

    const entryIds = [doc.entryId, doc.costEntryId].filter((x): x is string => !!x);
    const entries = entryIds.length
      ? await tx
          .select({
            id: journalEntries.id,
            entryDate: journalEntries.entryDate,
            entryNo: journalEntries.entryNo,
            status: journalEntries.status,
          })
          .from(journalEntries)
          .where(inArray(journalEntries.id, entryIds))
      : [];
    const entryDto = (entryId: string | null) => {
      const e = entries.find((x) => x.id === entryId);
      return e
        ? { id: e.id, number: formatJournalNo(e.entryDate, e.entryNo), status: e.status }
        : null;
    };

    return {
      ...this.header(doc),
      taxInvoice: await this.taxInvoiceIn(tx, doc),
      partnerName: row.partnerName,
      partnerBizRegNo: row.partnerBizRegNo,
      warehouseName: row.warehouseName,
      toWarehouseName: row.toWarehouseName,
      sourceDoc: row.source?.id ? row.source : null,
      createdByName: row.createdByName,
      cancelReason: doc.cancelReason,
      cancelledAt: doc.cancelledAt?.toISOString() ?? null,
      entry: entryDto(doc.entryId),
      costEntry: entryDto(doc.costEntryId),
      lines: lineRows.map(({ line, itemCode, warehouseName }) => {
        const done = processed.get(line.id) ?? 0;
        return {
          id: line.id,
          lineNo: line.lineNo,
          itemId: line.itemId,
          itemCode,
          itemName: line.itemName,
          spec: line.spec,
          unit: line.unit,
          qty: line.qty,
          unitPrice: line.unitPrice,
          supply: line.supply,
          vat: line.vat,
          warehouseId: line.warehouseId,
          warehouseName,
          sourceLineId: line.sourceLineId,
          lotNo: line.lotNo,
          memo: line.memo,
          /** 다음 단계 문서(출고·입고·판매·구매·반품)로 넘어간 수량 */
          processedQty: done,
          remainingQty: Math.max(0, Math.round((line.qty - done) * 1000) / 1000),
        };
      }),
      children,
    };
  }

  /** 이 판매에서 발행한 계산서(진행 중) 또는 자동으로 짝지은 수집 계산서 */
  private async taxInvoiceIn(tx: Transaction, doc: Doc) {
    const sharedWith = async () => {
      if (!doc.taxInvoiceId) return 0;
      const [row] = await tx
        .select({ n: count() })
        .from(tradeDocs)
        .where(and(eq(tradeDocs.taxInvoiceId, doc.taxInvoiceId), ne(tradeDocs.id, doc.id)));
      return row?.n ?? 0;
    };
    const [issue] = await tx
      .select()
      .from(taxInvoiceIssues)
      .where(
        and(eq(taxInvoiceIssues.tradeDocId, doc.id), ne(taxInvoiceIssues.status, 'cancelled')),
      );
    if (issue) {
      return {
        evidenceId: issue.taxInvoiceId,
        issueId: issue.id,
        status: issue.status as 'issued' | 'sent' | 'failed',
        approvalNo: issue.approvalNo,
        issueDate: issue.issueDate,
        totalAmount: issue.totalAmount,
        sharedWith: 0,
      };
    }
    if (!doc.taxInvoiceId) return null;
    const [inv] = await tx.select().from(taxInvoices).where(eq(taxInvoices.id, doc.taxInvoiceId));
    if (!inv) return null;
    return {
      evidenceId: inv.id,
      issueId: null,
      status: 'collected' as const,
      approvalNo: inv.approvalNo,
      issueDate: inv.issueDate,
      totalAmount: inv.totalAmount,
      sharedWith: await sharedWith(),
    };
  }

  private header(doc: Doc) {
    return {
      id: doc.id,
      kind: doc.kind,
      kindLabel: TRADE_DOC_KIND_LABELS[doc.kind],
      docNo: doc.docNo,
      docDate: doc.docDate,
      partnerId: doc.partnerId,
      warehouseId: doc.warehouseId,
      toWarehouseId: doc.toWarehouseId,
      sourceDocId: doc.sourceDocId,
      status: doc.status,
      evidenceType: doc.evidenceType,
      supplyTotal: doc.supplyTotal,
      vatTotal: doc.vatTotal,
      total: doc.total,
      dueDate: doc.dueDate,
      memo: doc.memo,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  /** 줄마다 다음 단계 문서(취소 안 된 것)로 넘어간 수량 */
  private async processedQtyIn(tx: Transaction, lineIds: string[]) {
    const map = new Map<string, number>();
    if (lineIds.length === 0) return map;
    const rows = await tx
      .select({ sourceLineId: tradeDocLines.sourceLineId, qty: tradeDocLines.qty })
      .from(tradeDocLines)
      .innerJoin(tradeDocs, eq(tradeDocs.id, tradeDocLines.docId))
      .where(and(inArray(tradeDocLines.sourceLineId, lineIds), ne(tradeDocs.status, 'cancelled')));
    for (const r of rows) {
      const key = r.sourceLineId!;
      map.set(key, Math.round(((map.get(key) ?? 0) + r.qty) * 1000) / 1000);
    }
    return map;
  }

  // ── 작성 ─────────────────────────────────────────────

  /** internal: 재고 실사가 만드는 재고 조정(줄 수량이 음수일 수 있다) */
  async create(input: TradeDocInput, options: { internal?: boolean } = {}) {
    const { companyId, userId } = requireCompanyContext();
    if (input.kind === 'adjustment' && !options.internal) {
      throw new AppException('USE_STOCK_COUNT', '재고 조정은 재고 실사에서 입력해 주세요.');
    }
    if (!ENABLED_TRADE_DOC_KINDS.includes(input.kind) && !options.internal) {
      throw new AppException(
        'KIND_NOT_READY',
        `${TRADE_DOC_KIND_LABELS[input.kind]}는 아직 입력할 수 없습니다.`,
      );
    }
    if (input.kind === 'transfer' && !input.toWarehouseId) {
      throw new AppException('TO_WAREHOUSE_REQUIRED', '받는 창고를 선택해 주세요.');
    }
    try {
      const id = await this.db.tenant(async (tx) => {
        const kind = input.kind;
        if (needsPartner(kind) && !input.partnerId) {
          throw new AppException('PARTNER_REQUIRED', '거래처를 선택해 주세요.');
        }

        await this.checkReferences(tx, input);

        // 앞 단계 문서
        const source = input.sourceDocId ? await this.loadSource(tx, input) : null;
        const sourceLines = source
          ? await tx.select().from(tradeDocLines).where(eq(tradeDocLines.docId, source.id))
          : [];
        const sourceLineById = new Map(sourceLines.map((l) => [l.id, l]));

        // 품목
        const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
        const itemRows = await tx.select().from(items).where(inArray(items.id, itemIds));
        const itemById = new Map(itemRows.map((i) => [i.id, i]));
        for (const [i, line] of input.lines.entries()) {
          const item = itemById.get(line.itemId);
          if (!item) throw new AppException('ITEM_NOT_FOUND', `${i + 1}행: 없는 품목입니다.`);
          if (!item.isActive && !line.sourceLineId) {
            throw new AppException(
              'ITEM_INACTIVE',
              `${i + 1}행: '${item.name}'은(는) 사용중지된 품목입니다.`,
            );
          }
          if (STOCK_ONLY_KINDS.includes(kind) && !isStockItem(item.kind)) {
            throw new AppException(
              'SERVICE_ITEM_NOT_ALLOWED',
              `${i + 1}행: 서비스 품목('${item.name}')은 재고가 없어 ${TRADE_DOC_KIND_LABELS[kind]}에 넣을 수 없습니다.`,
            );
          }
        }
        if (needsPartner(kind) && new Set(itemRows.map((i) => i.vatType)).size > 1) {
          throw new AppException(
            'MIXED_VAT_TYPES',
            '과세·면세·영세 품목은 세금계산서·계산서가 달라 문서를 나눠 입력해 주세요.',
          );
        }

        this.checkSourceLines(kind, input, source, sourceLines, sourceLineById, itemById);
        if (source && FULL_CONVERSIONS[kind] !== source.kind && sourceLines.length > 0) {
          await this.checkRemaining(tx, kind, input, sourceLineById, itemById);
        }

        // 창고·단가·금액
        const warehouseId =
          input.warehouseId ??
          source?.warehouseId ??
          (await this.warehousesService.ensureDefaultIn(tx)).id;
        if (kind === 'transfer' && input.toWarehouseId === warehouseId) {
          throw new AppException('SAME_WAREHOUSE', '보내는 창고와 받는 창고가 같습니다.');
        }
        // 창고 이동·재고 조정은 금액을 정하지 않는다(원가는 이동평균이 정한다)
        const valued = kind !== 'transfer' && kind !== 'adjustment';
        const side = (SALES_DOC_KINDS as readonly string[]).includes(kind) ? 'sales' : 'purchase';
        const prices = await this.itemsService.pricesIn(tx, side, itemIds, input.partnerId);
        const lines = input.lines.map((l, i) => {
          const item = itemById.get(l.itemId)!;
          const fromSource = l.sourceLineId ? sourceLineById.get(l.sourceLineId) : undefined;
          const unitPrice = valued
            ? (l.unitPrice ?? fromSource?.unitPrice ?? prices.get(l.itemId)?.unitPrice ?? 0)
            : 0;
          let supply = 0;
          try {
            if (valued) supply = lineSupply(l.qty, unitPrice);
          } catch (e) {
            if (e instanceof MoneyError)
              throw new AppException('AMOUNT_INVALID', `${i + 1}행: ${e.message}`);
            throw e;
          }
          const vat = needsPartner(kind) ? vatFromSupply(supply, item.vatType).vat : 0;
          return {
            lineNo: i + 1,
            item,
            qty: l.qty,
            unitPrice,
            supply,
            vat,
            warehouseId:
              kind === 'transfer'
                ? warehouseId
                : (l.warehouseId ?? fromSource?.warehouseId ?? warehouseId),
            sourceLineId: l.sourceLineId ?? null,
            // 반품·전환은 앞 문서 줄의 LOT·시리얼을 그대로 쓴다
            lotNo: l.lotNo ?? fromSource?.lotNo ?? null,
            memo: l.memo ?? null,
          };
        });
        if (this.movesStock(kind, source)) {
          for (const l of lines) {
            if (!l.item.trackLot && !l.item.trackSerial) continue;
            const what = l.item.trackSerial ? '시리얼' : 'LOT';
            if (!l.lotNo) {
              throw new AppException(
                'LOT_REQUIRED',
                `${l.lineNo}행: '${l.item.name}'은(는) ${what} 번호를 입력해 주세요.`,
              );
            }
            if (l.item.trackSerial && Math.abs(l.qty) !== 1) {
              throw new AppException(
                'SERIAL_QTY',
                `${l.lineNo}행: 시리얼 관리 품목('${l.item.name}')은 한 줄에 1개씩 입력합니다.`,
              );
            }
          }
        }
        const supplyTotal = lines.reduce((s, l) => s + l.supply, 0);
        const vatTotal = lines.reduce((s, l) => s + l.vat, 0);

        const [doc] = await tx
          .insert(tradeDocs)
          .values({
            companyId,
            kind,
            docNo: await this.nextDocNo(tx, kind, input.docDate),
            docDate: input.docDate,
            partnerId: input.partnerId ?? null,
            warehouseId,
            toWarehouseId: kind === 'transfer' ? (input.toWarehouseId ?? null) : null,
            sourceDocId: source?.id ?? null,
            status: isOrderKind(kind) ? 'open' : 'posted',
            evidenceType: needsPartner(kind) ? (input.evidenceType ?? null) : null,
            supplyTotal,
            vatTotal,
            total: supplyTotal + vatTotal,
            dueDate: input.dueDate ?? null,
            memo: input.memo ?? null,
            createdBy: userId,
          })
          .returning();
        const inserted = await tx
          .insert(tradeDocLines)
          .values(
            lines.map((l) => ({
              companyId,
              docId: doc!.id,
              lineNo: l.lineNo,
              itemId: l.item.id,
              itemName: l.item.name,
              spec: l.item.spec,
              unit: l.item.unit,
              qty: l.qty,
              unitPrice: l.unitPrice,
              supply: l.supply,
              vat: l.vat,
              warehouseId: l.warehouseId,
              sourceLineId: l.sourceLineId,
              lotNo: l.lotNo,
              memo: l.memo,
            })),
          )
          .returning();

        // 재고 이동 → 재원가 → 전표
        const touched = new Set<string>();
        await this.insertMoves(tx, doc!, inserted, itemById, source);
        for (const l of inserted) touched.add(l.itemId);
        if (source && kind === 'purchase' && source.kind === 'receipt') {
          await this.syncConvertedAmounts(tx, source.id);
          for (const l of sourceLines) touched.add(l.itemId);
        }
        await this.settle(tx, [...touched], [doc!.id, ...(source ? [source.id] : [])]);
        if (source) await this.refreshOrderStatus(tx, source.id);
        // 문서보다 먼저 수집돼 기다리던 세금계산서와 짝짓는다(이중 분개 방지)
        if (INVOICE_KINDS.includes(kind)) await matchTradeInvoicesIn(tx, { docIds: [doc!.id] });

        await this.audit.record(
          {
            action: 'trade_doc.create',
            entity: 'trade_doc',
            entityId: doc!.id,
            after: { kind, docNo: doc!.docNo, total: doc!.total, sourceDocId: source?.id ?? null },
          },
          tx,
        );
        return doc!.id;
      });
      return this.get(id);
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw new AppException(
          'REFERENCE_NOT_FOUND',
          '연결한 거래처·창고·품목을 찾을 수 없습니다.',
        );
      }
      if (isUniqueViolation(e)) {
        throw new AppException(
          'DOC_NO_CONFLICT',
          '같은 번호의 문서를 동시에 만들었습니다. 다시 저장해 주세요.',
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }
  }

  /** 이 문서가 스스로 재고를 움직이는가(입고 → 구매, 출고 → 판매 전환은 앞 문서가 움직였다) */
  private movesStock(kind: TradeDocKind, source: Doc | null) {
    if (kind === 'purchase') return source?.kind !== 'receipt';
    if (kind === 'sale') return source?.kind !== 'shipment';
    return [
      'receipt',
      'purchase_return',
      'shipment',
      'sales_return',
      'opening',
      'transfer',
      'adjustment',
    ].includes(kind);
  }

  /** 거래처·창고가 이 회사 것인지(다른 회사 것은 보이지 않는다) */
  private async checkReferences(tx: Transaction, input: TradeDocInput) {
    if (input.partnerId) {
      const [p] = await tx
        .select({ id: partners.id })
        .from(partners)
        .where(eq(partners.id, input.partnerId));
      if (!p) throw new AppException('REFERENCE_NOT_FOUND', '거래처를 찾을 수 없습니다.');
    }
    const whIds = [
      input.warehouseId,
      input.toWarehouseId,
      ...input.lines.map((l) => l.warehouseId),
    ].filter((x): x is string => !!x);
    if (whIds.length) {
      const found = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(inArray(warehouses.id, [...new Set(whIds)]));
      if (found.length !== new Set(whIds).size) {
        throw new AppException('REFERENCE_NOT_FOUND', '창고를 찾을 수 없습니다.');
      }
    }
  }

  private async loadSource(tx: Transaction, input: TradeDocInput): Promise<Doc> {
    const [source] = await tx
      .select()
      .from(tradeDocs)
      .where(eq(tradeDocs.id, input.sourceDocId!))
      .for('update');
    if (!source) throw new AppException('SOURCE_NOT_FOUND', '앞 단계 문서를 찾을 수 없습니다.');
    const allowed = TRADE_DOC_SOURCES[input.kind] ?? [];
    if (!allowed.includes(source.kind)) {
      throw new AppException(
        'SOURCE_KIND_INVALID',
        `${TRADE_DOC_KIND_LABELS[source.kind]}에서 ${TRADE_DOC_KIND_LABELS[input.kind]}를 만들 수 없습니다.`,
      );
    }
    if (source.status === 'cancelled') {
      throw new AppException('SOURCE_CANCELLED', '취소된 문서에서는 만들 수 없습니다.');
    }
    if (source.partnerId && input.partnerId && source.partnerId !== input.partnerId) {
      throw new AppException('SOURCE_PARTNER_MISMATCH', '앞 단계 문서와 거래처가 다릅니다.');
    }
    if (input.docDate < source.docDate) {
      throw new AppException(
        'SOURCE_DATE_INVALID',
        `앞 단계 문서(${source.docDate})보다 이른 날짜로 만들 수 없습니다.`,
      );
    }
    const full = FULL_CONVERSIONS[input.kind] === source.kind;
    if (full) {
      const [child] = await tx
        .select({ docNo: tradeDocs.docNo })
        .from(tradeDocs)
        .where(
          and(
            eq(tradeDocs.sourceDocId, source.id),
            eq(tradeDocs.kind, input.kind),
            ne(tradeDocs.status, 'cancelled'),
          ),
        );
      if (child) {
        throw new AppException(
          'ALREADY_CONVERTED',
          `이미 ${TRADE_DOC_KIND_LABELS[input.kind]}(${child.docNo})로 넘어간 문서입니다.`,
          HttpStatus.CONFLICT,
        );
      }
    }
    return source;
  }

  /** 줄의 앞 문서 줄이 맞는지, 그대로 옮기는 전환이면 모든 줄을 같은 수량으로 옮겼는지 */
  private checkSourceLines(
    kind: TradeDocKind,
    input: TradeDocInput,
    source: Doc | null,
    sourceLines: LineRow[],
    sourceLineById: Map<string, LineRow>,
    itemById: Map<string, Item>,
  ) {
    for (const [i, line] of input.lines.entries()) {
      if (!line.sourceLineId) continue;
      const src = sourceLineById.get(line.sourceLineId);
      if (!source || !src) {
        throw new AppException('SOURCE_LINE_INVALID', `${i + 1}행: 앞 단계 문서의 줄이 아닙니다.`);
      }
      if (src.itemId !== line.itemId) {
        throw new AppException(
          'SOURCE_LINE_INVALID',
          `${i + 1}행: 앞 단계 문서와 품목이 다릅니다(${itemById.get(line.itemId)?.name}).`,
        );
      }
    }
    if (source && FULL_CONVERSIONS[kind] === source.kind) {
      const used = input.lines.map((l) => l.sourceLineId);
      const exact =
        used.length === sourceLines.length &&
        sourceLines.every((s) => {
          const l = input.lines.find((x) => x.sourceLineId === s.id);
          return l && Math.round(l.qty * 1000) === Math.round(s.qty * 1000);
        });
      if (!exact) {
        throw new AppException(
          'CONVERSION_MISMATCH',
          `${TRADE_DOC_KIND_LABELS[source.kind]}의 모든 줄을 같은 수량으로 옮겨야 합니다(단가만 고칠 수 있습니다).`,
        );
      }
    }
  }

  /** 주문·발주·구매에서 나눠 넘길 때 남은 수량을 넘지 않는지 */
  private async checkRemaining(
    tx: Transaction,
    kind: TradeDocKind,
    input: TradeDocInput,
    sourceLineById: Map<string, LineRow>,
    itemById: Map<string, Item>,
  ) {
    const processed = await this.processedQtyIn(tx, [...sourceLineById.keys()]);
    const asking = new Map<string, number>();
    for (const l of input.lines) {
      if (!l.sourceLineId) continue;
      asking.set(l.sourceLineId, (asking.get(l.sourceLineId) ?? 0) + Math.round(l.qty * 1000));
    }
    for (const [lineId, milli] of asking) {
      const src = sourceLineById.get(lineId)!;
      const remaining =
        Math.round(src.qty * 1000) - Math.round((processed.get(lineId) ?? 0) * 1000);
      if (milli > remaining) {
        const name = itemById.get(src.itemId)?.name ?? src.itemName;
        const verb = kind.endsWith('_return') ? '반품할 수 있는' : '남은';
        throw new AppException(
          'QTY_EXCEEDS_REMAINING',
          `'${name}' ${verb} 수량은 ${qtyText(Math.max(0, remaining) / 1000)}${src.unit}입니다.`,
        );
      }
    }
  }

  /** 문서 종류별 재고 이동(재고 품목만). 금액이 정해진 이동은 공급가액을 쓴다. */
  private async insertMoves(
    tx: Transaction,
    doc: Doc,
    lines: LineRow[],
    itemById: Map<string, Item>,
    source: Doc | null,
  ) {
    const { companyId } = requireCompanyContext();
    // 금액이 정해진 이동(입고·구매·구매반품)과 이동평균으로 정하는 이동(출고·판매·판매반품)
    if (doc.kind === 'transfer') {
      // 창고 이동: 보내는 창고에서 빼고 받는 창고에 넣는다. 품목 원가(회사 전체 이동평균)는 그대로
      const rows = lines.flatMap((l) =>
        [
          { warehouseId: doc.warehouseId!, qty: -l.qty },
          { warehouseId: doc.toWarehouseId!, qty: l.qty },
        ].map((m) => ({
          companyId,
          itemId: l.itemId,
          warehouseId: m.warehouseId,
          moveDate: doc.docDate,
          qty: m.qty,
          amount: 0,
          costing: 'none' as const,
          docId: doc.id,
          docLineId: l.id,
          lotNo: l.lotNo,
        })),
      );
      if (rows.length) await tx.insert(stockMoves).values(rows);
      return;
    }
    const plan: Record<string, { sign: 1 | -1; costing: 'fixed' | 'average' } | null> = {
      receipt: { sign: 1, costing: 'fixed' },
      purchase: source?.kind === 'receipt' ? null : { sign: 1, costing: 'fixed' },
      purchase_return: { sign: -1, costing: 'fixed' },
      shipment: { sign: -1, costing: 'average' },
      sale: source?.kind === 'shipment' ? null : { sign: -1, costing: 'average' },
      sales_return: { sign: 1, costing: 'average' },
      opening: { sign: 1, costing: 'fixed' },
      // 재고 조정 줄은 수량에 부호가 있다(늘면 +, 줄면 -)
      adjustment: { sign: 1, costing: 'average' },
    };
    const rule = plan[doc.kind];
    if (!rule) return;
    const rows = lines
      .filter((l) => isStockItem(itemById.get(l.itemId)!.kind))
      .map((l) => ({
        companyId,
        itemId: l.itemId,
        warehouseId: l.warehouseId ?? doc.warehouseId!,
        moveDate: doc.docDate,
        qty: rule.sign * l.qty,
        amount: rule.costing === 'fixed' ? rule.sign * l.supply : 0,
        costing: rule.costing,
        docId: doc.id,
        docLineId: l.id,
        lotNo: l.lotNo,
      }));
    if (rows.length) await tx.insert(stockMoves).values(rows);
  }

  /**
   * 입고 → 구매처럼 줄을 그대로 옮긴 경우, 앞 문서의 재고 금액을 뒤 문서(취소 안 된 것)의 공급가액으로 맞춘다.
   * 뒤 문서가 없으면(취소) 앞 문서 자신의 공급가액으로 되돌린다.
   */
  private async syncConvertedAmounts(tx: Transaction, sourceId: string) {
    const sourceLines = await tx
      .select()
      .from(tradeDocLines)
      .where(eq(tradeDocLines.docId, sourceId));
    const childLines = await tx
      .select({ sourceLineId: tradeDocLines.sourceLineId, supply: tradeDocLines.supply })
      .from(tradeDocLines)
      .innerJoin(tradeDocs, eq(tradeDocs.id, tradeDocLines.docId))
      .where(
        and(
          inArray(
            tradeDocLines.sourceLineId,
            sourceLines.map((l) => l.id),
          ),
          eq(tradeDocs.kind, 'purchase'),
          ne(tradeDocs.status, 'cancelled'),
        ),
      );
    const childSupply = new Map(childLines.map((c) => [c.sourceLineId!, c.supply]));
    for (const line of sourceLines) {
      const amount = childSupply.get(line.id) ?? line.supply;
      await tx
        .update(stockMoves)
        .set({ amount })
        .where(and(eq(stockMoves.docLineId, line.id), eq(stockMoves.costing, 'fixed')));
    }
  }

  /** 재원가(재고 부족이면 거부) 뒤 관련 문서들의 전표를 맞춘다. */
  private async settle(tx: Transaction, itemIds: string[], docIds: string[]) {
    const changed = await this.inventory.recostIn(tx, itemIds);
    for (const id of new Set([...docIds, ...changed])) await this.posting.syncIn(tx, id);
  }

  /** 견적·주문·발주: 모든 줄이 다음 단계로 넘어가면 완료, 아니면 진행 중 */
  private async refreshOrderStatus(tx: Transaction, docId: string) {
    const [doc] = await tx.select().from(tradeDocs).where(eq(tradeDocs.id, docId));
    if (!doc || !isOrderKind(doc.kind) || doc.status === 'cancelled') return;
    const lines = await tx.select().from(tradeDocLines).where(eq(tradeDocLines.docId, docId));
    const processed = await this.processedQtyIn(
      tx,
      lines.map((l) => l.id),
    );
    const done = lines.every(
      (l) => Math.round((processed.get(l.id) ?? 0) * 1000) >= Math.round(l.qty * 1000),
    );
    const status = done ? 'closed' : 'open';
    if (status !== doc.status) {
      await tx
        .update(tradeDocs)
        .set({ status, updatedAt: new Date() })
        .where(eq(tradeDocs.id, docId));
    }
  }

  /** 종류별 접두어-일자-순번(예: PO-20261108-001) */
  private async nextDocNo(tx: Transaction, kind: TradeDocKind, date: string) {
    const prefix = `${TRADE_DOC_PREFIXES[kind]}-${date.replaceAll('-', '')}-`;
    const [last] = await tx
      .select({ docNo: tradeDocs.docNo })
      .from(tradeDocs)
      .where(like(tradeDocs.docNo, `${prefix}%`))
      .orderBy(desc(tradeDocs.docNo))
      .limit(1);
    const next = last ? Number(last.docNo.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(next).padStart(3, '0')}`;
  }

  // ── 취소 ─────────────────────────────────────────────

  /**
   * 재고 실사(P3-11): 창고·기준일의 장부 수량과 실사 수량의 차이를 재고 조정 문서로 남긴다.
   * 줄면 이동평균 원가로 매출원가/재고자산, 늘면 그 반대 전표가 생긴다.
   */
  async stockCount(input: StockCountInput) {
    const key = (itemId: string, lotNo: string | null | undefined) => `${itemId}|${lotNo ?? ''}`;
    const keys = input.counts.map((c) => key(c.itemId, c.lotNo));
    if (new Set(keys).size !== keys.length) {
      throw new AppException('DUPLICATE_ITEM', '같은 품목(LOT)을 두 번 입력했습니다.');
    }
    const ids = [...new Set(input.counts.map((c) => c.itemId))];
    const lines = await this.db.tenant(async (tx) => {
      const flags = await tx
        .select({
          id: items.id,
          name: items.name,
          lot: sql<boolean>`(${items.trackLot} or ${items.trackSerial})`,
        })
        .from(items)
        .where(inArray(items.id, ids));
      for (const c of input.counts) {
        const item = flags.find((f) => f.id === c.itemId);
        if (item?.lot && !c.lotNo) {
          throw new AppException(
            'LOT_REQUIRED',
            `'${item.name}'은(는) LOT·시리얼별로 실사 수량을 넣어 주세요.`,
          );
        }
      }
      const book = await tx
        .select({
          itemId: stockMoves.itemId,
          lotNo: stockMoves.lotNo,
          qty: sql<string>`sum(${stockMoves.qty})`,
        })
        .from(stockMoves)
        .where(
          and(
            eq(stockMoves.warehouseId, input.warehouseId),
            inArray(stockMoves.itemId, ids),
            lte(stockMoves.moveDate, input.docDate),
          ),
        )
        .groupBy(stockMoves.itemId, stockMoves.lotNo);
      const lotItem = new Set(flags.filter((f) => f.lot).map((f) => f.id));
      const bookQty = new Map<string, number>();
      for (const b of book) {
        // LOT 를 쓰지 않는 품목은 LOT 와 관계없이 합친다
        const k = key(b.itemId, lotItem.has(b.itemId) ? b.lotNo : null);
        bookQty.set(k, (bookQty.get(k) ?? 0) + toMilli(Number(b.qty)));
      }
      return input.counts.flatMap((c) => {
        const lotNo = lotItem.has(c.itemId) ? (c.lotNo ?? null) : null;
        const diff = toMilli(c.countedQty) - (bookQty.get(key(c.itemId, lotNo)) ?? 0);
        return diff === 0 ? [] : [{ itemId: c.itemId, qty: fromMilli(diff), lotNo }];
      });
    });
    if (lines.length === 0) {
      throw new AppException(
        'NO_DIFFERENCE',
        '장부 수량과 실사 수량이 모두 같아 조정할 것이 없습니다.',
      );
    }
    return this.create(
      {
        kind: 'adjustment',
        docDate: input.docDate,
        warehouseId: input.warehouseId,
        partnerId: null,
        toWarehouseId: null,
        sourceDocId: null,
        evidenceType: null,
        dueDate: null,
        memo: input.memo ?? '재고 실사',
        lines: lines.map((l) => ({
          itemId: l.itemId,
          qty: l.qty,
          unitPrice: null,
          warehouseId: null,
          sourceLineId: null,
          lotNo: l.lotNo,
          memo: null,
        })),
      },
      { internal: true },
    );
  }

  async cancel(id: string, reason: string) {
    const { userId } = requireCompanyContext();
    await this.db.tenant(async (tx) => {
      const [doc] = await tx.select().from(tradeDocs).where(eq(tradeDocs.id, id)).for('update');
      if (!doc) throw new NotFoundException();
      if (doc.status === 'cancelled') {
        throw new AppException('ALREADY_CANCELLED', '이미 취소한 문서입니다.', HttpStatus.CONFLICT);
      }
      const children = await tx
        .select({ docNo: tradeDocs.docNo, kind: tradeDocs.kind })
        .from(tradeDocs)
        .where(and(eq(tradeDocs.sourceDocId, id), ne(tradeDocs.status, 'cancelled')));
      if (children.length > 0) {
        throw new AppException(
          'HAS_CHILDREN',
          `다음 단계 문서를 먼저 취소해 주세요: ${children
            .map((c) => `${TRADE_DOC_KIND_LABELS[c.kind]} ${c.docNo}`)
            .join(', ')}`,
          HttpStatus.CONFLICT,
        );
      }
      const [issued] = await tx
        .select({ mgtKey: taxInvoiceIssues.mgtKey })
        .from(taxInvoiceIssues)
        .where(and(eq(taxInvoiceIssues.tradeDocId, id), ne(taxInvoiceIssues.status, 'cancelled')));
      if (issued) {
        throw new AppException(
          'TAX_INVOICE_ISSUED',
          `발행한 전자세금계산서(${issued.mgtKey})를 먼저 취소해 주세요.`,
          HttpStatus.CONFLICT,
        );
      }
      await tx
        .update(tradeDocs)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: userId,
          cancelReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(tradeDocs.id, id));
      // 짝지은 수집 계산서는 다시 자동분개 대상으로(월합계면 남은 문서에 잇는다)
      await unlinkDocIn(tx, id);

      const moved = await tx
        .select({ itemId: stockMoves.itemId })
        .from(stockMoves)
        .where(eq(stockMoves.docId, id));
      const touched = new Set(moved.map((m) => m.itemId));
      await tx.delete(stockMoves).where(eq(stockMoves.docId, id));

      const [source] = doc.sourceDocId
        ? await tx.select().from(tradeDocs).where(eq(tradeDocs.id, doc.sourceDocId))
        : [];
      if (source && doc.kind === 'purchase' && source.kind === 'receipt') {
        await this.syncConvertedAmounts(tx, source.id);
        const sourceItems = await tx
          .select({ itemId: tradeDocLines.itemId })
          .from(tradeDocLines)
          .where(eq(tradeDocLines.docId, source.id));
        for (const l of sourceItems) touched.add(l.itemId);
      }
      try {
        await this.settle(tx, [...touched], [id, ...(source ? [source.id] : [])]);
      } catch (e) {
        if (e instanceof AppException && e.code === 'INSUFFICIENT_STOCK') {
          throw new AppException(
            'INSUFFICIENT_STOCK',
            `취소하면 재고가 모자랍니다. ${e.message}`,
            HttpStatus.CONFLICT,
            e.details,
          );
        }
        throw e;
      }
      if (source) await this.refreshOrderStatus(tx, source.id);
      await this.audit.record(
        {
          action: 'trade_doc.cancel',
          entity: 'trade_doc',
          entityId: id,
          after: { docNo: doc.docNo, reason },
        },
        tx,
      );
    });
    return this.get(id);
  }
}
