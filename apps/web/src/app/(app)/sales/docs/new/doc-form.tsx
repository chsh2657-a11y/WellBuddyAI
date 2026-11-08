'use client';

import {
  formatWon,
  lineSupply,
  todayInKorea,
  type VatType,
  vatFromSupply,
} from '@wellbuddy/accounting-core';
import {
  FULL_CONVERSIONS,
  isOrderKind,
  isStockItem,
  SALES_DOC_KINDS,
  TRADE_DOC_KIND_LABELS,
  type TradeDocKind,
} from '@wellbuddy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Combobox } from '@/components/combobox';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { WonInput } from '@/components/won-input';
import { ApiError, apiFetch } from '@/lib/api';
import { formatQty, TRADE_DOCS_KEY, type TradeDoc } from '../../_lib/trade';
import type { Item } from '../../items/items-manager';
import type { Warehouse } from '../../warehouses/warehouses-manager';

interface Partner {
  id: string;
  code: string;
  name: string;
}

interface Row {
  key: number;
  itemId: string | null;
  qty: string;
  unitPrice: number;
  /** 단가를 직접 고쳤으면 거래처를 바꿔도 다시 불러오지 않는다 */
  priceTouched: boolean;
  sourceLineId: string | null;
  /** 앞 문서에서 넘길 수 있는 최대 수량 */
  maxQty: number | null;
}

const EVIDENCE_OPTIONS = [
  { value: '', label: '자동(과세 세금계산서·면세 계산서)' },
  { value: 'tax_invoice', label: '세금계산서' },
  { value: 'invoice', label: '계산서' },
  { value: 'card', label: '신용카드' },
  { value: 'cash_receipt', label: '현금영수증' },
  { value: 'none', label: '증빙 없음' },
];

let nextKey = 1;
const emptyRow = (): Row => ({
  key: nextKey++,
  itemId: null,
  qty: '1',
  unitPrice: 0,
  priceTouched: false,
  sourceLineId: null,
  maxQty: null,
});

function amounts(row: Row, item: Item | undefined) {
  const qty = Number(row.qty);
  if (!item || !(qty > 0)) return { supply: 0, vat: 0 };
  try {
    const supply = lineSupply(qty, row.unitPrice);
    return { supply, vat: vatFromSupply(supply, item.vatType as VatType).vat };
  } catch {
    return { supply: 0, vat: 0 };
  }
}

/** 거래 문서 입력(새로 또는 앞 문서에서 전환): 앞 문서를 먼저 불러온 뒤 그 값으로 양식을 연다 */
export function DocForm({ kind, sourceId }: { kind: TradeDocKind; sourceId?: string }) {
  const source = useQuery({
    queryKey: [...TRADE_DOCS_KEY, 'detail', sourceId],
    queryFn: () => apiFetch<TradeDoc>(`/trade-docs/${sourceId}`),
    enabled: !!sourceId,
  });
  if (sourceId && !source.data) {
    return (
      <p className="text-sm text-muted-foreground">
        {source.isError ? '앞 단계 문서를 불러오지 못했습니다.' : '불러오는 중…'}
      </p>
    );
  }
  return <DocFormBody kind={kind} source={source.data ?? null} />;
}

/** 앞 문서의 줄(전체 전환은 그대로, 나머지는 남은 수량만) */
function rowsFrom(source: TradeDoc, full: boolean): Row[] {
  return source.lines
    .filter((l) => full || l.remainingQty > 0)
    .map((l) => ({
      key: nextKey++,
      itemId: l.itemId,
      qty: String(full ? l.qty : l.remainingQty),
      unitPrice: l.unitPrice,
      priceTouched: true,
      sourceLineId: l.id,
      maxQty: full ? l.qty : l.remainingQty,
    }));
}

function DocFormBody({ kind, source }: { kind: TradeDocKind; source: TradeDoc | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const side = (SALES_DOC_KINDS as readonly string[]).includes(kind) ? 'sales' : 'purchase';
  const full = !!source && FULL_CONVERSIONS[kind] === source.kind;
  const [docDate, setDocDate] = useState(todayInKorea());
  const [partnerId, setPartnerId] = useState<string | null>(source?.partnerId ?? null);
  /** 비어 있으면 첫 창고 */
  const [warehouseChoice, setWarehouseChoice] = useState(source?.warehouseId ?? '');
  const [evidenceType, setEvidenceType] = useState(source?.evidenceType ?? '');
  const [dueDate, setDueDate] = useState('');
  const [memo, setMemo] = useState('');
  const [rows, setRows] = useState<Row[]>(() => (source ? rowsFrom(source, full) : [emptyRow()]));

  const partners = useQuery({
    queryKey: ['partners', 'active'],
    queryFn: () => apiFetch<Partner[]>('/partners'),
  });
  const items = useQuery({ queryKey: ['items', 'active'], queryFn: () => apiFetch<Item[]>('/items') });
  const warehouses = useQuery({
    queryKey: ['warehouses', 'active'],
    queryFn: () => apiFetch<Warehouse[]>('/warehouses'),
  });
  const warehouseId = warehouseChoice || warehouses.data?.[0]?.id || '';
  const itemById = new Map(items.data?.map((i) => [i.id, i]));

  async function lookupPrice(itemId: string, partner: string | null) {
    const params = new URLSearchParams({ side });
    if (partner) params.set('partnerId', partner);
    const res = await apiFetch<{ unitPrice: number | null }>(`/items/${itemId}/price?${params}`);
    return res.unitPrice ?? 0;
  }

  async function chooseItem(key: number, itemId: string | null) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, itemId, priceTouched: false } : r)));
    if (!itemId) return;
    const price = await lookupPrice(itemId, partnerId);
    setRows((rs) =>
      rs.map((r) => (r.key === key && r.itemId === itemId && !r.priceTouched ? { ...r, unitPrice: price } : r)),
    );
  }

  async function choosePartner(id: string | null) {
    setPartnerId(id);
    // 거래처가 바뀌면 직접 고치지 않은 단가를 거래처별 단가로 다시 불러온다
    for (const r of rows) {
      if (!r.itemId || r.priceTouched) continue;
      const price = await lookupPrice(r.itemId, id);
      setRows((rs) =>
        rs.map((x) => (x.key === r.key && !x.priceTouched ? { ...x, unitPrice: price } : x)),
      );
    }
  }

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const totals = rows.reduce(
    (t, r) => {
      const a = amounts(r, r.itemId ? itemById.get(r.itemId) : undefined);
      return { supply: t.supply + a.supply, vat: t.vat + a.vat };
    },
    { supply: 0, vat: 0 },
  );

  const save = useMutation({
    mutationFn: () =>
      apiFetch<TradeDoc>('/trade-docs', {
        method: 'POST',
        json: {
          kind,
          docDate,
          partnerId,
          warehouseId: warehouseId || null,
          sourceDocId: source?.id ?? null,
          evidenceType: evidenceType || null,
          dueDate: dueDate || null,
          memo,
          lines: rows
            .filter((r) => r.itemId)
            .map((r) => ({
              itemId: r.itemId,
              qty: Number(r.qty),
              unitPrice: r.unitPrice,
              sourceLineId: r.sourceLineId,
            })),
        },
      }),
    onSuccess: (doc) => {
      void queryClient.invalidateQueries({ queryKey: TRADE_DOCS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(`${TRADE_DOC_KIND_LABELS[kind]} ${doc.docNo}을(를) 저장했습니다.`);
      router.push(`/sales/docs/${doc.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '저장하지 못했습니다.'),
  });

  const stockOnly = kind === 'receipt' || kind === 'shipment';
  const itemOptions = (items.data ?? [])
    .filter((i) => !stockOnly || isStockItem(i.kind))
    .map((i) => ({ id: i.id, code: i.code, name: i.name, hint: i.spec ?? undefined }));
  const title = `${TRADE_DOC_KIND_LABELS[kind]} 입력`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {source ? (
          <p className="text-sm text-muted-foreground">
            {TRADE_DOC_KIND_LABELS[source.kind]} {source.docNo}에서 만듭니다.
            {full ? ' 줄은 그대로 옮기고 단가만 고칠 수 있습니다.' : ' 남은 수량까지 넘길 수 있습니다.'}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField id="doc-date" label="일자">
            <Input id="doc-date" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
          </FormField>
          <FormField id="doc-partner" label="거래처">
            <Combobox
              aria-label="거래처"
              items={partners.data ?? []}
              value={partnerId}
              onChange={(id) => void choosePartner(id)}
              disabled={!!source?.partnerId}
              placeholder="거래처 검색"
            />
          </FormField>
          <FormField id="doc-warehouse" label="창고">
            <Select
              id="doc-warehouse"
              value={warehouseId}
              onChange={(e) => setWarehouseChoice(e.target.value)}
              disabled={full}
            >
              {warehouses.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </FormField>
          {isOrderKind(kind) ? (
            <FormField id="doc-due" label={kind === 'quote' ? '유효기한' : '납기'}>
              <Input id="doc-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </FormField>
          ) : (
            <FormField id="doc-evidence" label="증빙">
              <Select id="doc-evidence" value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)}>
                {EVIDENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table aria-label="품목 줄">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead className="min-w-64">품목</TableHead>
                <TableHead className="w-16">단위</TableHead>
                <TableHead className="w-28">수량</TableHead>
                <TableHead className="w-36">단가</TableHead>
                <TableHead className="w-32 text-right">공급가액</TableHead>
                <TableHead className="w-28 text-right">부가세</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const item = r.itemId ? itemById.get(r.itemId) : undefined;
                const a = amounts(r, item);
                const n = i + 1;
                return (
                  <TableRow key={r.key}>
                    <TableCell className="text-center tabular-nums text-muted-foreground">{n}</TableCell>
                    <TableCell>
                      <Combobox
                        aria-label={`${n}행 품목`}
                        items={itemOptions}
                        value={r.itemId}
                        onChange={(id) => void chooseItem(r.key, id)}
                        disabled={!!r.sourceLineId}
                        placeholder="품목명·코드"
                      />
                    </TableCell>
                    <TableCell>{item?.unit ?? ''}</TableCell>
                    <TableCell>
                      <Input
                        aria-label={`${n}행 수량`}
                        inputMode="decimal"
                        className="text-right"
                        value={r.qty}
                        readOnly={full}
                        onChange={(e) => update(r.key, { qty: e.target.value })}
                      />
                      {r.maxQty != null && !full ? (
                        <p className="mt-1 text-xs text-muted-foreground">최대 {formatQty(r.maxQty)}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <WonInput
                        aria-label={`${n}행 단가`}
                        value={r.unitPrice}
                        onValueChange={(v) => update(r.key, { unitPrice: v, priceTouched: true })}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatWon(a.supply)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatWon(a.vat)}</TableCell>
                    <TableCell>
                      {!full ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`${n}행 지우기`}
                          onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={5} className="text-right font-medium">
                  합계 {formatWon(totals.supply + totals.vat)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatWon(totals.supply)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatWon(totals.vat)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
        {!full ? (
          <div>
            <Button variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
              <Plus />줄 추가
            </Button>
          </div>
        ) : null}

        <FormField id="doc-memo" label="메모">
          <Input id="doc-memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.back()}>
            취소
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !rows.some((r) => r.itemId)}
          >
            {save.isPending ? '저장 중…' : '저장'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
