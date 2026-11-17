import type { TradeDocKind, TradeDocStatus } from '@wellbuddy/shared';

export interface TradeDocLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  spec: string | null;
  unit: string;
  qty: number;
  unitPrice: number;
  supply: number;
  vat: number;
  warehouseId: string | null;
  warehouseName: string | null;
  sourceLineId: string | null;
  lotNo: string | null;
  memo: string | null;
  processedQty: number;
  remainingQty: number;
}

export interface TradeDocSummary {
  id: string;
  kind: TradeDocKind;
  kindLabel: string;
  docNo: string;
  docDate: string;
  partnerId: string | null;
  partnerName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  sourceDocId: string | null;
  sourceDocNo?: string | null;
  status: TradeDocStatus;
  evidenceType: string | null;
  supplyTotal: number;
  vatTotal: number;
  total: number;
  dueDate: string | null;
  memo: string | null;
}

export interface TradeDoc extends TradeDocSummary {
  partnerBizRegNo: string | null;
  toWarehouseName: string | null;
  sourceDoc: { id: string; kind: TradeDocKind; docNo: string } | null;
  createdByName: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  entry: { id: string; number: string; status: string } | null;
  costEntry: { id: string; number: string; status: string } | null;
  /** 이 판매에서 발행했거나 수집해 자동으로 짝지은 세금계산서 */
  taxInvoice: {
    evidenceId: string | null;
    issueId: string | null;
    status: 'issued' | 'sent' | 'failed' | 'collected';
    approvalNo: string | null;
    issueDate: string;
    totalAmount: number;
    sharedWith: number;
  } | null;
  lines: TradeDocLine[];
  children: {
    id: string;
    kind: TradeDocKind;
    docNo: string;
    docDate: string;
    status: TradeDocStatus;
    total: number;
  }[];
}

export const STATUS_VARIANT: Record<TradeDocStatus, 'default' | 'success' | 'muted' | 'warning'> = {
  open: 'warning',
  closed: 'success',
  posted: 'default',
  cancelled: 'muted',
};

/** 수량 표시(소수 셋째 자리까지) */
export const formatQty = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 3 });

export const TRADE_DOCS_KEY = ['trade-docs'];
