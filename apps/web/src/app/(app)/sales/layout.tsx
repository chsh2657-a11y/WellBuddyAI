import type { ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { SalesTabs } from './sales-tabs';

export default function SalesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="영업·구매·재고"
          description="품목·창고와 견적·주문·출고·판매, 발주·입고·구매, 재고를 관리합니다."
        />
        <SalesTabs />
      </div>
      <div className="mt-6 print:mt-0">{children}</div>
    </>
  );
}
