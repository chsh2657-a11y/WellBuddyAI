'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export const ACCOUNTING_TABS = [
  { href: '/accounting/accounts', label: '계정과목' },
  { href: '/accounting/partners', label: '거래처' },
  { href: '/accounting/dimensions', label: '부서·프로젝트' },
  { href: '/accounting/periods', label: '회계기간·마감' },
];

export function AccountingTabs() {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b" aria-label="회계 메뉴">
      {ACCOUNTING_TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            pathname.startsWith(t.href)
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
