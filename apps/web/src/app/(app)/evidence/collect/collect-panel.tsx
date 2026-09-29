'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CollectChannel } from '@wellbuddy/shared';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { can, useSession } from '@/lib/session';

interface ChannelStatus {
  channel: CollectChannel;
  label: string;
  provider: string;
  providerLabel: string;
  enabled: boolean;
  collectable: boolean;
  lastStatus: 'success' | 'error' | null;
  lastMessage: string | null;
  lastRunAt: string | null;
}

interface CollectResult {
  from: string;
  to: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  message: string;
}

const STATUS_KEY = ['evidence', 'collect'];

/** 연동관리에서 고른 공급자(모의·실연동)로 통장·카드·홈택스 자료를 지금 가져온다 */
export function CollectPanel() {
  const { data: session } = useSession();
  const writable = can(session, 'evidence', 'write');
  const canConfigure = can(session, 'settings.integrations', 'read');
  const queryClient = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => apiFetch<ChannelStatus[]>('/evidence/collect'),
  });

  const collect = useMutation({
    mutationFn: (channel: CollectChannel) =>
      apiFetch<CollectResult>(`/evidence/collect/${channel}`, {
        method: 'POST',
        json: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
      }),
    onSuccess: (r, channel) => {
      const label = status.data?.find((s) => s.channel === channel)?.label ?? '';
      toast.success(`${label}: 새로 ${r.inserted}건, 중복 ${r.duplicates}건`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '수집하지 못했습니다.'),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['evidence'] }),
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <span className="pb-2 text-sm text-muted-foreground">수집 기간</span>
        <Input
          type="date"
          aria-label="수집 시작일"
          className="w-40"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="pb-2 text-muted-foreground">~</span>
        <Input
          type="date"
          aria-label="수집 종료일"
          className="w-40"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <span className="pb-2 text-xs text-muted-foreground">
          비우면 최근 30일, 한 번에 92일까지. 이미 가져온 거래는 건너뜁니다.
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {status.data?.map((s) => (
          <Card key={s.channel} data-testid={`collect-${s.channel}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {s.label}
                <Badge variant={s.collectable ? 'success' : 'muted'}>
                  {s.enabled ? s.providerLabel : '꺼짐'}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {s.lastRunAt ? (
                <p className={s.lastStatus === 'error' ? 'text-danger' : 'text-muted-foreground'}>
                  <span className="block text-xs">마지막 수집 {formatDateTime(s.lastRunAt)}</span>
                  {s.lastMessage}
                </p>
              ) : (
                <p className="text-muted-foreground">아직 수집한 적이 없습니다.</p>
              )}
              {s.collectable ? (
                <Button
                  size="sm"
                  disabled={!writable || collect.isPending}
                  onClick={() => collect.mutate(s.channel)}
                >
                  <Download />
                  {s.label} 지금 수집
                </Button>
              ) : s.enabled && s.provider === 'file' ? (
                <p className="text-muted-foreground">
                  파일 업로드 방식입니다.{' '}
                  <Link href="/evidence/upload" className="underline">
                    파일 올리기
                  </Link>
                </p>
              ) : (
                <p className="text-muted-foreground">
                  연동관리에서 켜면 자동으로 가져옵니다.
                  {canConfigure ? (
                    <>
                      {' '}
                      <Link href="/settings/integrations" className="underline">
                        연동관리
                      </Link>
                    </>
                  ) : null}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
