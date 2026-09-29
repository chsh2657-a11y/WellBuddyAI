import type { ReactNode } from 'react';
import { ReportsNav } from './_components/reports-nav';

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ReportsNav />
      {children}
    </>
  );
}
