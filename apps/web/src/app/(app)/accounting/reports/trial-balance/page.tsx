import type { Metadata } from 'next';
import { TrialBalanceReport } from './trial-balance-report';

export const metadata: Metadata = { title: '합계잔액시산표' };

export default function Page() {
  return <TrialBalanceReport />;
}
