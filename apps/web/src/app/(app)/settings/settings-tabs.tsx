'use client';

import type { PermissionKey } from '@wellbuddy/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { can, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export const SETTINGS_TABS: { href: string; label: string; permission: PermissionKey }[] = [
  { href: '/settings/company', label: '회사정보·사업장', permission: 'settings.company' },
  { href: '/settings/users', label: '사용자·권한', permission: 'settings.users' },
  { href: '/settings/menus', label: '메뉴 사용', permission: 'settings.menus' },
  { href: '/settings/integrations', label: '연동관리', permission: 'settings.integrations' },
  { href: '/settings/audit', label: '감사로그', permission: 'settings.audit' },
];

export function SettingsTabs() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const tabs = SETTINGS_TABS.filter((t) => can(session, t.permission, 'read'));
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b" aria-label="설정 메뉴">
      {tabs.map((t) => (
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
