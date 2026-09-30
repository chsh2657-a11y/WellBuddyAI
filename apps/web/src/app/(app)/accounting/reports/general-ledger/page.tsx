import type { Metadata } from 'next';
import { GeneralLedgerReport } from './general-ledger-report';

export const metadata: Metadata = { title: '총계정원장' };

export default function Page() {
  return <GeneralLedgerReport />;
}
