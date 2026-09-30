'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { STATEMENT_GROUPS } from '@wellbuddy/accounting-core';
import { BANKS, CARD_COMPANIES } from '@wellbuddy/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Combobox, type ComboItem } from '@/components/combobox';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, apiFetch } from '@/lib/api';
import { can, useSession } from '@/lib/session';
import {
  type MasterData,
  useMasterData,
} from '../../accounting/journals/_components/use-master-data';

interface BankAccount {
  id: string;
  bankCode: string;
  bankName: string;
  alias: string;
  accountNoMasked: string;
  ledgerAccountId: string;
  ledgerAccount: string;
  isActive: boolean;
}

interface CorporateCard {
  id: string;
  cardCompany: string;
  cardCompanyName: string;
  alias: string;
  cardNoMasked: string;
  holderName: string | null;
  ledgerAccountId: string;
  ledgerAccount: string;
  isActive: boolean;
}

export const BANK_ACCOUNTS_KEY = ['bank-accounts'];
export const CARDS_KEY = ['corporate-cards'];

const onError = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : '처리하지 못했습니다.');

const ledgerItems = (master: MasterData, category: 'asset' | 'liability'): ComboItem[] =>
  master.accountItems.filter(
    (i) => STATEMENT_GROUPS[master.accountById.get(i.id)!.group].category === category,
  );

/** 수집 대상 은행 계좌·법인카드 등록 */
export function SourcesManager() {
  const { data: session } = useSession();
  const writable = can(session, 'evidence', 'write');
  const master = useMasterData();
  if (!master.ready) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  return (
    <div className="grid gap-6">
      <BankAccountsCard master={master} writable={writable} />
      <CardsCard master={master} writable={writable} />
    </div>
  );
}

function BankAccountsCard({ master, writable }: { master: MasterData; writable: boolean }) {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: BANK_ACCOUNTS_KEY,
    queryFn: () => apiFetch<BankAccount[]>('/bank-accounts'),
  });
  const blank = () => ({
    bankCode: '0004',
    alias: '',
    accountNo: '',
    ledgerAccountId: master.accountByCode.get('103')?.id ?? null,
  });
  const [draft, setDraft] = useState(blank);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: BANK_ACCOUNTS_KEY });

  const create = useMutation({
    mutationFn: () => apiFetch<BankAccount>('/bank-accounts', { method: 'POST', json: draft }),
    onSuccess: (a) => {
      toast.success(`${a.bankName} ${a.accountNoMasked} 계좌를 등록했습니다.`);
      setDraft(blank());
      refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch(`/bank-accounts/${id}`, { method: 'PATCH', json: { isActive } }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/bank-accounts/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>은행 계좌</CardTitle>
        <CardDescription>
          거래내역을 가져올 회사 계좌입니다. 계좌번호는 암호화해 저장하고 끝 4자리만 보여 줍니다.
          장부 계정은 이 계좌의 입출금을 기록할 자산 계정(예: 103 보통예금)입니다.
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
            <Select
              aria-label="은행"
              className="w-40"
              value={draft.bankCode}
              onChange={(e) => setDraft({ ...draft, bankCode: e.target.value })}
            >
              {BANKS.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </Select>
            <Input
              aria-label="계좌 별칭"
              placeholder="별칭(예: 운영자금)"
              className="w-40"
              value={draft.alias}
              onChange={(e) => setDraft({ ...draft, alias: e.target.value })}
              required
            />
            <Input
              aria-label="계좌번호"
              placeholder="계좌번호"
              inputMode="numeric"
              className="w-48"
              value={draft.accountNo}
              onChange={(e) => setDraft({ ...draft, accountNo: e.target.value })}
              required
            />
            <div className="w-52">
              <Combobox
                aria-label="계좌 장부 계정"
                items={ledgerItems(master, 'asset')}
                value={draft.ledgerAccountId}
                onChange={(id) => setDraft({ ...draft, ledgerAccountId: id })}
              />
            </div>
            <Button type="submit" size="sm" disabled={create.isPending}>
              <Plus />
              계좌 등록
            </Button>
          </form>
        ) : null}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>별칭</TableHead>
                <TableHead>은행</TableHead>
                <TableHead>계좌번호</TableHead>
                <TableHead>장부 계정</TableHead>
                <TableHead className="w-20">사용</TableHead>
                {writable ? <TableHead className="w-12" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.alias}</TableCell>
                  <TableCell>{a.bankName}</TableCell>
                  <TableCell className="tabular-nums">{a.accountNoMasked}</TableCell>
                  <TableCell className="text-xs">{a.ledgerAccount}</TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`${a.alias} 사용`}
                      checked={a.isActive}
                      disabled={!writable}
                      onCheckedChange={(isActive) => update.mutate({ id: a.id, isActive })}
                    />
                  </TableCell>
                  {writable ? (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${a.alias} 삭제`}
                        onClick={() =>
                          confirm(`'${a.alias}' 계좌를 삭제할까요?`) && remove.mutate(a.id)
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
          {list.data?.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">등록한 계좌가 없습니다.</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function CardsCard({ master, writable }: { master: MasterData; writable: boolean }) {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: CARDS_KEY,
    queryFn: () => apiFetch<CorporateCard[]>('/corporate-cards'),
  });
  const blank = () => ({
    cardCompany: '0306',
    alias: '',
    cardNo: '',
    holderName: '',
    ledgerAccountId: master.accountByCode.get('253')?.id ?? null,
  });
  const [draft, setDraft] = useState(blank);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: CARDS_KEY });

  const create = useMutation({
    mutationFn: () => apiFetch<CorporateCard>('/corporate-cards', { method: 'POST', json: draft }),
    onSuccess: (c) => {
      toast.success(`${c.cardCompanyName} ${c.cardNoMasked} 카드를 등록했습니다.`);
      setDraft(blank());
      refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch(`/corporate-cards/${id}`, { method: 'PATCH', json: { isActive } }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/corporate-cards/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>법인카드</CardTitle>
        <CardDescription>
          승인내역을 가져올 법인카드입니다. 카드대금 계정은 결제일까지 쌓아 둘 부채 계정(예: 253
          미지급금)입니다.
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
            <Select
              aria-label="카드사"
              className="w-36"
              value={draft.cardCompany}
              onChange={(e) => setDraft({ ...draft, cardCompany: e.target.value })}
            >
              {CARD_COMPANIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Input
              aria-label="카드 별칭"
              placeholder="별칭(예: 대표 카드)"
              className="w-40"
              value={draft.alias}
              onChange={(e) => setDraft({ ...draft, alias: e.target.value })}
              required
            />
            <Input
              aria-label="카드번호"
              placeholder="카드번호 16자리"
              inputMode="numeric"
              className="w-48"
              value={draft.cardNo}
              onChange={(e) => setDraft({ ...draft, cardNo: e.target.value })}
              required
            />
            <Input
              aria-label="사용자"
              placeholder="사용자(선택)"
              className="w-32"
              value={draft.holderName}
              onChange={(e) => setDraft({ ...draft, holderName: e.target.value })}
            />
            <div className="w-52">
              <Combobox
                aria-label="카드대금 계정"
                items={ledgerItems(master, 'liability')}
                value={draft.ledgerAccountId}
                onChange={(id) => setDraft({ ...draft, ledgerAccountId: id })}
              />
            </div>
            <Button type="submit" size="sm" disabled={create.isPending}>
              <Plus />
              카드 등록
            </Button>
          </form>
        ) : null}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>별칭</TableHead>
                <TableHead>카드사</TableHead>
                <TableHead>카드번호</TableHead>
                <TableHead>사용자</TableHead>
                <TableHead>카드대금 계정</TableHead>
                <TableHead className="w-20">사용</TableHead>
                {writable ? <TableHead className="w-12" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.alias}</TableCell>
                  <TableCell>{c.cardCompanyName}</TableCell>
                  <TableCell className="tabular-nums">{c.cardNoMasked}</TableCell>
                  <TableCell>{c.holderName ?? ''}</TableCell>
                  <TableCell className="text-xs">{c.ledgerAccount}</TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`${c.alias} 사용`}
                      checked={c.isActive}
                      disabled={!writable}
                      onCheckedChange={(isActive) => update.mutate({ id: c.id, isActive })}
                    />
                  </TableCell>
                  {writable ? (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${c.alias} 삭제`}
                        onClick={() =>
                          confirm(`'${c.alias}' 카드를 삭제할까요?`) && remove.mutate(c.id)
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
          {list.data?.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">등록한 카드가 없습니다.</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
