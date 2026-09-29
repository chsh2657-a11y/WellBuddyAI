'use client';

import { SYSTEM_ACCOUNTS } from '@wellbuddy/accounting-core';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useMasterData } from '../../journals/_components/use-master-data';
import { useCurrentFiscalYear, useReport, useSubtitle } from '../_components/report-hooks';
import { type ReportModel, ReportView } from '../_components/report-view';
import type { PartnerBalances } from '../_components/types';

/**
 * 거래처원장(거래처별 잔액). 거래처를 누르면 그 거래처의 원장(줄 단위)으로 간다.
 * 거래처가 필요한 계정(외상매출금·외상매입금·미수금·미지급금 등)만 고른다.
 */
export function PartnerReport() {
  const data = useMasterData();
  const year = useCurrentFiscalYear();
  const partnerAccounts = data.accounts.filter((a) => a.requiresPartner);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const from = range?.from ?? year.startDate;
  const to = range?.to ?? year.today;
  const selected =
    accountId ?? data.accountByCode.get(SYSTEM_ACCOUNTS.accountsReceivable)?.id ?? null;

  const report = useReport<PartnerBalances>(
    'partner-balances',
    { accountId: selected ?? undefined, from, to },
    !!selected && year.ready,
  );
  const d = report.data;
  const subtitle = useSubtitle(
    [d ? `${d.account.code} ${d.account.name}` : '', `${from} ~ ${to}`].filter(Boolean).join(' · '),
  );
  // 정상잔액이 차변인 계정(채권)은 차변이 증가, 대변 계정(채무)은 대변이 증가
  const debitNormal = d?.normalBalance !== 'credit';

  const model: ReportModel = {
    title: '거래처원장',
    subtitle,
    columns: [
      { header: '코드', width: 10 },
      { header: '거래처', width: 24 },
      { header: '이월 잔액', type: 'won' },
      { header: '증가', type: 'won' },
      { header: '감소', type: 'won' },
      { header: '잔액', type: 'won' },
    ],
    rows: d
      ? [
          ...d.rows.map((r) => ({
            cells: [
              r.partnerCode ?? '',
              r.partnerName,
              r.opening,
              debitNormal ? r.debit : r.credit,
              debitNormal ? r.credit : r.debit,
              r.closing,
            ],
            links: r.partnerId
              ? {
                  1: `/accounting/reports/ledger?${new URLSearchParams({
                    accountId: d.account.id,
                    partnerId: r.partnerId,
                    from,
                    to,
                  })}`,
                }
              : undefined,
          })),
          ...(d.rows.length > 0
            ? [
                {
                  kind: 'total' as const,
                  cells: [
                    '',
                    '합계',
                    d.totals.opening,
                    debitNormal ? d.totals.debit : d.totals.credit,
                    debitNormal ? d.totals.credit : d.totals.debit,
                    d.totals.closing,
                  ],
                },
              ]
            : []),
        ]
      : [],
  };

  return (
    <ReportView
      model={model}
      loading={report.isPending}
      error={report.error}
      emptyText="이 기간에 거래처 잔액이 없습니다."
      filters={
        <>
          <Select
            aria-label="계정과목"
            className="w-52"
            value={selected ?? ''}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {partnerAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </Select>
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
        </>
      }
    />
  );
}
