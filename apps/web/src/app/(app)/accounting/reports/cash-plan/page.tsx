import type { Metadata } from 'next';
import { CashPlanReport } from './cash-plan-report';

export const metadata: Metadata = { title: '자금계획' };

export default function Page() {
  return <CashPlanReport />;
}
