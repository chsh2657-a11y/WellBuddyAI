'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { STATEMENT_GROUPS, type StatementGroup } from '@wellbuddy/accounting-core';
import { History, Save, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Combobox } from '@/components/combobox';
import { WonInput } from '@/components/won-input';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { ApiError, apiFetch } from '@/lib/api';
import { formatWon, todayIso } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { type MasterData, useMasterData } from '../journals/_components/use-master-data';
import { spreadAnnual } from './budget-calc';

interface FiscalYear {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
}

interface BudgetLine {
  accountId: string;
  code: string;
  name: string;
  group: StatementGroup;
  months: number[];
  total: number;
}

interface Budget {
  fiscalYearId: string;
  fiscalYear: string;
  departmentId: string | null;
  periods: { periodNo: number; month: string }[];
  lines: BudgetLine[];
}

const BUDGETS_KEY = ['budgets'];

/** 예산 편성: 회계연도·부서별로 손익 계정의 월별 예산을 입력한다 */
export function BudgetsManager() {
  const { data: session } = useSession();
  const writable = can(session, 'accounting', 'write');
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
  const budget = useQuery({
    queryKey: [...BUDGETS_KEY, year?.id, departmentId],
    queryFn: () =>
      apiFetch<Budget>(
        `/budgets?fiscalYearId=${year!.id}${departmentId ? `&departmentId=${departmentId}` : ''}`,
      ),
    enabled: !!year,
    staleTime: 0,
  });

  if (years.data && years.data.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          회계연도가 없습니다. 회계기간·마감에서 회계연도를 먼저 만들어 주세요.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start gap-3">
        <div className="grid gap-1">
          <CardTitle>예산 편성</CardTitle>
          <CardDescription>
            수익 계정은 목표, 비용 계정은 한도로 월별 예산을 넣습니다. 부서를 고르지 않으면 부서
            미지정(전사 공통) 예산입니다. 예산 대비 실적은 장부·보고서에서 봅니다.
          </CardDescription>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            aria-label="회계연도"
            className="w-36"
            value={year?.id ?? ''}
            onChange={(e) => setYearId(e.target.value)}
          >
            {years.data?.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label} 회계연도
              </option>
            ))}
          </Select>
          <Select
            aria-label="부서"
            className="w-44"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <option value="">부서 미지정(전사)</option>
            {master.departmentItems.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
      </CardHeader>
      {budget.data && master.ready ? (
        <BudgetForm
          // 서버 값이 바뀌면(저장·연도·부서 변경) 입력 상태를 새로 만든다
          key={`${budget.data.fiscalYearId}:${departmentId}:${budget.dataUpdatedAt}`}
          budget={budget.data}
          departmentId={departmentId || null}
          master={master}
          writable={writable}
        />
      ) : null}
    </Card>
  );
}

function BudgetForm({
  budget,
  departmentId,
  master,
  writable,
}: {
  budget: Budget;
  departmentId: string | null;
  master: MasterData;
  writable: boolean;
}) {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<BudgetLine[]>(budget.lines);
  const plItems = useMemo(
    () =>
      master.accountItems.filter((i) => {
        const category = STATEMENT_GROUPS[master.accountById.get(i.id)!.group].category;
        return (
          (category === 'revenue' || category === 'expense') &&
          !lines.some((l) => l.accountId === i.id)
        );
      }),
    [master, lines],
  );

  const setMonth = (accountId: string, index: number, value: number) =>
    setLines((prev) =>
      prev.map((l) => {
        if (l.accountId !== accountId) return l;
        const months = l.months.map((m, i) => (i === index ? value : m));
        return { ...l, months, total: months.reduce((s, v) => s + v, 0) };
      }),
    );
  const setTotal = (accountId: string, total: number) =>
    setLines((prev) =>
      prev.map((l) =>
        l.accountId === accountId ? { ...l, months: spreadAnnual(total), total } : l,
      ),
    );
  const addAccount = (id: string | null) => {
    const account = id ? master.accountById.get(id) : undefined;
    if (!account) return;
    setLines((prev) =>
      [
        ...prev,
        {
          accountId: account.id,
          code: account.code,
          name: account.name,
          group: account.group,
          months: Array.from({ length: 12 }, () => 0),
          total: 0,
        },
      ].sort((a, b) => a.code.localeCompare(b.code)),
    );
  };

  const suggest = useMutation({
    mutationFn: () =>
      apiFetch<{ fiscalYear: string | null; lines: BudgetLine[] }>(
        `/budgets/suggest?fiscalYearId=${budget.fiscalYearId}${departmentId ? `&departmentId=${departmentId}` : ''}`,
      ),
    onSuccess: (r) => {
      if (!r.fiscalYear || r.lines.length === 0) {
        toast.info('불러올 전년도 실적이 없습니다.');
        return;
      }
      setLines((prev) => {
        const byId = new Map(prev.map((l) => [l.accountId, l]));
        for (const l of r.lines) byId.set(l.accountId, l);
        return [...byId.values()].sort((a, b) => a.code.localeCompare(b.code));
      });
      toast.success(`${r.fiscalYear} 회계연도 실적 ${r.lines.length}개 계정을 채웠습니다.`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '불러오지 못했습니다.'),
  });
  const save = useMutation({
    mutationFn: () =>
      apiFetch<Budget>('/budgets', {
        method: 'PUT',
        json: {
          fiscalYearId: budget.fiscalYearId,
          departmentId,
          lines: lines.map((l) => ({ accountId: l.accountId, months: l.months })),
        },
      }),
    onSuccess: () => {
      toast.success('예산을 저장했습니다.');
      void queryClient.invalidateQueries({ queryKey: BUDGETS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '저장하지 못했습니다.'),
  });

  const categoryTotal = (category: 'revenue' | 'expense') =>
    lines
      .filter((l) => STATEMENT_GROUPS[l.group].category === category)
      .reduce((s, l) => s + l.total, 0);

  return (
    <>
      <CardContent className="grid gap-3 px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[110rem] text-sm">
            <thead className="bg-surface-muted text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="sticky left-0 w-56 bg-surface-muted py-2 pl-5 text-left font-medium">
                  계정과목
                </th>
                {budget.periods.map((p) => (
                  <th key={p.periodNo} className="w-28 px-1 py-2 text-right font-medium">
                    {p.month}
                  </th>
                ))}
                <th className="w-32 px-1 py-2 text-right font-medium">연간 합계</th>
                {writable ? <th className="w-12 pr-5" /> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.accountId} className="border-b">
                  <td className="sticky left-0 bg-surface py-1 pl-5">
                    {l.code} {l.name}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {STATEMENT_GROUPS[l.group].category === 'revenue' ? '수익' : '비용'}
                    </span>
                  </td>
                  {l.months.map((m, i) => (
                    <td key={i} className="px-1 py-1">
                      <WonInput
                        aria-label={`${l.name} ${budget.periods[i]!.month}`}
                        className="h-9"
                        value={m}
                        disabled={!writable}
                        onFocus={(e) => e.currentTarget.select()}
                        onValueChange={(v) => setMonth(l.accountId, i, v)}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1">
                    <WonInput
                      aria-label={`${l.name} 연간 합계`}
                      className="h-9 font-medium"
                      title="연간 금액을 넣으면 12개월에 나눕니다"
                      value={l.total}
                      disabled={!writable}
                      onFocus={(e) => e.currentTarget.select()}
                      onValueChange={(v) => setTotal(l.accountId, v)}
                    />
                  </td>
                  {writable ? (
                    <td className="pr-5">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${l.name} 예산 삭제`}
                        onClick={() =>
                          setLines((prev) => prev.filter((x) => x.accountId !== l.accountId))
                        }
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {lines.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">
              편성한 예산이 없습니다. 계정을 추가하거나 전년도 실적을 불러오세요.
            </p>
          ) : null}
        </div>
        <p className="px-5 text-sm">
          수익 예산 {formatWon(categoryTotal('revenue'))}원 · 비용 예산{' '}
          {formatWon(categoryTotal('expense'))}원 · 예산 손익{' '}
          <strong>{formatWon(categoryTotal('revenue') - categoryTotal('expense'))}원</strong>
        </p>
      </CardContent>
      {writable ? (
        <CardFooter className="flex-wrap justify-between gap-2 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64">
              <Combobox
                aria-label="예산 계정 추가"
                placeholder="계정 추가(코드·이름)"
                items={plItems}
                value={null}
                onChange={(id) => addAccount(id)}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={suggest.isPending}
              onClick={() => suggest.mutate()}
            >
              <History />
              전년도 실적 불러오기
            </Button>
          </div>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            <Save />
            예산 저장
          </Button>
        </CardFooter>
      ) : null}
    </>
  );
}
