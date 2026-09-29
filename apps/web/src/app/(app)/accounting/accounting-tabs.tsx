'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface Tab {
  href: string;
  label: string;
  /** 현재 경로가 이 탭인지(기본: href 로 시작) */
  match?: (path: string) => boolean;
}

export const ACCOUNTING_TABS: Tab[] = [
  {
    href: '/accounting/journals/new',
    label: '전표입력',
    match: (p) => p === '/accounting/journals/new',
  },
  {
    href: '/accounting/journals',
    label: '전표조회',
    match: (p) =>
      p.startsWith('/accounting/journals') &&
      p !== '/accounting/journals/new' &&
      p !== '/accounting/journals/quick',
  },
  {
    href: '/accounting/journals/quick',
    label: '입금·출금',
    match: (p) => p === '/accounting/journals/quick',
  },
  { href: '/accounting/accounts', label: '계정과목' },
  { href: '/accounting/partners', label: '거래처' },
  { href: '/accounting/dimensions', label: '부서·프로젝트' },
  { href: '/accounting/periods', label: '회계기간·마감' },
];

const isActive = (t: Tab, path: string) => (t.match ? t.match(path) : path.startsWith(t.href));

export function AccountingTabs() {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b" aria-label="회계 메뉴">
      {ACCOUNTING_TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={isActive(t, pathname) ? 'page' : undefined}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            isActive(t, pathname)
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
