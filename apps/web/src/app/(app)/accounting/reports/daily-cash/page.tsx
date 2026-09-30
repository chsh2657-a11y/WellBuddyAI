import type { Metadata } from 'next';
import { DailyCashReport } from './daily-cash-report';

export const metadata: Metadata = { title: '일일자금일보' };

export default function Page() {
  return <DailyCashReport />;
}
