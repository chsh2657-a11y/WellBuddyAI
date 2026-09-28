import type { ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { AccountingTabs } from './accounting-tabs';

export default function AccountingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader
        title="회계"
        description="전표 입력부터 장부·재무제표까지 한 곳에서 관리합니다."
      />
      <AccountingTabs />
      <div className="mt-6">{children}</div>
    </>
  );
}
