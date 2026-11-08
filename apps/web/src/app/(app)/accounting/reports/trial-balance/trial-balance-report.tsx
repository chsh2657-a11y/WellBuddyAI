'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { todayIso } from '@/lib/format';
import { useReport, useSubtitle } from '../_components/report-hooks';
import { type ReportModel, type ReportRow, ReportView } from '../_components/report-view';
import type { TrialBalance } from '../_components/types';

/** 합계잔액시산표: 회계연도 시작부터 기준일까지 계정별 차변·대변 합계와 잔액 */
export function TrialBalanceReport() {
  const [date, setDate] = useState(todayIso());
  const report = useReport<TrialBalance>('trial-balance', { date }, !!date);
  const d = report.data;
  const subtitle = useSubtitle(d ? `${d.fiscalYear.startDate} ~ ${d.date}` : date);

  const rows: ReportRow[] = [];
  if (d) {
    let group = '';
    for (const r of d.rows) {
      if (r.groupLabel !== group) {
        group = r.groupLabel;
        const g = d.rows.filter((x) => x.groupLabel === group);
        const s = (k: 'debitBalance' | 'debit' | 'credit' | 'creditBalance') =>
          g.reduce((t, x) => t + x[k], 0);
        rows.push({
          kind: 'section',
          cells: [s('debitBalance'), s('debit'), group, s('credit'), s('creditBalance')],
        });
      }
      rows.push({
        indent: true,
        cells: [r.debitBalance, r.debit, `${r.code} ${r.name}`, r.credit, r.creditBalance],
      });
    }
    if (d.rows.length > 0) {
      rows.push({
        kind: 'total',
        cells: [
          d.totals.debitBalance,
          d.totals.debit,
          '합계',
          d.totals.credit,
          d.totals.creditBalance,
        ],
      });
    }
  }

  const model: ReportModel = {
    title: '합계잔액시산표',
    subtitle,
    groups: [
      { label: '차변', span: 2 },
      { label: '', span: 1 },
      { label: '대변', span: 2 },
    ],
    columns: [
      { header: '잔액', exportHeader: '차변 잔액', type: 'won' },
      { header: '합계', exportHeader: '차변 합계', type: 'won' },
      { header: '계정과목', className: 'text-center', width: 26 },
      { header: '합계', exportHeader: '대변 합계', type: 'won' },
      { header: '잔액', exportHeader: '대변 잔액', type: 'won' },
    ],
    rows,
  };

  return (
    <ReportView
      model={model}
      loading={report.isPending}
      error={report.error}
      emptyText="전기한 전표가 없습니다."
      badge={
        d && d.rows.length > 0 ? (
          d.balanced ? (
            <Badge variant="success">대차 일치</Badge>
          ) : (
            <Badge variant="danger">대차 불일치</Badge>
          )
        ) : null
      }
      filters={
        <Input
          type="date"
          aria-label="기준일"
          className="w-44"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      }
    />
  );
}
