'use client';

import { SYSTEM_ACCOUNTS } from '@wellbuddy/accounting-core';
import { useState } from 'react';
import { Combobox } from '@/components/combobox';
import { Input } from '@/components/ui/input';
import { todayIso } from '@/lib/format';
import { useMasterData } from '../../journals/_components/use-master-data';
import { useReport, useSubtitle } from '../_components/report-hooks';
import { type ReportModel, ReportView } from '../_components/report-view';
import type { GeneralLedger } from '../_components/types';

/** 총계정원장: 회계연도의 월별 차변·대변·잔액 */
export function GeneralLedgerReport() {
  const data = useMasterData();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const selected = accountId ?? data.accountByCode.get(SYSTEM_ACCOUNTS.cash)?.id ?? null;
  const report = useReport<GeneralLedger>(
    'general-ledger',
    { accountId: selected ?? undefined, date },
    !!selected && !!date,
  );
  const d = report.data;
  const subtitle = useSubtitle(
    d
      ? `${d.account.code} ${d.account.name} · ${d.fiscalYear.label} 회계연도(${d.fiscalYear.startDate} ~ ${d.fiscalYear.endDate})`
      : '',
  );

  const model: ReportModel = {
    title: '총계정원장',
    subtitle,
    columns: [
      { header: '월', width: 12 },
      { header: '차변', type: 'won' },
      { header: '대변', type: 'won' },
      { header: '잔액', type: 'won' },
    ],
    rows: d
      ? [
          { kind: 'subtotal', cells: ['전기이월', null, null, d.opening] },
          ...d.months.map((m) => ({
            cells: [m.month, m.debit, m.credit, m.debit || m.credit ? m.balance : null],
          })),
          { kind: 'total', cells: ['합계', d.totals.debit, d.totals.credit, d.closing] },
        ]
      : [],
  };

  return (
    <ReportView
      model={model}
      loading={report.isPending}
      error={report.error}
      filters={
        <>
          <div className="w-60">
            <Combobox
              aria-label="계정과목"
              items={data.accountItems}
              value={selected}
              onChange={(id) => id && setAccountId(id)}
            />
          </div>
          <Input
            type="date"
            aria-label="기준일"
            title="이 날짜가 속한 회계연도"
            className="w-44"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </>
      }
    />
  );
}
