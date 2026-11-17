'use client';

import { MODULES } from '@wellbuddy/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { formatWon } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { type MonthPoint, MonthlyChart } from './monthly-chart';

interface Dashboard {
  date: string;
  fiscalYear: { startDate: string; endDate: string; label: string };
  cash: number;
  deposits: number;
  receivables: number;
  payables: number;
  revenue: number;
  expense: number;
  netIncome: number;
  months: MonthPoint[];
  drafts: number;
  pending: number;
}

function Kpi({
  title,
  value,
  note,
  href,
}: {
  title: string;
  value: number | undefined;
  note: string;
  href?: string;
}) {
  const body = (
    <Card className={href ? 'transition-colors hover:border-primary/40' : undefined}>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">
          {value === undefined ? '—' : `${formatWon(value)}원`}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{note}</CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} aria-label={title}>
      {body}
    </Link>
  ) : (
    body
  );
}

interface StockAlert {
  itemId: string;
  code: string;
  name: string;
  unit: string;
  qty: number;
  safetyStock: number;
  shortfall: number;
}

const qty = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 3 });

/** 적정재고 미달(P3-14): 모자란 수량만큼 발주서를 바로 만든다 */
function LowStockCard() {
  const alerts = useQuery({
    queryKey: ['inventory', 'alerts'],
    queryFn: () => apiFetch<StockAlert[]>('/inventory/alerts'),
    retry: false,
  });
  const list = alerts.data ?? [];
  if (list.length === 0) return null;
  const order = list.map((a) => `${a.itemId}:${a.shortfall}`).join(',');
  return (
    <Card className="mt-6" aria-label="적정재고 미달">
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-warning" />
          적정재고 미달
          <Badge variant="warning">{list.length}개 품목</Badge>
        </CardTitle>
        <div className="ml-auto flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/sales/inventory">재고 보기</Link>
          </Button>
          <Button asChild size="sm">
            <Link href={`/sales/docs/new?kind=purchase_order&items=${order}`}>발주서 만들기</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-1 text-sm">
          {list.slice(0, 5).map((a) => (
            <li key={a.itemId} className="flex items-center gap-3">
              <span className="font-medium">{a.name}</span>
              <span className="text-muted-foreground tabular-nums">
                현재 {qty(a.qty)} / 적정 {qty(a.safetyStock)} {a.unit}
              </span>
              <span className="ml-auto tabular-nums text-warning">
                {qty(a.shortfall)} {a.unit} 부족
              </span>
            </li>
          ))}
          {list.length > 5 ? (
            <li className="text-xs text-muted-foreground">외 {list.length - 5}개 품목</li>
          ) : null}
        </ul>
      </CardContent>
    </Card>
  );
}

export function DashboardView() {
  const { data: session } = useSession();
  const accounting = can(session, 'accounting', 'read');
  const dashboard = useQuery({
    queryKey: ['reports', 'dashboard'],
    queryFn: () => apiFetch<Dashboard>('/reports/dashboard'),
    enabled: accounting,
    staleTime: 0,
  });
  const d = dashboard.data;

  return (
    <>
      <PageHeader
        title={`안녕하세요, ${session?.user.name ?? ''}님`}
        description={session?.company ? `${session.company.name} 대시보드` : undefined}
      />
      {accounting ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              title="현금"
              value={d?.cash}
              note="현금 계정 잔액"
              href="/accounting/reports/cashbook"
            />
            <Kpi
              title="예금"
              value={d?.deposits}
              note="보통·당좌예금 잔액"
              href="/accounting/reports/cashbook"
            />
            <Kpi
              title="미수금(받을 돈)"
              value={d?.receivables}
              note="외상매출금·받을어음·미수금"
              href="/accounting/reports/aging"
            />
            <Kpi
              title="미지급금(줄 돈)"
              value={d?.payables}
              note="외상매입금·지급어음·미지급금"
              href="/accounting/reports/aging"
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_18rem]">
            <Card>
              <CardHeader>
                <CardTitle>월별 매출·비용</CardTitle>
                <CardDescription>
                  {d ? `${d.fiscalYear.label} 회계연도 · 전기한 전표 기준` : '전기한 전표 기준'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {d ? (
                  <MonthlyChart months={d.months} />
                ) : (
                  <p className="text-sm text-muted-foreground">불러오는 중…</p>
                )}
              </CardContent>
            </Card>
            <div className="grid content-start gap-4">
              <Card>
                <CardHeader>
                  <CardDescription>올해 누적(오늘까지)</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">매출</span>
                    <span className="tabular-nums">{d ? formatWon(d.revenue) : '—'}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">비용</span>
                    <span className="tabular-nums">{d ? formatWon(d.expense) : '—'}</span>
                  </p>
                  <p className="flex justify-between border-t pt-2 font-semibold">
                    <span>당기순이익</span>
                    <span className="tabular-nums">{d ? formatWon(d.netIncome) : '—'}</span>
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>처리할 전표</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <Link
                    href="/accounting/journals"
                    className="flex items-center justify-between hover:underline"
                  >
                    작성중
                    <Badge variant="muted">{d?.drafts ?? 0}건</Badge>
                  </Link>
                  <Link
                    href="/accounting/journals"
                    className="flex items-center justify-between hover:underline"
                  >
                    승인요청
                    <Badge variant="warning">{d?.pending ?? 0}건</Badge>
                  </Link>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : null}

      {can(session, 'sales', 'read') ? <LowStockCard /> : null}

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
