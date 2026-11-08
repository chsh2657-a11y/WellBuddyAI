'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

interface Dimension {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  startDate?: string | null;
  endDate?: string | null;
}

const TEXT = {
  departments: {
    title: '부서',
    description: '전표에 부서를 붙여 부서별 비용을 봅니다.',
    codeHint: 'D10',
  },
  projects: {
    title: '프로젝트',
    description: '전표에 프로젝트를 붙여 프로젝트별 손익을 봅니다.',
    codeHint: 'P2026-01',
  },
};

export function DimensionsManager({ kind }: { kind: 'departments' | 'projects' }) {
  const { data: session } = useSession();
  const writable = can(session, 'accounting', 'write');
  const queryClient = useQueryClient();
  const key = [kind];
  const items = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<Dimension[]>(`/${kind}?includeInactive=true`),
  });
  const [draft, setDraft] = useState({ code: '', name: '', startDate: '', endDate: '' });

  const onError = (e: unknown) =>
    toast.error(e instanceof ApiError ? e.message : '처리하지 못했습니다.');
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/${kind}`, {
        method: 'POST',
        json: kind === 'projects' ? draft : { code: draft.code, name: draft.name },
      }),
    onSuccess: () => {
      setDraft({ code: '', name: '', startDate: '', endDate: '' });
      refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch(`/${kind}/${id}`, { method: 'PATCH', json: { isActive } }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/${kind}/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError,
  });

  const t = TEXT[kind];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
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
              aria-label={`${t.title} 코드`}
              placeholder={`코드 (예: ${t.codeHint})`}
              className="w-32"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            />
            <Input
              aria-label={`${t.title} 이름`}
              placeholder="이름"
              className="min-w-32 flex-1"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            {kind === 'projects' ? (
              <>
                <Input
                  type="date"
                  aria-label="시작일"
                  className="w-40"
                  value={draft.startDate}
                  onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                />
                <Input
                  type="date"
                  aria-label="종료일"
                  className="w-40"
                  value={draft.endDate}
                  onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                />
              </>
            ) : null}
            <Button type="submit" disabled={create.isPending || !draft.code || !draft.name}>
              <Plus />
              추가
            </Button>
          </form>
        ) : null}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">코드</TableHead>
                <TableHead>이름</TableHead>
                {kind === 'projects' ? <TableHead>기간</TableHead> : null}
                <TableHead className="w-20">사용</TableHead>
                {writable ? <TableHead className="w-12" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.data?.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="tabular-nums">{d.code}</TableCell>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  {kind === 'projects' ? (
                    <TableCell className="text-xs text-muted-foreground">
                      {d.startDate || d.endDate ? `${d.startDate ?? ''} ~ ${d.endDate ?? ''}` : '—'}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Switch
                      aria-label={`${d.name} 사용`}
                      checked={d.isActive}
                      disabled={!writable}
                      onCheckedChange={(isActive) => update.mutate({ id: d.id, isActive })}
                    />
                  </TableCell>
                  {writable ? (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${d.name} 삭제`}
                        onClick={() =>
                          confirm(`'${d.name}'을(를) 삭제할까요?`) && remove.mutate(d.id)
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
          {items.data?.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">등록된 {t.title}이(가) 없습니다.</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
