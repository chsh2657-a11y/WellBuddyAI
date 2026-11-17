'use client';

import { todayInKorea } from '@wellbuddy/accounting-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
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
        {stock.data ? (
          // 창고·날짜가 바뀌면 입력을 새로 시작한다
          <CountTable
            key={`${date}|${warehouseId}`}
            date={date}
            warehouseId={warehouseId}
            rows={stock.data.filter((r) => r.isActive || r.qty !== 0)}
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
}: {
  date: string;
  warehouseId: string;
  rows: StockRow[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.itemId, String(r.qty)])),
  );
  const [memo, setMemo] = useState('');
  const parsed = (r: StockRow) => {
    const v = counted[r.itemId]?.trim() ?? '';
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
          counts: changed.map((r) => ({ itemId: r.itemId, countedQty: parsed(r) })),
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
                <TableRow key={r.itemId}>
                  <TableCell className="pl-6 tabular-nums">{r.code}</TableCell>
                  <TableCell className="font-medium">
                    {r.name}
                    {r.spec ? <span className="ml-1 text-muted-foreground">{r.spec}</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQty(r.qty)} {r.unit}
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`${r.name} 실사 수량`}
                      inputMode="decimal"
                      className="text-right"
                      value={counted[r.itemId] ?? ''}
                      onChange={(e) => setCounted((c) => ({ ...c, [r.itemId]: e.target.value }))}
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
