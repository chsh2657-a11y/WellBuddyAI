'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export const SALES_TABS = [
  { href: '/sales/items', label: '품목' },
  { href: '/sales/warehouses', label: '창고' },
  { href: '/sales/prices', label: '거래처별 단가' },
];

export function SalesTabs() {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b" aria-label="영업 메뉴">
      {SALES_TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
