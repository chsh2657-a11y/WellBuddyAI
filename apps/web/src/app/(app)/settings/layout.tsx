import type { ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { SettingsTabs } from './settings-tabs';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader title="설정" description="회사정보, 사용자·권한, 메뉴, 외부 연동을 관리합니다." />
      <SettingsTabs />
      <div className="mt-6">{children}</div>
    </>
  );
}
