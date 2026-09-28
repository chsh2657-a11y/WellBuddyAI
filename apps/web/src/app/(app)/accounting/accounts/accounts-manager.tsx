'use client';

import {
  STATEMENT_GROUP_KEYS,
  STATEMENT_GROUPS,
  type StatementGroup,
} from '@wellbuddy/accounting-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { AccountDialog } from './account-dialog';

export interface Account {
  id: string;
  code: string;
  name: string;
  group: StatementGroup;
  normalBalance: 'debit' | 'credit';
  requiresPartner: boolean;
  requiresDepartment: boolean;
  isActive: boolean;
  isSystem: boolean;
  description: string | null;
}

export const ACCOUNTS_KEY = ['accounts'];

export function AccountsManager() {
  const { data: session } = useSession();
  const writable = can(session, 'accounting', 'write');
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);

  const accounts = useQuery({
    queryKey: [...ACCOUNTS_KEY, { includeInactive }],
    queryFn: () => apiFetch<Account[]>(`/accounts?includeInactive=${includeInactive}`),
  });

  const restore = useMutation({
    mutationFn: () => apiFetch<{ added: number }>('/accounts/restore-standard', { method: 'POST' }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
      toast.success(
        r.added ? `표준 계정 ${r.added}개를 복원했습니다.` : '빠진 표준 계정이 없습니다.',
      );
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '복원하지 못했습니다.'),
  });

  const grouped = useMemo(() => {
    const keyword = q.trim();
    const filtered = (accounts.data ?? []).filter(
      (a) => !keyword || a.code.includes(keyword) || a.name.includes(keyword),
    );
    return STATEMENT_GROUP_KEYS.map((group) => ({
      group,
      rows: filtered.filter((a) => a.group === group),
    })).filter((g) => g.rows.length > 0);
  }, [accounts.data, q]);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="계정 검색"
            placeholder="코드 또는 계정명"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={includeInactive}
            onCheckedChange={setIncludeInactive}
            aria-label="사용중지 포함"
          />
          사용중지 포함
        </label>
        {writable ? (
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => restore.mutate()}
              disabled={restore.isPending}
            >
              <RotateCcw />
              표준 계정 복원
            </Button>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus />
              계정 추가
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24 pl-5">코드</TableHead>
              <TableHead>계정명</TableHead>
              <TableHead className="w-24">정상잔액</TableHead>
              <TableHead className="w-28">관리항목</TableHead>
              <TableHead className="w-24 pr-5">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grouped.map(({ group, rows }) => (
              <Fragment key={group}>
                <TableRow className="bg-surface-muted/60 hover:bg-surface-muted/60">
                  <TableCell
                    colSpan={5}
                    className="pl-5 text-xs font-semibold text-muted-foreground"
                  >
                    {STATEMENT_GROUPS[group].statement === 'BS' ? '재무상태표' : '손익계산서'} ·{' '}
                    {STATEMENT_GROUPS[group].label}
                  </TableCell>
                </TableRow>
                {rows.map((a) => (
                  <TableRow
                    key={a.id}
                    className={writable ? 'cursor-pointer' : undefined}
                    onClick={() => writable && setEditing(a)}
                  >
                    <TableCell className="pl-5 tabular-nums">{a.code}</TableCell>
                    <TableCell className="font-medium">
                      {a.name}
                      {!a.isSystem ? (
                        <Badge variant="muted" className="ml-2">
                          추가
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>{a.normalBalance === 'debit' ? '차변' : '대변'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[a.requiresPartner && '거래처', a.requiresDepartment && '부서']
                        .filter(Boolean)
                        .join(' · ')}
                    </TableCell>
                    <TableCell className="pr-5">
                      {a.isActive ? (
                        <Badge variant="success">사용</Badge>
                      ) : (
                        <Badge variant="muted">중지</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
        {accounts.isPending ? (
          <p className="p-5 text-sm text-muted-foreground">불러오는 중…</p>
        ) : grouped.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">조건에 맞는 계정이 없습니다.</p>
        ) : null}
      </CardContent>
      <AccountDialog account={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}
