'use client';

import { formatWon, todayInKorea } from '@wellbuddy/accounting-core';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch } from '@/lib/api';

interface Reconcile {
  date: string;
  balanced: boolean;
  rows: {
    accountId: string;
    code: string;
    name: string;
    stockValue: number;
    ledgerBalance: number;
    difference: number;
    pendingTrade: number;
    otherEntries: {
      id: string;
      number: string;
      date: string;
      description: string | null;
      amount: number;
    }[];
  }[];
}

/** 재고–장부 대사: 재고 계정별 재고금액과 장부 잔액, 차이가 나면 그 원인이 될 전표 */
export function ReconcileView() {
  const [date, setDate] = useState(todayInKorea());
  const data = useQuery({
    queryKey: ['inventory', 'reconcile', date],
    queryFn: () => apiFetch<Reconcile>(`/inventory/reconcile?date=${date}`),
  });
  const d = data.data;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <CardTitle className="text-base">재고–장부 대사</CardTitle>
        <Input
          type="date"
          aria-label="대사 기준일"
          className="w-40"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        {d ? (
          d.balanced ? (
            <Badge variant="success">
              <CheckCircle2 className="size-3" />
              일치
            </Badge>
          ) : (
            <Badge variant="danger">
              <AlertTriangle className="size-3" />
              차이 있음
            </Badge>
          )
        ) : null}
        <p className="ml-auto text-sm text-muted-foreground">
          재고금액(이동평균)과 재고자산 계정 잔액을 견줍니다.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 overflow-x-auto px-0 pb-2">
        <Table aria-label="재고 장부 대사">
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-40 pl-5">계정</TableHead>
              <TableHead className="w-32 text-right">재고금액</TableHead>
              <TableHead className="w-32 text-right">장부 잔액</TableHead>
              <TableHead className="w-32 text-right">차이</TableHead>
              <TableHead className="w-36 pr-5 text-right">승인 대기 영업 전표</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d?.rows.map((r) => (
              <TableRow key={r.accountId}>
                <TableCell className="pl-5 font-medium">
                  {r.code} {r.name}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatWon(r.stockValue)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatWon(r.ledgerBalance)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${r.difference ? 'font-semibold text-danger' : ''}`}
                >
                  {r.difference ? formatWon(r.difference) : '일치'}
                </TableCell>
                <TableCell className="pr-5 text-right tabular-nums">
                  {r.pendingTrade ? formatWon(r.pendingTrade) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {d?.rows.length === 0 ? (
          <p className="px-5 text-sm text-muted-foreground">
            재고금액과 재고자산 계정 잔액이 모두 0원입니다.
          </p>
        ) : null}
        {d?.rows
          .filter((r) => r.difference !== 0)
          .map((r) => (
            <div key={r.accountId} className="grid gap-1 px-5 text-sm">
              <p className="font-medium">
                {r.code} {r.name}: 차이 {formatWon(r.difference)}의 원인 후보
              </p>
              {r.pendingTrade ? (
                <p className="text-muted-foreground">
                  승인을 기다리는 영업 전표 {formatWon(r.pendingTrade)}이(가) 아직 장부에 없습니다.
                </p>
              ) : null}
              {r.otherEntries.length ? (
                <ul className="grid gap-0.5" aria-label={`${r.code} 일반 전표`}>
                  {r.otherEntries.map((e) => (
                    <li key={e.id} className="flex gap-3">
                      <span className="tabular-nums">{e.date}</span>
                      <Link className="underline" href={`/accounting/journals/${e.id}`}>
                        {e.number}
                      </Link>
                      <span className="text-muted-foreground">{e.description ?? ''}</span>
                      <span className="ml-auto tabular-nums">{formatWon(e.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">
                  재고 계정을 직접 움직인 일반 전표가 없습니다. 기초재고 입력(재고 실사·조정)을
                  확인해 주세요.
                </p>
              )}
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
