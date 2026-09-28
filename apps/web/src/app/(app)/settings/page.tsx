import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: '설정' };

export default function SettingsPage() {
  return <PageHeader title="설정" description="회사정보, 사용자·권한, 메뉴, 연동을 관리합니다." />;
}
