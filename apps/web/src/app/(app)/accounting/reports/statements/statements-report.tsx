'use client';

import type { StatementGroup } from '@wellbuddy/accounting-core';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useCurrentFiscalYear, useReport, useSubtitle } from '../_components/report-hooks';
import { type ReportModel, type ReportRow, ReportView } from '../_components/report-view';
import type { BalanceSheet, IncomeStatement, StatementSection } from '../_components/types';

type Kind = 'balance-sheet' | 'income-statement';

const COLUMNS: ReportModel['columns'] = [
  { header: '과목', width: 30 },
  { header: '금액', exportHeader: '금액(내역)', type: 'won' },
  { header: '', exportHeader: '금액(합계)', type: 'won' },
];

/** 구분 합계는 오른쪽 열, 계정 금액은 가운데 열(재무제표 표기) */
function sectionRows(section: StatementSection, label = section.label): ReportRow[] {
  return [
    { kind: 'subtotal', cells: [label, null, section.total] },
    ...section.lines.map((l) => ({
      indent: true,
      cells: [l.code ? `${l.code} ${l.name}` : l.name, l.amount, null] as ReportRow['cells'],
    })),
  ];
}

function balanceSheetRows(d: BalanceSheet): ReportRow[] {
  const part = (title: string, sections: StatementSection[], total: number, totalLabel: string) => [
    { kind: 'section' as const, cells: [title, null, null] },
    ...sections.flatMap((s) => sectionRows(s)),
    { kind: 'total' as const, cells: [totalLabel, null, total] },
  ];
  return [
    ...part('자산', d.assets, d.totalAssets, '자산총계'),
    ...part('부채', d.liabilities, d.totalLiabilities, '부채총계'),
    ...part('자본', d.equity, d.totalEquity, '자본총계'),
    { kind: 'total', cells: ['부채와 자본 총계', null, d.totalLiabilities + d.totalEquity] },
  ];
}

function incomeStatementRows(d: IncomeStatement): ReportRow[] {
  const section = (...groups: StatementGroup[]) =>
    d.sections.filter((s) => groups.includes(s.group));
  const block = (label: string, total: number, ...groups: StatementGroup[]): ReportRow[] => [
    { kind: 'subtotal', cells: [label, null, total] },
    ...section(...groups).flatMap((s) =>
      s.lines.map((l) => ({ indent: true, cells: [`${l.code} ${l.name}`, l.amount, null] })),
    ),
  ];
  return [
    ...block('Ⅰ. 매출액', d.revenue, 'revenue'),
    ...block('Ⅱ. 매출원가', d.costOfSales, 'cost_of_sales', 'manufacturing_cost'),
    { kind: 'section', cells: ['Ⅲ. 매출총이익', null, d.grossProfit] },
    ...block('Ⅳ. 판매비와관리비', d.sga, 'sga'),
    { kind: 'section', cells: ['Ⅴ. 영업이익', null, d.operatingIncome] },
    ...block('Ⅵ. 영업외수익', d.nonOperatingIncome, 'non_operating_income'),
    ...block('Ⅶ. 영업외비용', d.nonOperatingExpense, 'non_operating_expense'),
    { kind: 'section', cells: ['Ⅷ. 법인세비용차감전순이익', null, d.incomeBeforeTax] },
    ...block('Ⅸ. 법인세비용', d.incomeTax, 'income_tax'),
    { kind: 'total', cells: ['Ⅹ. 당기순이익', null, d.netIncome] },
  ];
}

/** 재무상태표(기준일)·손익계산서(기간) */
export function StatementsReport({ initial = 'balance-sheet' }: { initial?: Kind }) {
  const year = useCurrentFiscalYear();
  const [kind, setKind] = useState<Kind>(initial);
  const [date, setDate] = useState(year.today);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const from = range?.from ?? year.startDate;
  const to = range?.to ?? year.today;

  const bs = useReport<BalanceSheet>('balance-sheet', { date }, kind === 'balance-sheet');
  const is = useReport<IncomeStatement>(
    'income-statement',
    { from, to },
    kind === 'income-statement' && year.ready,
  );
  const subtitle = useSubtitle(kind === 'balance-sheet' ? `${date} 현재` : `${from} ~ ${to}`);
  const active = kind === 'balance-sheet' ? bs : is;

  const model: ReportModel = {
    title: kind === 'balance-sheet' ? '재무상태표' : '손익계산서',
    subtitle,
    columns: COLUMNS,
    rows:
      kind === 'balance-sheet'
        ? bs.data
          ? balanceSheetRows(bs.data)
          : []
        : is.data
          ? incomeStatementRows(is.data)
          : [],
  };

  return (
    <ReportView
      model={model}
      loading={active.isPending}
      error={active.error}
      badge={
        kind === 'balance-sheet' && bs.data ? (
          bs.data.balanced ? (
            <Badge variant="success">자산 = 부채 + 자본</Badge>
          ) : (
            <Badge variant="danger">대차 불일치</Badge>
          )
        ) : null
      }
      filters={
        <>
          <div className="flex rounded-md border p-0.5" role="tablist" aria-label="재무제표">
            {(
              [
                ['balance-sheet', '재무상태표'],
                ['income-statement', '손익계산서'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                className={cn(
                  'rounded px-3 py-1.5 text-sm font-medium',
                  kind === k
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setKind(k)}
              >
                {label}
              </button>
            ))}
          </div>
          {kind === 'balance-sheet' ? (
            <Input
              type="date"
              aria-label="기준일"
              className="w-44"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          ) : (
            <div className="flex items-center gap-1">
              <Input
                type="date"
                aria-label="시작일"
                className="w-40"
                value={from}
                onChange={(e) => setRange({ from: e.target.value, to })}
              />
              <span className="text-muted-foreground">~</span>
              <Input
                type="date"
                aria-label="종료일"
                className="w-40"
                value={to}
                onChange={(e) => setRange({ from, to: e.target.value })}
              />
            </div>
          )}
        </>
      }
    />
  );
}
