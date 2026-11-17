'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { todayIso } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useReport, useSubtitle } from '../_components/report-hooks';
import { type ReportModel, ReportView } from '../_components/report-view';
import type { Aging } from '../_components/types';

type Kind = 'receivable' | 'payable';

/**
 * 채권·채무 잔액과 연령분석. 받은(갚은) 돈은 오래된 것부터 지운 것으로 보고,
 * 남은 잔액을 발생일로부터 지난 날수 구간에 나눈다.
 */
export function AgingReport() {
  const [kind, setKind] = useState<Kind>('receivable');
  const [date, setDate] = useState(todayIso());
  const report = useReport<Aging>('aging', { kind, date }, !!date);
  const d = report.data;
  const subtitle = useSubtitle(
    [`${date} 현재`, d?.accounts.map((a) => a.name).join('·')].filter(Boolean).join(' · '),
  );
  const labels = d?.bucketLabels ?? [];

  const model: ReportModel = {
    title: kind === 'receivable' ? '채권 연령분석' : '채무 연령분석',
    subtitle,
    columns: [
      { header: '거래처', width: 24 },
      { header: kind === 'receivable' ? '받을 돈' : '줄 돈', type: 'won' },
      ...labels.map((l) => ({ header: l, type: 'won' as const })),
    ],
    rows: d
      ? [
          ...d.rows.map((r) => ({ cells: [r.partnerName, r.balance, ...r.buckets] })),
          ...(d.rows.length > 0
            ? [{ kind: 'total' as const, cells: ['합계', d.totals.balance, ...d.totals.buckets] }]
            : []),
        ]
      : [],
  };

  return (
    <ReportView
      model={model}
      loading={report.isPending}
      error={report.error}
      emptyText={kind === 'receivable' ? '남은 채권이 없습니다.' : '남은 채무가 없습니다.'}
      filters={
        <>
          <div className="flex rounded-md border p-0.5" role="tablist" aria-label="채권·채무">
            {(
              [
                ['receivable', '채권(미수)'],
                ['payable', '채무(미지급)'],
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
          <Input
            type="date"
            aria-label="기준일"
            className="w-44"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </>
      }
    />
  );
}
