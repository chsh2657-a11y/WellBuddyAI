'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch } from '@/lib/api';

interface AuditLog {
  id: string;
  createdAt: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  ip: string | null;
  userName: string | null;
  userEmail: string | null;
  before: unknown;
  after: unknown;
}

const ACTION_LABELS: Record<string, string> = {
  'auth.signup': '회원가입',
  'auth.login': '로그인',
  'auth.login_failed': '로그인 실패',
  'auth.refresh_reused': '토큰 재사용 탐지(강제 로그아웃)',
  'company.create': '회사 생성',
  'company.update': '회사정보 수정',
  'business_place.create': '사업장 등록',
  'business_place.update': '사업장 수정',
  'business_place.delete': '사업장 삭제',
  'invitation.create': '초대 발송',
  'invitation.revoke': '초대 취소',
  'invitation.accept': '초대 수락',
  'role.permissions.update': '역할 권한 변경',
  'member.update': '구성원 변경',
  'settings.modules.update': '메뉴 사용 변경',
  'integration.update': '연동 설정 변경',
};

function actionLabel(action: string): string {
  if (action.startsWith('http:')) return `요청 ${action.slice(5)}`;
  return ACTION_LABELS[action] ?? action;
}

const PAGE = 50;
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'medium' });

export function AuditLogTable() {
  const [open, setOpen] = useState<string | null>(null);
  const logs = useInfiniteQuery({
    queryKey: ['audit-logs'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiFetch<AuditLog[]>(
        `/audit-logs?limit=${PAGE}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => (last.length === PAGE ? last.at(-1)?.createdAt : undefined),
  });
  const rows = logs.data?.pages.flat() ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>감사로그</CardTitle>
        <CardDescription>
          누가·언제·무엇을 바꿨는지 기록합니다. 기록은 수정·삭제할 수 없습니다(국세기본법상 장부
          보관 대비).
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8 pl-5" />
              <TableHead>일시</TableHead>
              <TableHead>사용자</TableHead>
              <TableHead>작업</TableHead>
              <TableHead>결과</TableHead>
              <TableHead className="pr-5">IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((log) => {
              const hasDetail = log.before != null || log.after != null;
              const expanded = open === log.id;
              return (
                <Fragment key={log.id}>
                  <TableRow
                    className={hasDetail ? 'cursor-pointer' : undefined}
                    onClick={() => hasDetail && setOpen(expanded ? null : log.id)}
                  >
                    <TableCell className="pl-5 text-muted-foreground">
                      {hasDetail ? (
                        expanded ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {dateFormat.format(new Date(log.createdAt))}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{log.userName ?? '—'}</TableCell>
                    <TableCell>{actionLabel(log.action)}</TableCell>
                    <TableCell>
                      {log.statusCode == null ? null : (
                        <Badge variant={log.statusCode < 400 ? 'success' : 'danger'}>
                          {log.statusCode}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="pr-5 text-xs text-muted-foreground">
                      {log.ip ?? ''}
                    </TableCell>
                  </TableRow>
                  {expanded ? (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-surface-muted/50 px-5">
                        <div className="grid gap-3 md:grid-cols-2">
                          <pre className="overflow-x-auto rounded-md bg-surface p-3 text-xs">
                            변경 전{'\n'}
                            {JSON.stringify(log.before, null, 2)}
                          </pre>
                          <pre className="overflow-x-auto rounded-md bg-surface p-3 text-xs">
                            변경 후{'\n'}
                            {JSON.stringify(log.after, null, 2)}
                          </pre>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
        {logs.hasNextPage ? (
          <div className="flex justify-center p-4">
            <Button
              variant="outline"
              onClick={() => logs.fetchNextPage()}
              disabled={logs.isFetchingNextPage}
            >
              더 보기
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
