'use client';

import { useMutation } from '@tanstack/react-query';
import { FileSpreadsheet, Printer } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ApiError, apiDownload } from '@/lib/api';
import { formatWon, todayIso, wonOrBlank } from '@/lib/format';
import { cn } from '@/lib/utils';

export type Cell = string | number | null;

export interface ReportColumn {
  header: string;
  /** 엑셀 머리글(화면 머리글이 묶음 아래 짧은 이름일 때) */
  exportHeader?: string;
  type?: 'text' | 'won';
  className?: string;
  width?: number;
}

export interface ReportRow {
  cells: Cell[];
  /** section: 구분 제목, subtotal: 소계·이월, total: 합계 */
  kind?: 'section' | 'subtotal' | 'total';
  /** 첫 글자 열을 들여쓴다(구분 아래 계정) */
  indent?: boolean;
  /** 열 번호 → 링크 */
  links?: Partial<Record<number, string>>;
}

export interface ReportModel {
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  /** 머리글 위 묶음(예: 차변 | 계정과목 | 대변) */
  groups?: { label: string; span: number }[];
  rows: ReportRow[];
}

function cellText(value: Cell, column: ReportColumn, row: ReportRow): string {
  if (value === null || value === '') return '';
  if (column.type === 'won' && typeof value === 'number') {
    return row.kind === 'total' || row.kind === 'subtotal' ? formatWon(value) : wonOrBlank(value);
  }
  return String(value);
}

/**
 * 장부·보고서 공통 화면: 조회 조건, 엑셀 내려받기, 인쇄·PDF, 표.
 * 엑셀은 화면에 보이는 표(model)를 그대로 서버로 보내 만든다.
 */
export function ReportView({
  model,
  filters,
  loading,
  error,
  emptyText = '조회된 내용이 없습니다.',
  badge,
}: {
  model: ReportModel;
  filters: ReactNode;
  loading?: boolean;
  error?: unknown;
  emptyText?: string;
  /** 제목 옆 표시(예: 대차 일치) */
  badge?: ReactNode;
}) {
  const excel = useMutation({
    mutationFn: () =>
      apiDownload('/reports/export', `${model.title}_${todayIso()}.xlsx`, {
        method: 'POST',
        json: {
          title: model.title,
          subtitle: model.subtitle,
          columns: model.columns.map((c) => ({
            header: c.exportHeader ?? c.header,
            type: c.type ?? 'text',
            ...(c.width ? { width: c.width } : {}),
          })),
          rows: model.rows.map((r) => r.cells),
          boldRows: model.rows.flatMap((r, i) => (r.kind ? [i] : [])),
        },
      }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '엑셀을 만들지 못했습니다.'),
  });

  const labelColumn = model.columns.findIndex((c) => c.type !== 'won');

  return (
    <Card className="print:border-0 print:shadow-none">
      <CardHeader className="flex-row flex-wrap items-end gap-3 print:hidden">
        {filters}
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={excel.isPending || loading || model.rows.length === 0}
            onClick={() => excel.mutate()}
          >
            <FileSpreadsheet />
            엑셀
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer />
            인쇄·PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-2 print:p-0">
        <div className="flex flex-wrap items-baseline gap-3 px-5 pb-3 print:px-0">
          <h2 className="text-lg font-semibold">{model.title}</h2>
          <p className="text-sm text-muted-foreground">{model.subtitle}</p>
          {badge}
        </div>
        {error ? (
          <p role="alert" className="px-5 text-sm text-danger">
            {error instanceof ApiError ? error.message : '보고서를 불러오지 못했습니다.'}
          </p>
        ) : loading ? (
          <p className="px-5 text-sm text-muted-foreground">불러오는 중…</p>
        ) : model.rows.length === 0 ? (
          <p className="px-5 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <div className="w-full overflow-x-auto print:overflow-visible">
            <table className="w-full text-sm print:text-xs">
              <thead className="bg-surface-muted text-xs text-muted-foreground print:bg-transparent">
                {model.groups ? (
                  <tr className="border-b">
                    {model.groups.map((g, i) => (
                      <th key={i} colSpan={g.span} className="px-3 py-1.5 text-center font-medium">
                        {g.label}
                      </th>
                    ))}
                  </tr>
                ) : null}
                <tr className="border-b">
                  {model.columns.map((c, i) => (
                    <th
                      key={i}
                      className={cn(
                        'px-3 py-2 font-medium first:pl-5 last:pr-5 print:first:pl-1 print:last:pr-1',
                        c.type === 'won' ? 'text-right' : 'text-left',
                        c.className,
                      )}
                    >
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.rows.map((row, r) => (
                  <tr
                    key={r}
                    className={cn(
                      'border-b last:border-0',
                      row.kind === 'section' && 'bg-surface-muted/60 font-semibold',
                      row.kind === 'subtotal' && 'font-medium',
                      row.kind === 'total' && 'bg-surface-muted font-semibold',
                    )}
                  >
                    {row.cells.map((value, c) => {
                      const column = model.columns[c]!;
                      const text = cellText(value, column, row);
                      const href = row.links?.[c];
                      return (
                        <td
                          key={c}
                          className={cn(
                            'px-3 py-1.5 first:pl-5 last:pr-5 print:first:pl-1 print:last:pr-1',
                            column.type === 'won' && 'text-right tabular-nums',
                            column.className,
                          )}
                        >
                          {c === labelColumn && row.indent ? (
                            <span className="inline-block pl-4">{text}</span>
                          ) : href && text ? (
                            <Link
                              href={href}
                              className="text-primary hover:underline print:text-inherit"
                            >
                              {text}
                            </Link>
                          ) : (
                            text
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
