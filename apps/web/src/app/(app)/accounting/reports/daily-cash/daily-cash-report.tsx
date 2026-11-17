'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatWon, todayIso } from '@/lib/format';
import { useReport, useSubtitle } from '../_components/report-hooks';
import { type ReportModel, type ReportRow, ReportView } from '../_components/report-view';

interface ScheduledItem {
  source: 'plan' | 'note';
  id: string;
  direction: 'in' | 'out';
  amount: number;
  description: string;
  partnerName: string | null;
}

interface DailyCash {
  date: string;
  previousDate: string;
  accounts: {
    accountId: string;
    code: string;
    name: string;
    opening: number;
    receipts: number;
    payments: number;
    closing: number;
    rows: {
      lineId: string;
      entryId: string;
      number: string;
      description: string | null;
      partnerName: string | null;
      counterAccount: string;
      receipt: number;
      payment: number;
      balance: number;
    }[];
  }[];
  totals: { opening: number; receipts: number; payments: number; closing: number };
  scheduled: ScheduledItem[];
}

/** 일일자금일보: 현금·예금 계정별 전일 잔액, 입금, 출금, 금일 잔액과 오늘 예정 입출금 */
export function DailyCashReport() {
  const [date, setDate] = useState(todayIso());
  const report = useReport<DailyCash>('daily-cash', { date }, !!date);
  const d = report.data;
  const subtitle = useSubtitle(date);

  const rows: ReportRow[] = d
    ? [
        ...d.accounts.flatMap((a): ReportRow[] => [
          { kind: 'section', cells: [`${a.code} ${a.name}`, null, null, null, null, null, null] },
          { indent: true, cells: ['전일 잔액', null, null, null, null, null, a.opening] },
          ...a.rows.map((r) => ({
            indent: true,
            cells: [
              r.description ?? '',
              r.number,
              r.counterAccount,
              r.partnerName ?? '',
              r.receipt,
              r.payment,
              r.balance,
            ],
            links: { 1: `/accounting/journals/${r.entryId}` },
          })),
          {
            kind: 'subtotal',
            cells: [`${a.name} 금일`, null, null, null, a.receipts, a.payments, a.closing],
          },
        ]),
        {
          kind: 'total',
          cells: ['합계', null, null, null, d.totals.receipts, d.totals.payments, d.totals.closing],
        },
      ]
    : [];
  const model: ReportModel = {
    title: '일일자금일보',
    subtitle,
    columns: [
      { header: '계정·적요', width: 28 },
      { header: '전표번호', width: 14 },
      { header: '상대 계정', width: 16 },
      { header: '거래처', width: 16 },
      { header: '입금', type: 'won' },
      { header: '출금', type: 'won' },
      { header: '잔액', type: 'won' },
    ],
    rows,
  };

  return (
    <div className="grid gap-4">
      <ReportView
        model={model}
        loading={report.isPending}
        error={report.error}
        emptyText="현금·예금 계정이 없습니다."
        badge={
          d ? (
            <Badge variant="muted">
              전일 {formatWon(d.totals.opening)} → 금일 {formatWon(d.totals.closing)}
            </Badge>
          ) : null
        }
        filters={
          <Input
            type="date"
            aria-label="일자"
            className="w-44"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        }
      />
      {d && d.scheduled.length > 0 ? (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="text-base">오늘 예정(어음 만기·자금계획)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {d.scheduled.map((s) => (
                <li key={`${s.source}:${s.id}`} className="flex flex-wrap gap-2">
                  <Badge variant={s.direction === 'in' ? 'success' : 'warning'}>
                    {s.direction === 'in' ? '입금' : '출금'}
                  </Badge>
                  <span>{s.description}</span>
                  {s.partnerName ? (
                    <span className="text-muted-foreground">{s.partnerName}</span>
                  ) : null}
                  <span className="ml-auto tabular-nums">{formatWon(s.amount)}원</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
