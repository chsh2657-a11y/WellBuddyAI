'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
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
import { formatWon, todayIso } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Group {
  ledgerAccountId: string;
  ledgerAccount: string;
  bankBalance: number | null;
  ledgerBalance: number;
  unreflected: number;
  unreflectedCount: number;
  difference: number | null;
  status: 'matched' | 'mismatch' | 'unknown';
  accounts: {
    id: string;
    alias: string;
    bankName: string;
    accountNoMasked: string;
    isActive: boolean;
    balance: number | null;
    balanceDate: string | null;
    unreflected: number;
    unreflectedCount: number;
  }[];
}

const STATUS = {
  matched: { label: '일치', variant: 'success' },
  mismatch: { label: '불일치', variant: 'danger' },
  unknown: { label: '통장 잔액 정보 없음', variant: 'muted' },
} as const;

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatWon(Math.abs(n))}`;

/** 통장 잔액 ↔ 장부 잔액 대사(P2-26) */
export function ReconcileView() {
  const [date, setDate] = useState(todayIso);
  const data = useQuery({
    queryKey: ['evidence', 'reconciliation', date],
    queryFn: () =>
      apiFetch<{ date: string; groups: Group[] }>(`/evidence/reconciliation?date=${date}`),
    enabled: !!date,
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <FormField id="reconcile-date" label="기준일" className="w-44">
          <Input
            id="reconcile-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </FormField>
        <p className="pb-2 text-sm text-muted-foreground">
          통장 잔액 − 장부 잔액 − 장부에 아직 반영하지 않은 통장 거래 = 차이. 차이가 0이면
          일치입니다.
        </p>
      </div>
      {data.data?.groups.map((g) => (
        <Card key={g.ledgerAccountId} data-testid={`reconcile-${g.ledgerAccount}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {g.ledgerAccount}
              <Badge variant={STATUS[g.status].variant}>{STATUS[g.status].label}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" aria-label="대사 결과">
              <div>
                <dt className="text-muted-foreground">통장 잔액</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {g.bankBalance === null ? '—' : formatWon(g.bankBalance)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">장부 잔액</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatWon(g.ledgerBalance)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">미반영 거래 {g.unreflectedCount}건</dt>
                <dd className="text-lg font-semibold tabular-nums">{signed(g.unreflected)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">차이</dt>
                <dd
                  className={cn(
                    'text-lg font-semibold tabular-nums',
                    g.status === 'mismatch' && 'text-danger',
                  )}
                >
                  {g.difference === null ? '—' : signed(g.difference)}
                </dd>
              </div>
            </dl>
            <div className="rounded-md border">
              <Table aria-label={`${g.ledgerAccount} 계좌`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>계좌</TableHead>
                    <TableHead className="text-right">통장 잔액</TableHead>
                    <TableHead>잔액 기준</TableHead>
                    <TableHead className="text-right">미반영 거래</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.accounts.map((a) => (
                    <TableRow key={a.id} className={cn(!a.isActive && 'text-muted-foreground')}>
                      <TableCell>
                        <span className="font-medium">{a.alias}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {a.bankName} {a.accountNoMasked}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.balance === null ? '—' : formatWon(a.balance)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {a.balanceDate ?? '잔액 정보 없음'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.unreflectedCount}건 {signed(a.unreflected)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ))}
      {data.isSuccess && data.data.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          등록한 계좌가 없습니다. 계좌·카드에서 계좌를 먼저 등록해 주세요.
        </p>
      ) : null}
    </div>
  );
}
