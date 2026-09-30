'use client';

import { SYSTEM_ACCOUNTS } from '@wellbuddy/accounting-core';
import { useState } from 'react';
import { Combobox } from '@/components/combobox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useMasterData } from '../../journals/_components/use-master-data';
import { currentMonthRange, useReport, useSubtitle } from '../_components/report-hooks';
import { type ReportModel, type ReportRow, ReportView } from '../_components/report-view';
import type { AccountLedger } from '../_components/types';

/** 현금출납장에서 고를 수 있는 계정(현금·예금) */
const CASH_CODES = [SYSTEM_ACCOUNTS.cash, '102', SYSTEM_ACCOUNTS.bankDeposit];

export interface LedgerInitial {
  accountId?: string;
  partnerId?: string;
  from?: string;
  to?: string;
}

/**
 * 계정별원장(mode=account) · 현금출납장(mode=cash).
 * 기간 전 잔액(이월)에서 시작해 줄마다 잔액을 누적하고, 달이 바뀌면 월계·누계를 넣는다.
 */
export function LedgerReport({
  mode,
  initial = {},
}: {
  mode: 'account' | 'cash';
  initial?: LedgerInitial;
}) {
  const data = useMasterData();
  const month = currentMonthRange();
  const [from, setFrom] = useState(initial.from ?? month.from);
  const [to, setTo] = useState(initial.to ?? month.to);
  const [accountId, setAccountId] = useState<string | null>(initial.accountId ?? null);
  const [partnerId, setPartnerId] = useState<string | null>(initial.partnerId ?? null);

  const cashAccounts = CASH_CODES.flatMap((c) => data.accountByCode.get(c) ?? []);
  const effectiveAccount = accountId ?? (mode === 'cash' ? (cashAccounts[0]?.id ?? null) : null);

  const report = useReport<AccountLedger>(
    'account-ledger',
    { accountId: effectiveAccount ?? undefined, partnerId: partnerId ?? undefined, from, to },
    !!effectiveAccount && !!from && !!to,
  );
  const d = report.data;
  const subtitle = useSubtitle(
    [d ? `${d.account.code} ${d.account.name}` : '', d?.partner?.name ?? '', `${from} ~ ${to}`]
      .filter(Boolean)
      .join(' · '),
  );
  const isCash = mode === 'cash';
  const showPartner = !partnerId;

  const rows: ReportRow[] = [];
  if (d) {
    const row = (
      date: string,
      number: string,
      text: string,
      counter: string,
      partner: string,
      debit: number | null,
      credit: number | null,
      balance: number | null,
    ) =>
      isCash
        ? [date, number, text, counter, partner, debit, credit, balance]
        : [date, number, text, counter, ...(showPartner ? [partner] : []), debit, credit, balance];

    rows.push({
      kind: 'subtotal',
      cells: row(from, '', '이월 잔액', '', '', null, null, d.opening),
    });
    let monthKey = '';
    let monthDebit = 0;
    let monthCredit = 0;
    let cumDebit = 0;
    let cumCredit = 0;
    const multiMonth = from.slice(0, 7) !== to.slice(0, 7);
    const closeMonth = () => {
      if (!multiMonth || !monthKey) return;
      rows.push({
        kind: 'subtotal',
        cells: row('', '', `[${monthKey} 월계]`, '', '', monthDebit, monthCredit, null),
      });
      rows.push({
        kind: 'subtotal',
        cells: row('', '', '[누계]', '', '', cumDebit, cumCredit, null),
      });
    };
    for (const l of d.rows) {
      const key = l.entryDate.slice(0, 7);
      if (key !== monthKey) {
        closeMonth();
        monthKey = key;
        monthDebit = 0;
        monthCredit = 0;
      }
      monthDebit += l.debit;
      monthCredit += l.credit;
      cumDebit += l.debit;
      cumCredit += l.credit;
      rows.push({
        cells: row(
          l.entryDate,
          l.number,
          l.memo || l.description || '',
          l.counterAccount,
          l.partnerName ?? '',
          l.debit,
          l.credit,
          l.balance,
        ),
        links: { 1: `/accounting/journals/${l.entryId}` },
      });
    }
    closeMonth();
    rows.push({
      kind: 'total',
      cells: row('', '', '합계', '', '', d.totals.debit, d.totals.credit, d.closing),
    });
  }

  const debitLabel = isCash ? '입금' : '차변';
  const creditLabel = isCash ? '출금' : '대변';
  const model: ReportModel = {
    title: isCash ? '현금출납장' : partnerId ? '거래처원장' : '계정별원장',
    subtitle,
    columns: [
      { header: '일자', width: 12 },
      { header: '전표번호', width: 16 },
      { header: '적요', width: 30 },
      { header: '상대계정', width: 16 },
      ...(isCash || showPartner ? [{ header: '거래처', width: 16 }] : []),
      { header: debitLabel, type: 'won' as const },
      { header: creditLabel, type: 'won' as const },
      { header: '잔액', type: 'won' as const },
    ],
    rows,
  };

  return (
    <ReportView
      model={model}
      loading={!!effectiveAccount && report.isPending}
      error={report.error}
      emptyText="계정과목을 선택해 주세요."
      filters={
        <>
          {isCash ? (
            <Select
              aria-label="현금·예금 계정"
              className="w-44"
              value={effectiveAccount ?? ''}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {cashAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </Select>
          ) : (
            <div className="w-60">
              <Combobox
                aria-label="계정과목"
                placeholder="계정 선택(코드·이름·초성)"
                items={data.accountItems}
                value={accountId}
                onChange={(id) => setAccountId(id)}
              />
            </div>
          )}
          {!isCash ? (
            <div className="w-52">
              <Combobox
                aria-label="거래처"
                placeholder="전체 거래처"
                items={data.partnerItems}
                value={partnerId}
                onChange={(id) => setPartnerId(id)}
              />
            </div>
          ) : null}
          <div className="flex items-center gap-1">
            <Input
              type="date"
              aria-label="시작일"
              className="w-40"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="text-muted-foreground">~</span>
            <Input
              type="date"
              aria-label="종료일"
              className="w-40"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </>
      }
    />
  );
}
