'use client';

import { addDays, formatWon, todayInKorea } from '@wellbuddy/accounting-core';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatQty } from '../_lib/trade';
import type { Warehouse } from '../warehouses/warehouses-manager';

interface StockRow {
  itemId: string;
  code: string;
  name: string;
  spec: string | null;
  unit: string;
  qty: number;
  totalQty: number;
  value: number;
  unitCost: number | null;
  safetyStock: number | null;
  belowSafety: boolean;
  warehouses: { warehouseId: string; qty: number }[];
}

interface Ledger {
  opening: { qty: number; value: number };
  closing: { qty: number; value: number };
  lines: {
    id: string;
    date: string;
    docId: string;
    docNo: string;
    kindLabel: string;
    partnerName: string | null;
    warehouseName: string;
    inQty: number;
    outQty: number;
    amount: number;
    balanceQty: number;
    balanceValue: number;
  }[];
}

/** 재고: 현재고(품목·창고별 수량, 이동평균 재고금액)와 품목을 고르면 재고수불부 */
export function InventoryView() {
  const [date, setDate] = useState(todayInKorea());
  const [warehouseId, setWarehouseId] = useState('');
  const [itemId, setItemId] = useState<string | null>(null);
  const [from, setFrom] = useState(addDays(todayInKorea(), -30));
  const [to, setTo] = useState(todayInKorea());

  const warehouses = useQuery({
    queryKey: ['warehouses', 'active'],
    queryFn: () => apiFetch<Warehouse[]>('/warehouses'),
  });
  const params = new URLSearchParams({ date });
  if (warehouseId) params.set('warehouseId', warehouseId);
  const stock = useQuery({
    queryKey: ['inventory', 'stock', date, warehouseId],
    queryFn: () => apiFetch<StockRow[]>(`/inventory/stock?${params}`),
  });
  const ledgerParams = new URLSearchParams({ itemId: itemId ?? '', from, to });
  if (warehouseId) ledgerParams.set('warehouseId', warehouseId);
  const ledger = useQuery({
    queryKey: ['inventory', 'ledger', itemId, from, to, warehouseId],
    queryFn: () => apiFetch<Ledger>(`/inventory/ledger?${ledgerParams}`),
    enabled: !!itemId,
  });
  const whName = new Map(warehouses.data?.map((w) => [w.id, w.name]));
  const selected = stock.data?.find((r) => r.itemId === itemId);
  const totalValue = stock.data?.reduce((s, r) => s + r.value, 0) ?? 0;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center gap-3">
          <CardTitle className="text-base">현재고</CardTitle>
          <Input
            type="date"
            aria-label="기준일"
            className="w-40"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Select
            aria-label="창고"
            className="w-44"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            <option value="">전체 창고</option>
            {warehouses.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <p className="ml-auto text-sm text-muted-foreground">
            재고금액은 품목별 이동평균(모든 창고 합계)입니다.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0 pb-2">
          <Table aria-label="현재고">
            <TableHeader>
              <TableRow>
                <TableHead className="w-24 pl-5">코드</TableHead>
                <TableHead className="min-w-40">품목</TableHead>
                <TableHead className="min-w-40">창고별</TableHead>
                <TableHead className="w-28 text-right">
                  {warehouseId ? '창고 수량' : '수량'}
                </TableHead>
                <TableHead className="w-28 text-right">평균단가</TableHead>
                <TableHead className="w-32 text-right">재고금액</TableHead>
                <TableHead className="w-28 pr-5 text-right">적정재고</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stock.data?.map((r) => (
                <TableRow
                  key={r.itemId}
                  className={cn('cursor-pointer', r.itemId === itemId && 'bg-primary-soft/40')}
                  onClick={() => setItemId(r.itemId)}
                >
                  <TableCell className="pl-5 tabular-nums">{r.code}</TableCell>
                  <TableCell className="font-medium">
                    {r.name}
                    {r.spec ? <span className="ml-1 text-muted-foreground">{r.spec}</span> : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.warehouses
                      .map((w) => `${whName.get(w.warehouseId) ?? ''} ${formatQty(w.qty)}`)
                      .join(' · ') || '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQty(r.qty)} {r.unit}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.unitCost == null ? '—' : formatWon(r.unitCost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatWon(r.value)}</TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">
                    {r.safetyStock == null ? (
                      '—'
                    ) : r.belowSafety ? (
                      <Badge variant="warning">
                        <AlertTriangle className="size-3" />
                        {formatQty(r.safetyStock)} 미달
                      </Badge>
                    ) : (
                      formatQty(r.safetyStock)
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={5} className="pl-5 text-right font-medium">
                  재고금액 합계
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatWon(totalValue)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
          {stock.data?.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">재고가 있는 품목이 없습니다.</p>
          ) : null}
        </CardContent>
      </Card>

      {itemId ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center gap-3">
            <CardTitle className="text-base">재고수불부 · {selected?.name}</CardTitle>
            <Input
              type="date"
              aria-label="수불부 시작일"
              className="w-40"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="text-muted-foreground">~</span>
            <Input
              type="date"
              aria-label="수불부 종료일"
              className="w-40"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </CardHeader>
          <CardContent className="overflow-x-auto px-0 pb-2">
            <Table aria-label="재고수불부">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28 pl-5">일자</TableHead>
                  <TableHead className="min-w-44">문서</TableHead>
                  <TableHead className="min-w-28">거래처</TableHead>
                  <TableHead className="w-28">창고</TableHead>
                  <TableHead className="w-24 text-right">입고</TableHead>
                  <TableHead className="w-24 text-right">출고</TableHead>
                  <TableHead className="w-28 text-right">금액</TableHead>
                  <TableHead className="w-24 text-right">재고</TableHead>
                  <TableHead className="w-32 pr-5 text-right">재고금액</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="text-muted-foreground">
                  <TableCell className="pl-5" colSpan={7}>
                    이월
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQty(ledger.data?.opening.qty ?? 0)}
                  </TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">
                    {formatWon(ledger.data?.opening.value ?? 0)}
                  </TableCell>
                </TableRow>
                {ledger.data?.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap pl-5 tabular-nums">{l.date}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Link
                        href={`/sales/docs/${l.docId}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {l.kindLabel} {l.docNo}
                      </Link>
                    </TableCell>
                    <TableCell>{l.partnerName ?? '—'}</TableCell>
                    <TableCell>{l.warehouseName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.inQty ? formatQty(l.inQty) : ''}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.outQty ? formatQty(l.outQty) : ''}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatWon(l.amount)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQty(l.balanceQty)}
                    </TableCell>
                    <TableCell className="pr-5 text-right tabular-nums">
                      {formatWon(l.balanceValue)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">품목을 누르면 재고수불부를 봅니다.</p>
      )}
    </div>
  );
}
