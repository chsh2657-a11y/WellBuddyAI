'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { can, useSession } from '@/lib/session';
import { SETTINGS_TABS } from './settings-tabs';

export default function SettingsIndexPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const first = SETTINGS_TABS.find((t) => can(session, t.permission, 'read'));

  useEffect(() => {
    if (first) router.replace(first.href);
  }, [first, router]);

  if (session && !first) {
    return <p className="text-sm text-muted-foreground">설정 메뉴에 접근할 권한이 없습니다.</p>;
  }
  return null;
}
