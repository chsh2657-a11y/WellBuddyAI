'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export const REPORTS = [
  { href: '/accounting/reports/daily', label: '일계표·월계표' },
  { href: '/accounting/reports/ledger', label: '계정별원장' },
  { href: '/accounting/reports/cashbook', label: '현금출납장' },
  { href: '/accounting/reports/partners', label: '거래처원장' },
  { href: '/accounting/reports/general-ledger', label: '총계정원장' },
  { href: '/accounting/reports/trial-balance', label: '합계잔액시산표' },
  { href: '/accounting/reports/statements', label: '재무제표' },
  { href: '/accounting/reports/aging', label: '채권·채무' },
];

export function ReportsNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-4 flex flex-wrap gap-1.5 print:hidden" aria-label="장부·보고서">
      {REPORTS.map((r) => (
        <Link
          key={r.href}
          href={r.href}
          aria-current={pathname.startsWith(r.href) ? 'page' : undefined}
          className={cn(
            'rounded-full border px-3 py-1 text-sm transition-colors',
            pathname.startsWith(r.href)
              ? 'border-primary bg-primary-soft text-primary'
              : 'bg-surface text-muted-foreground hover:text-foreground',
          )}
        >
          {r.label}
        </Link>
      ))}
    </nav>
  );
}
