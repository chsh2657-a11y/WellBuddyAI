'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CURRENCIES, currencyName } from '@wellbuddy/accounting-core';
import { Download, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ExcelImportDialog } from '@/components/excel-import-dialog';
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
import { todayIso } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { trimRate } from '../journals/_components/foreign-calc';

interface ExchangeRate {
  id: string;
  currency: string;
  rateDate: string;
  rate: string;
  unit: number;
}

export const RATES_KEY = ['exchange-rates'];

/** 환율: 직접 입력(같은 통화·날짜는 덮어씀), 엑셀 일괄 등록, 통화별 조회 */
export function ExchangeRatesCard() {
  const { data: session } = useSession();
  const writable = can(session, 'accounting', 'write');
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const rates = useQuery({
    queryKey: [...RATES_KEY, filter],
    queryFn: () =>
      apiFetch<ExchangeRate[]>(`/exchange-rates${filter ? `?currency=${filter}` : ''}`),
    // 엑셀 등록·다른 화면에서 바뀔 수 있어 들어올 때마다 새로 읽는다
    staleTime: 0,
  });
  const [draft, setDraft] = useState({ currency: 'USD', rateDate: todayIso(), rate: '' });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: RATES_KEY });
    void queryClient.invalidateQueries({ queryKey: ['fx-preview'] });
  };
  const onError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : '처리하지 못했습니다.');

  const save = useMutation({
    mutationFn: () => apiFetch<ExchangeRate>('/exchange-rates', { method: 'PUT', json: draft }),
    onSuccess: (r) => {
      toast.success(`${r.rateDate} ${r.currency} 환율을 저장했습니다.`);
      setDraft((d) => ({ ...d, rate: '' }));
      refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/exchange-rates/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError,
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start gap-3">
        <div className="grid gap-1">
          <CardTitle>환율</CardTitle>
          <CardDescription>
            외화 전표와 기말 외화평가에 씁니다. 엔화·동·루피아는 100 단위당 원화로 입력합니다.
          </CardDescription>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/api/exports/exchange-rates" download>
              <Download />
              엑셀 다운로드
            </a>
          </Button>
          {writable ? (
            <ExcelImportDialog
              spec="exchange-rates"
              title="환율"
              columns={[
                { key: 'currency', label: '통화' },
                { key: 'rateDate', label: '일자' },
                { key: 'rate', label: '환율' },
              ]}
              onImported={refresh}
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {writable ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Select
              aria-label="통화"
              className="w-44"
              value={draft.currency}
              onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} {c.name}
                </option>
              ))}
            </Select>
            <Input
              type="date"
              aria-label="환율 일자"
              className="w-40"
              value={draft.rateDate}
              onChange={(e) => setDraft({ ...draft, rateDate: e.target.value })}
              required
            />
            <Input
              aria-label="환율"
              placeholder="예: 1385.20"
              inputMode="decimal"
              className="w-36 text-right tabular-nums"
              value={draft.rate}
              onChange={(e) => setDraft({ ...draft, rate: e.target.value })}
              required
            />
            <Button type="submit" size="sm" disabled={save.isPending}>
              <Save />
              환율 저장
            </Button>
          </form>
        ) : null}
        <div className="flex items-center gap-2">
          <Select
            aria-label="통화 필터"
            className="w-44"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">전체 통화</option>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="max-h-96 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">일자</TableHead>
                <TableHead>통화</TableHead>
                <TableHead className="text-right">환율(원)</TableHead>
                {writable ? <TableHead className="w-12" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.data?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">{r.rateDate}</TableCell>
                  <TableCell>
                    {r.currency}{' '}
                    <span className="text-xs text-muted-foreground">
                      {currencyName(r.currency)}
                      {r.unit > 1 ? ` · ${r.unit}단위` : ''}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(r.rate).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}
                  </TableCell>
                  {writable ? (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${r.rateDate} ${r.currency} 환율 삭제`}
                        onClick={() =>
                          confirm(
                            `${r.rateDate} ${r.currency} ${trimRate(r.rate)} 환율을 삭제할까요?`,
                          ) && remove.mutate(r.id)
                        }
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rates.data?.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">등록된 환율이 없습니다.</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
