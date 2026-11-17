'use client';

import { formatWon, todayInKorea } from '@wellbuddy/accounting-core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
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
import { formatQty } from '../_lib/trade';
import type { Warehouse } from '../warehouses/warehouses-manager';

interface QtyValue {
  qty: number;
  value: number;
}

interface Summary {
  rows: {
    itemId: string;
    code: string;
    name: string;
    spec: string | null;
    unit: string;
    opening: QtyValue;
    in: QtyValue;
    out: QtyValue;
    closing: QtyValue;
  }[];
  totals: { opening: number; in: number; out: number; closing: number };
}

const COLUMNS = [
  ['opening', '기초'],
  ['in', '입고'],
  ['out', '출고'],
  ['closing', '기말'],
] as const;

/** 재고수불현황: 기간의 품목별 기초·입고·출고·기말 수량과 금액 */
export function SummaryView() {
  const today = todayInKorea();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [warehouseId, setWarehouseId] = useState('');
  const warehouses = useQuery({
    queryKey: ['warehouses', 'active'],
    queryFn: () => apiFetch<Warehouse[]>('/warehouses'),
  });
  const params = new URLSearchParams({ from, to });
  if (warehouseId) params.set('warehouseId', warehouseId);
  const summary = useQuery({
    queryKey: ['inventory', 'summary', from, to, warehouseId],
    queryFn: () => apiFetch<Summary>(`/inventory/summary?${params}`),
    enabled: from <= to,
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <CardTitle className="text-base">재고수불현황</CardTitle>
        <Input
          type="date"
          aria-label="수불현황 시작일"
          className="w-40"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="text-muted-foreground">~</span>
        <Input
          type="date"
          aria-label="수불현황 종료일"
          className="w-40"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <Select
          aria-label="수불현황 창고"
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
          전체 창고로 보면 창고 간 이동은 빼고 셉니다.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0 pb-2">
        <Table aria-label="재고수불현황">
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2} className="w-24 pl-5">
                코드
              </TableHead>
              <TableHead rowSpan={2} className="min-w-40">
                품목
              </TableHead>
              {COLUMNS.map(([key, label]) => (
                <TableHead key={key} colSpan={2} className="text-center">
                  {label}
                </TableHead>
              ))}
            </TableRow>
            <TableRow>
              {COLUMNS.map(([key]) => (
                <QtyValueHead key={key} last={key === 'closing'} />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.data?.rows.map((r) => (
              <TableRow key={r.itemId}>
                <TableCell className="pl-5 tabular-nums">{r.code}</TableCell>
                <TableCell className="font-medium">
                  {r.name}
                  {r.spec ? <span className="ml-1 text-muted-foreground">{r.spec}</span> : null}
                </TableCell>
                {COLUMNS.map(([key]) => (
                  <QtyValueCells key={key} v={r[key]} unit={r.unit} last={key === 'closing'} />
                ))}
              </TableRow>
            ))}
          </TableBody>
          {summary.data ? (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="pl-5 text-right font-medium">
                  금액 합계
                </TableCell>
                {COLUMNS.map(([key]) => (
                  <TableCell
                    key={key}
                    colSpan={2}
                    className={`text-right font-medium tabular-nums ${key === 'closing' ? 'pr-5' : ''}`}
                  >
                    {formatWon(summary.data.totals[key])}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
        {summary.data?.rows.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">이 기간에 재고 움직임이 없습니다.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function QtyValueHead({ last }: { last: boolean }) {
  return (
    <>
      <TableHead className="w-20 text-right">수량</TableHead>
      <TableHead className={`w-28 text-right ${last ? 'pr-5' : ''}`}>금액</TableHead>
    </>
  );
}

function QtyValueCells({ v, unit, last }: { v: QtyValue; unit: string; last: boolean }) {
  return (
    <>
      <TableCell className="text-right tabular-nums">
        {v.qty ? `${formatQty(v.qty)} ${unit}` : ''}
      </TableCell>
      <TableCell className={`text-right tabular-nums ${last ? 'pr-5' : ''}`}>
        {v.value ? formatWon(v.value) : ''}
      </TableCell>
    </>
  );
}
