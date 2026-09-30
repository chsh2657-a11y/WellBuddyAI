import type { Metadata } from 'next';
import { DailyReport } from './daily-report';

export const metadata: Metadata = { title: '일계표·월계표' };

export default function DailyReportPage() {
  return <DailyReport />;
}
