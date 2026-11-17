'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { todayIso } from '@/lib/format';
import { currentMonthRange, useReport, useSubtitle } from '../_components/report-hooks';
import { type ReportModel, type ReportRow, ReportView } from '../_components/report-view';
import type { DailySummary } from '../_components/types';

type Mode = 'day' | 'month';

/**
 * 일계표·월계표. 계정별 차변·대변을 현금·대체로 나누고,
 * 맨 아래에서 "소계 + 금일(월말) 현금 = 소계 + 전일(전월말) 현금" 으로 대차를 맞춘다.
 */
export function DailyReport() {
  const today = todayIso();
  const [mode, setMode] = useState<Mode>('day');
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const range = mode === 'day' ? { from: day, to: day } : currentMonthRange(`${month}-01`);
  const report = useReport<DailySummary>('daily-summary', range, !!(range.from && range.to));
  const subtitle = useSubtitle(mode === 'day' ? day : month);
  const d = report.data;
  const unit = mode === 'day' ? '일' : '월';

  const rows: ReportRow[] = [];
  if (d) {
    let group = '';
    for (const r of d.rows) {
      if (r.groupLabel !== group) {
        group = r.groupLabel;
        const inGroup = d.rows.filter((x) => x.groupLabel === group);
        const s = (k: keyof (typeof d.rows)[number]) =>
          inGroup.reduce((t, x) => t + (x[k] as number), 0);
        rows.push({
          kind: 'section',
          cells: [
            s('debitCash') + s('debitTransfer'),
            s('debitTransfer'),
            s('debitCash'),
            group,
            s('creditCash'),
            s('creditTransfer'),
            s('creditCash') + s('creditTransfer'),
          ],
        });
      }
      rows.push({
        indent: true,
        cells: [
          r.debitCash + r.debitTransfer,
          r.debitTransfer,
          r.debitCash,
          `${r.code} ${r.name}`,
          r.creditCash,
          r.creditTransfer,
          r.creditCash + r.creditTransfer,
        ],
      });
    }
    const t = d.totals;
    const debitTotal = t.debitCash + t.debitTransfer;
    const creditTotal = t.creditCash + t.creditTransfer;
    rows.push(
      {
        kind: 'subtotal',
        cells: [
          debitTotal,
          t.debitTransfer,
          t.debitCash,
          `금${unit} 소계`,
          t.creditCash,
          t.creditTransfer,
          creditTotal,
        ],
      },
      {
        kind: 'subtotal',
        cells: [
          d.cash.closing,
          null,
          d.cash.closing,
          `금${unit} 잔고 / 전${unit} 잔고`,
          d.cash.opening,
          null,
          d.cash.opening,
        ],
      },
      {
        kind: 'total',
        cells: [
          debitTotal + d.cash.closing,
          t.debitTransfer,
          t.debitCash + d.cash.closing,
          '합계',
          t.creditCash + d.cash.opening,
          t.creditTransfer,
          creditTotal + d.cash.opening,
        ],
      },
    );
  }

  const model: ReportModel = {
    title: mode === 'day' ? '일계표' : '월계표',
    subtitle,
    groups: [
      { label: '차변', span: 3 },
      { label: '', span: 1 },
      { label: '대변', span: 3 },
    ],
    columns: [
      { header: '계', exportHeader: '차변 계', type: 'won' },
      { header: '대체', exportHeader: '차변 대체', type: 'won' },
      { header: '현금', exportHeader: '차변 현금', type: 'won' },
      { header: '계정과목', className: 'text-center', width: 26 },
      { header: '현금', exportHeader: '대변 현금', type: 'won' },
      { header: '대체', exportHeader: '대변 대체', type: 'won' },
      { header: '계', exportHeader: '대변 계', type: 'won' },
    ],
    rows: d && d.rows.length > 0 ? rows : [],
  };

  return (
    <ReportView
      model={model}
      loading={report.isPending}
      error={report.error}
      emptyText={`이 ${mode === 'day' ? '날' : '달'}에 전기한 전표가 없습니다.`}
      filters={
        <>
          <Select
            aria-label="일계표·월계표"
            className="w-28"
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
          >
            <option value="day">일계표</option>
            <option value="month">월계표</option>
          </Select>
          {mode === 'day' ? (
            <Input
              type="date"
              aria-label="일자"
              className="w-44"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          ) : (
            <Input
              type="month"
              aria-label="월"
              className="w-44"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          )}
        </>
      }
    />
  );
}
