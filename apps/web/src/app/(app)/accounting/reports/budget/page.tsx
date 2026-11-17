import type { Metadata } from 'next';
import { BudgetReport } from './budget-report';

export const metadata: Metadata = { title: '예산 대비 실적' };

export default function Page() {
  return <BudgetReport />;
}
