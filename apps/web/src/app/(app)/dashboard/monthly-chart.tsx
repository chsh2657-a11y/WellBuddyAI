'use client';

import { useState } from 'react';
import { formatWon } from '@/lib/format';

export interface MonthPoint {
  month: string;
  revenue: number;
  expense: number;
}

const SERIES = [
  { key: 'revenue', label: '매출', color: 'var(--chart-1)' },
  { key: 'expense', label: '비용', color: 'var(--chart-2)' },
] as const;

const compact = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });

/** 눈금 최댓값을 1·2·5 × 10ⁿ 단위로 올린다 */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((m) => m * exp >= value)!;
  return step * exp;
}

/** 위쪽만 둥근(4px) 막대: 기준선에서 자란다 */
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

const W = 720;
const H = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 52 };

/**
 * 월별 매출·비용 막대(한 축, 계열 2개). 마우스를 올리면 그 달의 금액을 보여 주고,
 * 같은 내용을 표로도 볼 수 있다.
 */
export function MonthlyChart({ months }: { months: MonthPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(...months.flatMap((m) => [m.revenue, m.expense]), 0));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / months.length;
  const barW = Math.min(18, (band - 10) / 2);
  const y = (v: number) => PAD.top + plotH - (Math.max(0, v) / max) * plotH;
  const ticks = [0, max / 2, max];
  const hovered = active === null ? null : months[active];

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label="월별 매출·비용 막대그래프"
          onMouseLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--border)"
                strokeDasharray={t === 0 ? undefined : '3 3'}
              />
              <text
                x={PAD.left - 8}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="11"
                fill="var(--muted-foreground)"
              >
                {compact.format(t)}
              </text>
            </g>
          ))}
          {months.map((m, i) => {
            const cx = PAD.left + band * i + band / 2;
            return (
              <g key={m.month}>
                {active === i ? (
                  <rect
                    x={PAD.left + band * i + 2}
                    y={PAD.top}
                    width={band - 4}
                    height={plotH}
                    fill="var(--surface-muted)"
                    rx="4"
                  />
                ) : null}
                {SERIES.map((s, k) => {
                  // 두 막대 사이 2px 띄움
                  const x = k === 0 ? cx - barW - 1 : cx + 1;
                  const top = y(m[s.key]);
                  return (
                    <path
                      key={s.key}
                      d={barPath(x, top, barW, PAD.top + plotH - top)}
                      fill={s.color}
                    />
                  );
                })}
                <text
                  x={cx}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--muted-foreground)"
                >
                  {Number(m.month.slice(5))}월
                </text>
                {/* 막대보다 넓은 마우스 영역 */}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setActive(i)}
                />
              </g>
            );
          })}
        </svg>
        {hovered && active !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-2 rounded-md border bg-surface px-3 py-2 text-xs shadow-md"
            style={{
              left: `${((PAD.left + band * active + band / 2) / W) * 100}%`,
              transform: active > months.length / 2 ? 'translateX(-105%)' : 'translateX(5%)',
            }}
          >
            <p className="mb-1 font-medium">{hovered.month}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center gap-2">
                <span className="size-2 rounded-sm" style={{ background: s.color }} />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="ml-auto tabular-nums">{formatWon(hovered[s.key])}원</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">표로 보기</summary>
        <table className="mt-2 w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="py-1 text-left font-medium">월</th>
              <th className="py-1 text-right font-medium">매출</th>
              <th className="py-1 text-right font-medium">비용</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-b last:border-0">
                <td className="py-1">{m.month}</td>
                <td className="py-1 text-right tabular-nums">{formatWon(m.revenue)}</td>
                <td className="py-1 text-right tabular-nums">{formatWon(m.expense)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
