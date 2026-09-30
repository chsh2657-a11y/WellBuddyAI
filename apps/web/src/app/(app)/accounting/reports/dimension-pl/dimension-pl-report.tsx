'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useCurrentFiscalYear, useReport, useSubtitle } from '../_components/report-hooks';
import { type ReportModel, type ReportRow, ReportView } from '../_components/report-view';

type Dimension = 'department' | 'project';

interface DimensionPl {
  from: string;
  to: string;
  dimension: Dimension;
  columns: { id: string | null; code: string | null; name: string }[];
  lines: {
    accountId: string;
    code: string;
    name: string;
    category: 'revenue' | 'expense';
    amounts: number[];
    total: number;
  }[];
  revenue: number[];
  expense: number[];
  profit: number[];
  totals: { revenue: number; expense: number; profit: number };
}

const LABELS: Record<Dimension, string> = { department: '부서', project: '프로젝트' };

/** 부서·프로젝트별 손익: 손익 계정을 전표 줄의 부서·프로젝트별로 나눠 본다 */
export function DimensionPlReport() {
  const fy = useCurrentFiscalYear();
  const [dimension, setDimension] = useState<Dimension>('department');
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const range = { from: from ?? fy.startDate, to: to ?? fy.today };
  const report = useReport<DimensionPl>(
    'dimension-pl',
    { ...range, dimension },
    fy.ready && range.from <= range.to,
  );
  const d = report.data;
  const subtitle = useSubtitle(`${range.from} ~ ${range.to}`);
  const blanks = (d?.columns ?? []).map(() => null);

  const section = (
    category: 'revenue' | 'expense',
    label: string,
    totals: number[],
  ): ReportRow[] => {
    const lines = d!.lines.filter((l) => l.category === category);
    if (lines.length === 0) return [];
    return [
      { kind: 'section', cells: [label, ...blanks, null] },
      ...lines.map((l) => ({
        indent: true,
        cells: [`${l.code} ${l.name}`, ...l.amounts, l.total],
      })),
      {
        kind: 'subtotal',
        cells: [
          `${label} 합계`,
          ...totals,
          category === 'revenue' ? d!.totals.revenue : d!.totals.expense,
        ],
      },
    ];
  };

  const model: ReportModel = {
    title: `${LABELS[dimension]}별 손익`,
    subtitle,
    columns: [
      { header: '계정과목', width: 26 },
      ...(d?.columns ?? []).map((c) => ({ header: c.name, type: 'won' as const })),
      { header: '합계', type: 'won' },
    ],
    rows: d
      ? [
          ...section('revenue', '수익', d.revenue),
          ...section('expense', '비용', d.expense),
          ...(d.lines.length > 0
            ? [{ kind: 'total' as const, cells: ['손익', ...d.profit, d.totals.profit] }]
            : []),
        ]
      : [],
  };

  return (
    <ReportView
      model={model}
      loading={report.isPending}
      error={report.error}
      emptyText="기간 안에 손익 전표가 없습니다."
      filters={
        <>
          <div className="flex rounded-md border p-0.5" role="tablist" aria-label="나눔 기준">
            {(['department', 'project'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={dimension === k}
                className={cn(
                  'rounded px-3 py-1.5 text-sm font-medium',
                  dimension === k
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setDimension(k)}
              >
                {LABELS[k]}별
              </button>
            ))}
          </div>
          <Input
            type="date"
            aria-label="시작일"
            className="w-44"
            value={range.from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Input
            type="date"
            aria-label="종료일"
            className="w-44"
            value={range.to}
            onChange={(e) => setTo(e.target.value)}
          />
        </>
      }
    />
  );
}
