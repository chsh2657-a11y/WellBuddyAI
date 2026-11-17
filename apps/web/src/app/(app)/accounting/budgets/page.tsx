import type { Metadata } from 'next';
import { BudgetsManager } from './budgets-manager';

export const metadata: Metadata = { title: '예산' };

export default function BudgetsPage() {
  return <BudgetsManager />;
}
