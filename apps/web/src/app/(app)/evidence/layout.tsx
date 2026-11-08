import type { ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { EvidenceTabs } from './evidence-tabs';

export default function EvidenceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="증빙·자동분개"
          description="통장·카드·홈택스 증빙을 모아 전표를 자동으로 만듭니다."
        />
        <EvidenceTabs />
      </div>
      <div className="mt-6 print:mt-0">{children}</div>
    </>
  );
}
