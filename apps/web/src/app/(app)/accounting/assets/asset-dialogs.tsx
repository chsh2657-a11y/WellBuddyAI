'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { disposalProfit } from '@wellbuddy/accounting-core';
import { useState } from 'react';
import { toast } from 'sonner';
import { Combobox } from '@/components/combobox';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { WonInput } from '@/components/won-input';
import { ApiError, apiFetch } from '@/lib/api';
import { formatWon, todayIso } from '@/lib/format';
import { useMasterData } from '../journals/_components/use-master-data';
import type { FixedAsset, ScheduleMonth } from './types';

/** 내용연수 전체 월별 상각 일정과 실제 반영액 */
export function ScheduleDialog({
  asset,
  onOpenChange,
}: {
  asset: FixedAsset;
  onOpenChange: (open: boolean) => void;
}) {
  const schedule = useQuery({
    queryKey: ['fixed-assets', asset.id, 'schedule'],
    queryFn: () => apiFetch<ScheduleMonth[]>(`/fixed-assets/${asset.id}/schedule`),
    staleTime: 0,
  });
  const total = schedule.data?.reduce((s, m) => s + m.amount, 0) ?? 0;
  const booked = schedule.data?.reduce((s, m) => s + (m.booked ?? 0), 0) ?? 0;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {asset.code} {asset.name} 상각 일정
          </DialogTitle>
          <DialogDescription>
            취득가 {formatWon(asset.cost)}원 · 반영 {formatWon(booked)}원 / 전체 {formatWon(total)}
            원
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>월</TableHead>
                <TableHead className="text-right">상각액</TableHead>
                <TableHead className="text-right">누계액</TableHead>
                <TableHead className="text-right">장부가</TableHead>
                <TableHead className="text-right">반영</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedule.data?.map((m) => (
                <TableRow key={m.month}>
                  <TableCell className="tabular-nums">{m.month}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatWon(m.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatWon(m.accumulated)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatWon(m.bookValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-primary">
                    {m.booked === null ? '' : formatWon(m.booked)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>합계</TableCell>
                <TableCell className="text-right tabular-nums">{formatWon(total)}</TableCell>
                <TableCell colSpan={2} />
                <TableCell className="text-right tabular-nums">{formatWon(booked)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 매각·폐기 처분 */
export function DisposeDialog({
  asset,
  onOpenChange,
  onDone,
}: {
  asset: FixedAsset;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const master = useMasterData();
  const [disposedOn, setDisposedOn] = useState(todayIso());
  const [proceeds, setProceeds] = useState(0);
  const [accountId, setAccountId] = useState<string | null>(
    () => master.accountByCode.get('120')?.id ?? null,
  );
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const profit = disposalProfit(asset.cost, asset.accumulated, proceeds);
  const needsPartner = !!accountId && master.accountById.get(accountId)?.requiresPartner;

  const dispose = useMutation({
    mutationFn: () =>
      apiFetch<FixedAsset>(`/fixed-assets/${asset.id}/dispose`, {
        method: 'POST',
        json: {
          disposedOn,
          proceeds,
          proceedsAccountId: proceeds > 0 ? accountId : null,
          partnerId: proceeds > 0 ? partnerId : null,
        },
      }),
    onSuccess: () => {
      toast.success(`${asset.name}을(를) 처분하고 전표를 전기했습니다.`);
      onDone();
      onOpenChange(false);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : '처분하지 못했습니다.'),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{asset.name} 처분</DialogTitle>
          <DialogDescription>
            처분일이 속한 달까지 감가상각을 먼저 실행해 두어야 장부가가 정확합니다. 현재 장부가{' '}
            {formatWon(asset.bookValue)}원(누계 {formatWon(asset.accumulated)}원).
          </DialogDescription>
        </DialogHeader>
        <form
          id="dispose-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            dispose.mutate();
          }}
        >
          <FormField id="disposed-on" label="처분일">
            <Input
              id="disposed-on"
              type="date"
              value={disposedOn}
              onChange={(e) => setDisposedOn(e.target.value)}
              required
            />
          </FormField>
          <FormField id="proceeds" label="처분가액" hint="폐기하면 0">
            <WonInput id="proceeds" value={proceeds} onValueChange={setProceeds} />
          </FormField>
          {proceeds > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="proceeds-account" label="대금 계정">
                <Combobox
                  aria-label="대금 계정"
                  items={master.accountItems}
                  value={accountId}
                  onChange={(id) => setAccountId(id)}
                />
              </FormField>
              <FormField id="proceeds-partner" label={needsPartner ? '거래처' : '거래처(선택)'}>
                <Combobox
                  aria-label="거래처"
                  items={master.partnerItems}
                  value={partnerId}
                  onChange={(id) => setPartnerId(id)}
                />
              </FormField>
            </div>
          ) : null}
          <p className="text-sm">
            {profit >= 0 ? '유형자산처분이익' : '유형자산처분손실'}{' '}
            <strong className={profit >= 0 ? 'text-success' : 'text-danger'}>
              {formatWon(Math.abs(profit))}원
            </strong>
          </p>
        </form>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="submit" form="dispose-form" disabled={dispose.isPending}>
            처분 전표 전기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
