'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface Run {
  id: string;
  channel: string;
  provider: string;
  trigger: 'manual' | 'schedule' | 'file';
  status: 'running' | 'success' | 'error';
  fetched: number;
  inserted: number;
  duplicates: number;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const CHANNEL_LABELS: Record<string, string> = { bank: '통장', card: '카드', hometax: '홈택스' };
const PROVIDER_LABELS: Record<string, string> = {
  file: '파일',
  mock: '모의',
  codef: 'CODEF',
  popbill: '팝빌',
};
const TRIGGER_LABELS: Record<Run['trigger'], string> = {
  manual: '수동',
  schedule: '예약',
  file: '업로드',
};
const STATUS: Record<Run['status'], { label: string; variant: 'muted' | 'success' | 'danger' }> = {
  running: { label: '진행 중', variant: 'muted' },
  success: { label: '완료', variant: 'success' },
  error: { label: '실패', variant: 'danger' },
};

/** 파일 업로드·모의·실연동 수집 실행 기록(최근 50건) */
export function RunsView() {
  const runs = useQuery({
    queryKey: ['evidence', 'runs'],
    queryFn: () => apiFetch<Run[]>('/evidence/runs'),
  });
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table aria-label="수집 이력">
        <TableHeader>
          <TableRow>
            <TableHead>시작</TableHead>
            <TableHead>자료</TableHead>
            <TableHead>방식</TableHead>
            <TableHead>결과</TableHead>
            <TableHead className="text-right">가져옴</TableHead>
            <TableHead className="text-right">새로 등록</TableHead>
            <TableHead className="text-right">중복</TableHead>
            <TableHead>내용</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.data?.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap tabular-nums">
                {formatDateTime(r.startedAt)}
              </TableCell>
              <TableCell>{CHANNEL_LABELS[r.channel] ?? r.channel}</TableCell>
              <TableCell className="whitespace-nowrap">
                {PROVIDER_LABELS[r.provider] ?? r.provider} · {TRIGGER_LABELS[r.trigger]}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.fetched}</TableCell>
              <TableCell className="text-right tabular-nums">{r.inserted}</TableCell>
              <TableCell className="text-right tabular-nums">{r.duplicates}</TableCell>
              <TableCell className="text-sm">{r.message ?? ''}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {runs.data?.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">아직 수집한 적이 없습니다.</p>
      ) : null}
    </div>
  );
}
