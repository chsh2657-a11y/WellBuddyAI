'use client';

import { MODULES } from '@wellbuddy/shared';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '@/lib/session';

const KPI_CARDS = [
  { title: '현금·예금 잔액', note: '회계(P1)와 통장 연동(P2) 후 표시됩니다.' },
  { title: '이번 달 매출', note: '매출 전표가 쌓이면 표시됩니다.' },
  { title: '이번 달 비용', note: '비용 전표가 쌓이면 표시됩니다.' },
  { title: '미수금', note: '거래처 채권이 생기면 표시됩니다.' },
];

export function DashboardView() {
  const { data: session } = useSession();

  return (
    <>
      <PageHeader
        title={`안녕하세요, ${session?.user.name ?? ''}님`}
        description={session?.company ? `${session.company.name} 대시보드` : undefined}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPI_CARDS.map((kpi) => (
          <Card key={kpi.title}>
            <CardHeader>
              <CardDescription>{kpi.title}</CardDescription>
              <CardTitle className="text-2xl tabular-nums text-muted-foreground">—</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{kpi.note}</CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>개발 로드맵</CardTitle>
          <CardDescription>메뉴는 단계별로 열립니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((m) => (
              <li
                key={m.key}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span>{m.label}</span>
                <Badge variant={m.available ? 'success' : 'muted'}>
                  {m.available ? '사용 가능' : `${m.phase} 예정`}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
