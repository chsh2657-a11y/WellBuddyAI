'use client';

import { todayInKorea } from '@wellbuddy/accounting-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { BarcodeInput } from '@/components/barcode-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatQty, TRADE_DOCS_KEY, type TradeDoc } from '../../_lib/trade';
import type { Warehouse } from '../../warehouses/warehouses-manager';

interface StockRow {
  itemId: string;
  code: string;
  name: string;
  spec: string | null;
  unit: string;
  qty: number;
  isActive: boolean;
}

interface LotRow {
  itemId: string;
  lotNo: string;
  qty: number;
}

/** 실사할 한 칸: 품목(LOT·시리얼 관리 품목은 LOT 마다) */
interface Entry extends StockRow {
  key: string;
  lotNo: string | null;
}

/** 재고 실사(P3-11): 창고·기준일의 장부 수량 옆에 실사 수량을 넣으면 차이만 재고 조정으로 남긴다 */
export function CountForm() {
  const [date, setDate] = useState(todayInKorea());
  const [warehouseChoice, setWarehouseChoice] = useState('');
  const warehouses = useQuery({
    queryKey: ['warehouses', 'active'],
    queryFn: () => apiFetch<Warehouse[]>('/warehouses'),
  });
  const warehouseId = warehouseChoice || warehouses.data?.[0]?.id || '';
  const stock = useQuery({
    queryKey: ['inventory', 'stock', date, warehouseId],
    queryFn: () =>
      apiFetch<StockRow[]>(`/inventory/stock?${new URLSearchParams({ date, warehouseId })}`),
    enabled: !!warehouseId,
  });
  const lots = useQuery({
    queryKey: ['inventory', 'lots', warehouseId, date],
    queryFn: () =>
      apiFetch<LotRow[]>(`/inventory/lots?${new URLSearchParams({ date, warehouseId })}`),
    enabled: !!warehouseId,
  });
  const items = useQuery({
    queryKey: ['items', 'active'],
    queryFn: () =>
      apiFetch<{ id: string; barcode: string | null; trackLot: boolean; trackSerial: boolean }[]>(
        '/items',
      ),
  });
  const tracked = new Set(items.data?.filter((i) => i.trackLot || i.trackSerial).map((i) => i.id));
  const entries: Entry[] | undefined =
    stock.data && lots.data && items.data
      ? stock.data
          .filter((r) => r.isActive || r.qty !== 0)
          .flatMap((r): Entry[] =>
            tracked.has(r.itemId)
              ? lots.data
                  .filter((l) => l.itemId === r.itemId)
                  .map((l) => ({ ...r, key: `${r.itemId}|${l.lotNo}`, lotNo: l.lotNo, qty: l.qty }))
              : [{ ...r, key: r.itemId, lotNo: null }],
          )
      : undefined;

  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle>재고 실사</CardTitle>
        <p className="text-sm text-muted-foreground">
          창고에서 센 수량을 넣으면 장부와 다른 품목만 재고 조정으로 저장합니다. 줄어든 재고는
          이동평균 원가로 매출원가(감모), 늘어난 재고는 그 반대로 전표를 만듭니다.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField id="count-date" label="실사일">
            <Input
              id="count-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </FormField>
          <FormField id="count-warehouse" label="창고">
            <Select
              id="count-warehouse"
              value={warehouseId}
              onChange={(e) => setWarehouseChoice(e.target.value)}
            >
              {warehouses.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-4">
        {entries ? (
          // 창고·날짜가 바뀌면 입력을 새로 시작한다
          <CountTable
            key={`${date}|${warehouseId}`}
            date={date}
            warehouseId={warehouseId}
            rows={entries}
            barcodes={
              new Map(items.data?.flatMap((i) => (i.barcode ? [[i.barcode, i.id] as const] : [])))
            }
          />
        ) : (
          <p className="px-6 text-sm text-muted-foreground">불러오는 중…</p>
        )}
      </CardContent>
    </Card>
  );
}

function CountTable({
  date,
  warehouseId,
  rows,
  barcodes,
}: {
  date: string;
  warehouseId: string;
  rows: Entry[];
  /** 바코드 → 품목 */
  barcodes: Map<string, string>;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, String(r.qty)])),
  );
  const [memo, setMemo] = useState('');
  /** 스캔으로 세는 품목: 처음 스캔하면 1부터 센다 */
  const [scanned, setScanned] = useState<Set<string>>(() => new Set());
  const scan = (code: string) => {
    const itemId = barcodes.get(code);
    const entry = rows.find((r) => r.itemId === itemId);
    if (!entry) {
      toast.error(`바코드 ${code}에 맞는 품목이 이 창고 목록에 없습니다.`);
      return;
    }
    if (entry.lotNo) {
      toast.error(`'${entry.name}'은(는) LOT·시리얼별로 수량을 직접 입력해 주세요.`);
      return;
    }
    const first = !scanned.has(entry.key);
    setScanned((s) => new Set(s).add(entry.key));
    setCounted((c) => {
      const now = first ? 0 : Number(c[entry.key]) || 0;
      return { ...c, [entry.key]: String(Math.round((now + 1) * 1000) / 1000) };
    });
  };
  const parsed = (r: Entry) => {
    const v = counted[r.key]?.trim() ?? '';
    const n = Number(v.replaceAll(',', ''));
    return v !== '' && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const changed = rows.filter((r) => {
    const n = parsed(r);
    return n !== null && Math.round(n * 1000) !== Math.round(r.qty * 1000);
  });
  const invalid = rows.some((r) => parsed(r) === null);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<TradeDoc>('/inventory/counts', {
        method: 'POST',
        json: {
          docDate: date,
          warehouseId,
          memo,
          counts: changed.map((r) => ({ itemId: r.itemId, lotNo: r.lotNo, countedQty: parsed(r) })),
        },
      }),
    onSuccess: (doc) => {
      void queryClient.invalidateQueries({ queryKey: TRADE_DOCS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(`재고조정 ${doc.docNo}을(를) 저장했습니다.`);
      router.push(`/sales/docs/${doc.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '저장하지 못했습니다.'),
  });

  return (
    <div className="grid gap-4">
      <div className="px-6">
        <BarcodeInput onScan={scan} />
        <p className="mt-1 text-xs text-muted-foreground">
          스캔한 품목은 0부터 다시 세어 한 번에 1개씩 늘어납니다.
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table aria-label="재고 실사">
          <TableHeader>
            <TableRow>
              <TableHead className="w-24 pl-6">코드</TableHead>
              <TableHead className="min-w-40">품목</TableHead>
              <TableHead className="w-28 text-right">장부 수량</TableHead>
              <TableHead className="w-36">실사 수량</TableHead>
              <TableHead className="w-28 pr-6 text-right">차이</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const n = parsed(r);
              const diff = n === null ? null : Math.round((n - r.qty) * 1000) / 1000;
              return (
                <TableRow key={r.key}>
                  <TableCell className="pl-6 tabular-nums">{r.code}</TableCell>
                  <TableCell className="font-medium">
                    {r.name}
                    {r.spec ? <span className="ml-1 text-muted-foreground">{r.spec}</span> : null}
                    {r.lotNo ? (
                      <span className="ml-1 text-xs text-muted-foreground">LOT {r.lotNo}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQty(r.qty)} {r.unit}
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`${r.name}${r.lotNo ? ` ${r.lotNo}` : ''} 실사 수량`}
                      inputMode="decimal"
                      className="text-right"
                      value={counted[r.key] ?? ''}
                      onChange={(e) => setCounted((c) => ({ ...c, [r.key]: e.target.value }))}
                    />
                  </TableCell>
                  <TableCell
                    className={cn(
                      'pr-6 text-right tabular-nums',
                      diff && diff < 0 && 'text-danger',
                      diff && diff > 0 && 'text-success',
                    )}
                  >
                    {diff === null
                      ? '확인'
                      : diff === 0
                        ? ''
                        : `${diff > 0 ? '+' : ''}${formatQty(diff)}`}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">재고 품목이 없습니다.</p>
        ) : null}
      </div>
      <div className="grid gap-4 px-6 sm:grid-cols-[1fr_auto] sm:items-end">
        <FormField id="count-memo" label="메모">
          <Input
            id="count-memo"
            placeholder="재고 실사"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </FormField>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.back()}>
            취소
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || invalid || changed.length === 0}
          >
            {save.isPending
              ? '저장 중…'
              : changed.length
                ? `차이 ${changed.length}건 조정 저장`
                : '차이가 없습니다'}
          </Button>
        </div>
      </div>
    </div>
  );
}
