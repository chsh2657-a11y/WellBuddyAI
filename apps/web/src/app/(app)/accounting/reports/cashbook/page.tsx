import type { Metadata } from 'next';
import { LedgerReport } from '../ledger/ledger-report';

export const metadata: Metadata = { title: '현금출납장' };

export default function CashbookPage() {
  return <LedgerReport mode="cash" />;
}
