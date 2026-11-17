'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export const EVIDENCE_TABS = [
  { href: '/evidence/review', label: '자동분개 검토함' },
  { href: '/evidence/center', label: '증빙센터' },
  { href: '/evidence/receipts', label: '영수증' },
  { href: '/evidence/issue', label: '세금계산서 발행' },
  { href: '/evidence/records', label: '수집 내역' },
  { href: '/evidence/upload', label: '파일 올리기' },
  { href: '/evidence/collect', label: '자동 수집' },
  { href: '/evidence/reconcile', label: '잔액 대사' },
  { href: '/evidence/rules', label: '분개 규칙' },
  { href: '/evidence/sources', label: '계좌·카드' },
];

export function EvidenceTabs() {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b" aria-label="증빙 메뉴">
      {EVIDENCE_TABS.map((t) => {
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
