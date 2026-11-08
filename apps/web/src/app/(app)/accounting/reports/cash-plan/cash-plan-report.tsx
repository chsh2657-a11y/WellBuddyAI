'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays } from '@wellbuddy/accounting-core';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Combobox } from '@/components/combobox';
import { WonInput } from '@/components/won-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, apiFetch } from '@/lib/api';
import { formatWon, todayIso } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { useMasterData } from '../../journals/_components/use-master-data';
import { useReport, useSubtitle } from '../_components/report-hooks';
import { type ReportModel, type ReportRow, ReportView } from '../_components/report-view';

interface PlanItem {
  source: 'plan' | 'note';
  id: string;
  date: string;
  direction: 'in' | 'out';
  amount: number;
  description: string;
  partnerName: string | null;
}

interface CashPlanData {
  from: string;
  to: string;
  opening: number;
  days: { date: string; inflow: number; outflow: number; balance: number; items: PlanItem[] }[];
  inflow: number;
  outflow: number;
  closing: number;
  minBalance: number;
  minDate: string | null;
  shortageDate: string | null;
}

interface CashPlan {
  id: string;
  planDate: string;
  direction: 'in' | 'out';
  amount: number;
  description: string;
  partnerId: string | null;
  partnerName: string | null;
  done: boolean;
}

const PLANS_KEY = ['cash-plans'];

/** 자금계획: 현재 현금·예금 잔액에 예정 입출금과 어음 만기를 더한 일자별 예상 잔액 */
export function CashPlanReport() {
  const { data: session } = useSession();
  const writable = can(session, 'accounting', 'write');
  const today = todayIso();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 30));
  const report = useReport<CashPlanData>('cash-plan', { from, to }, !!from && !!to && from <= to);
  const d = report.data;
  const subtitle = useSubtitle(`${from} ~ ${to}`);

  let running = d?.opening ?? 0;
  const rows: ReportRow[] = d
    ? [
        {
          kind: 'subtotal',
          cells: [addDays(from, -1), '현재 잔액(현금·예금)', null, null, null, d.opening],
        },
        ...d.days.flatMap((day) =>
          day.items.map((item) => {
            running += item.direction === 'in' ? item.amount : -item.amount;
            return {
              cells: [
                item.date,
                item.description,
                item.partnerName ?? '',
                item.direction === 'in' ? item.amount : 0,
                item.direction === 'out' ? item.amount : 0,
                running,
              ],
            };
          }),
        ),
        { kind: 'total', cells: ['합계', null, null, d.inflow, d.outflow, d.closing] },
      ]
    : [];
  const model: ReportModel = {
    title: '자금계획',
    subtitle,
    columns: [
      { header: '일자', width: 12 },
      { header: '내용', width: 30 },
      { header: '거래처', width: 16 },
      { header: '입금 예정', type: 'won' },
      { header: '출금 예정', type: 'won' },
      { header: '예상 잔액', type: 'won' },
    ],
    rows,
  };

  return (
    <div className="grid gap-4">
      <ReportView
        model={model}
        loading={report.isPending}
        error={report.error}
        badge={
          d?.shortageDate ? (
            <Badge variant="danger">{d.shortageDate}부터 자금 부족 예상</Badge>
          ) : d ? (
            <Badge variant="success">기간 중 최저 {formatWon(d.minBalance)}원</Badge>
          ) : null
        }
        filters={
          <>
            <Input
              type="date"
              aria-label="시작일"
              className="w-44"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              type="date"
              aria-label="종료일"
              className="w-44"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </>
        }
      />
      <PlanItems from={from} to={to} writable={writable} />
    </div>
  );
}

/** 예정 입출금 등록·완료 표시·삭제 */
function PlanItems({ from, to, writable }: { from: string; to: string; writable: boolean }) {
  const master = useMasterData();
  const queryClient = useQueryClient();
  const plans = useQuery({
    queryKey: [...PLANS_KEY, from, to],
    queryFn: () => apiFetch<CashPlan[]>(`/cash-plans?from=${from}&to=${to}`),
    enabled: from <= to,
    staleTime: 0,
  });
  const blank = () => ({
    planDate: todayIso(),
    direction: 'out' as 'in' | 'out',
    amount: 0,
    description: '',
    partnerId: null as string | null,
  });
  const [draft, setDraft] = useState(blank);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: PLANS_KEY });
    void queryClient.invalidateQueries({ queryKey: ['reports'] });
  };
  const onError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : '처리하지 못했습니다.');
  const create = useMutation({
    mutationFn: () => apiFetch<CashPlan>('/cash-plans', { method: 'POST', json: draft }),
    onSuccess: () => {
      toast.success('예정 입출금을 추가했습니다.');
      setDraft(blank());
      refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      apiFetch(`/cash-plans/${id}`, { method: 'PATCH', json: { done } }),
    onSettled: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/cash-plans/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError,
  });

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-base">예정 입출금</CardTitle>
        <CardDescription>
          받을 돈·줄 돈 예정을 넣으면 자금계획에 더합니다. 어음 만기는 어음관리에서 자동으로
          들어옵니다. 실제로 입출금했으면 완료로 표시해 계획에서 뺍니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {writable ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Input
              type="date"
              aria-label="예정일"
              className="w-40"
              value={draft.planDate}
              onChange={(e) => setDraft({ ...draft, planDate: e.target.value })}
              required
            />
            <Select
              aria-label="입출금"
              className="w-24"
              value={draft.direction}
              onChange={(e) => setDraft({ ...draft, direction: e.target.value as 'in' | 'out' })}
            >
              <option value="in">입금</option>
              <option value="out">출금</option>
            </Select>
            <WonInput
              aria-label="예정 금액"
              className="w-36"
              value={draft.amount}
              onValueChange={(amount) => setDraft({ ...draft, amount })}
            />
            <Input
              aria-label="내용"
              placeholder="내용(예: 3월 급여)"
              className="min-w-48 flex-1"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              required
            />
            <div className="w-48">
              <Combobox
                aria-label="예정 거래처"
                placeholder="거래처(선택)"
                items={master.partnerItems}
                value={draft.partnerId}
                onChange={(partnerId) => setDraft({ ...draft, partnerId })}
              />
            </div>
            <Button type="submit" size="sm" disabled={create.isPending}>
              <Plus />
              추가
            </Button>
          </form>
        ) : null}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">예정일</TableHead>
                <TableHead className="w-16">구분</TableHead>
                <TableHead>내용</TableHead>
                <TableHead>거래처</TableHead>
                <TableHead className="text-right">금액</TableHead>
                <TableHead className="w-20">완료</TableHead>
                {writable ? <TableHead className="w-12" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.data?.map((p) => (
                <TableRow key={p.id} className={p.done ? 'text-muted-foreground line-through' : ''}>
                  <TableCell className="tabular-nums">{p.planDate}</TableCell>
                  <TableCell>
                    <Badge variant={p.direction === 'in' ? 'success' : 'warning'}>
                      {p.direction === 'in' ? '입금' : '출금'}
                    </Badge>
                  </TableCell>
                  <TableCell>{p.description}</TableCell>
                  <TableCell className="text-xs">{p.partnerName ?? ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatWon(p.amount)}</TableCell>
                  <TableCell>
                    <DoneCheckbox
                      // 서버 값이 바뀌면 새로 만든다
                      key={`${p.id}:${p.done}`}
                      label={`${p.description} 완료`}
                      initial={p.done}
                      disabled={!writable}
                      onToggle={(done) => update.mutate({ id: p.id, done })}
                    />
                  </TableCell>
                  {writable ? (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${p.description} 삭제`}
                        onClick={() => remove.mutate(p.id)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {plans.data?.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">기간 안에 예정 입출금이 없습니다.</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** 완료 표시: 누르면 바로 바뀌고, 서버에 저장한 뒤 목록을 다시 읽는다 */
function DoneCheckbox({
  label,
  initial,
  disabled,
  onToggle,
}: {
  label: string;
  initial: boolean;
  disabled: boolean;
  onToggle: (done: boolean) => void;
}) {
  const [checked, setChecked] = useState(initial);
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => {
        setChecked(e.target.checked);
        onToggle(e.target.checked);
      }}
    />
  );
}
