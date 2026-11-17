'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '@/components/ui/select';
import { apiFetch } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { useMasterData } from '../../journals/_components/use-master-data';
import { useReport, useSubtitle } from '../_components/report-hooks';
import { type ReportModel, type ReportRow, ReportView } from '../_components/report-view';

interface FiscalYear {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
}

interface Amounts {
  budget: number;
  budgetToDate: number;
  actualToDate: number;
}

interface BudgetReportData {
  fiscalYear: string;
  departmentId: string | null;
  throughPeriod: number;
  throughMonth: string;
  lines: (Amounts & {
    accountId: string;
    code: string;
    name: string;
    category: 'revenue' | 'expense';
    variance: number;
    rate: number | null;
    exceeded: boolean;
  })[];
  revenue: Amounts;
  expense: Amounts;
  profit: Amounts;
}

const rateText = (actual: number, budget: number) =>
  budget > 0 ? `${(Math.round((actual / budget) * 1000) / 10).toFixed(1)}%` : '';

/** 예산 대비 실적: 기준월까지 누계 예산·실적, 차이, 집행률(비용 초과 표시) */
export function BudgetReport() {
  const master = useMasterData();
  const years = useQuery({
    queryKey: ['fiscal-years'],
    queryFn: () => apiFetch<FiscalYear[]>('/fiscal-years'),
  });
  const today = todayIso();
  const [yearId, setYearId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState('');
  const year =
    years.data?.find((y) => y.id === yearId) ??
    years.data?.find((y) => y.startDate <= today && today <= y.endDate) ??
    years.data?.[0];
  // 기본 기준월: 올해 회계연도면 이번 달, 아니면 12번째 달
  const defaultPeriod =
    year && year.startDate <= today && today <= year.endDate
      ? (Number(today.slice(0, 4)) - Number(year.startDate.slice(0, 4))) * 12 +
        Number(today.slice(5, 7)) -
        Number(year.startDate.slice(5, 7)) +
        1
      : 12;
  const [period, setPeriod] = useState<number | null>(null);
  const through = period ?? defaultPeriod;

  const report = useReport<BudgetReportData>(
    'budget-vs-actual',
    {
      fiscalYearId: year?.id,
      departmentId: departmentId || undefined,
      throughPeriod: String(through),
    },
    !!year,
  );
  const d = report.data;
  const deptName = departmentId
    ? (master.departmentItems.find((x) => x.id === departmentId)?.name ?? '')
    : '전사';
  const subtitle = useSubtitle(
    d ? `${d.fiscalYear} 회계연도 · ${deptName} · ${d.throughMonth}까지 누계` : '',
  );

  const section = (
    category: 'revenue' | 'expense',
    label: string,
    totals: Amounts,
  ): ReportRow[] => {
    const lines = d!.lines.filter((l) => l.category === category);
    if (lines.length === 0) return [];
    return [
      { kind: 'section', cells: [label, null, null, null, null, null, null] },
      ...lines.map((l) => ({
        indent: true,
        cells: [
          `${l.code} ${l.name}`,
          l.budget,
          l.budgetToDate,
          l.actualToDate,
          l.variance,
          l.rate === null ? '' : `${l.rate.toFixed(1)}%`,
          l.exceeded ? '예산 초과' : '',
        ],
      })),
      {
        kind: 'subtotal',
        cells: [
          `${label} 합계`,
          totals.budget,
          totals.budgetToDate,
          totals.actualToDate,
          totals.budgetToDate - totals.actualToDate,
          rateText(totals.actualToDate, totals.budgetToDate),
          '',
        ],
      },
    ];
  };

  const model: ReportModel = {
    title: '예산 대비 실적',
    subtitle,
    columns: [
      { header: '계정과목', width: 26 },
      { header: '연간 예산', type: 'won' },
      { header: '누계 예산', type: 'won' },
      { header: '누계 실적', type: 'won' },
      { header: '차이(예산−실적)', type: 'won' },
      { header: '집행률', className: 'text-right' },
      { header: '비고' },
    ],
    rows: d
      ? [
          ...section('revenue', '수익', d.revenue),
          ...section('expense', '비용', d.expense),
          ...(d.lines.length > 0
            ? [
                {
                  kind: 'total' as const,
                  cells: [
                    '손익(수익 − 비용)',
                    d.profit.budget,
                    d.profit.budgetToDate,
                    d.profit.actualToDate,
                    d.profit.budgetToDate - d.profit.actualToDate,
                    '',
                    '',
                  ],
                },
              ]
            : []),
        ]
      : [],
  };

  const months = year
    ? Array.from({ length: 12 }, (_, i) => {
        const m = Number(year.startDate.slice(5, 7)) + i;
        const y = Number(year.startDate.slice(0, 4)) + Math.floor((m - 1) / 12);
        return `${y}-${String(((m - 1) % 12) + 1).padStart(2, '0')}`;
      })
    : [];

  return (
    <ReportView
      model={model}
      loading={report.isPending}
      error={report.error}
      emptyText="편성한 예산이나 손익 실적이 없습니다. 회계 > 예산에서 편성해 주세요."
      filters={
        <>
          <Select
            aria-label="회계연도"
            className="w-36"
            value={year?.id ?? ''}
            onChange={(e) => {
              setYearId(e.target.value);
              setPeriod(null);
            }}
          >
            {years.data?.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label} 회계연도
              </option>
            ))}
          </Select>
          <Select
            aria-label="부서"
            className="w-40"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <option value="">전사</option>
            {master.departmentItems.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="기준월"
            className="w-40"
            value={through}
            onChange={(e) => setPeriod(Number(e.target.value))}
          >
            {months.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}까지
              </option>
            ))}
          </Select>
        </>
      }
    />
  );
}
