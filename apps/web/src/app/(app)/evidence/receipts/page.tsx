import type { Metadata } from 'next';
import { ReceiptsView } from './receipts-view';

export const metadata: Metadata = { title: '영수증' };

export default function EvidenceReceiptsPage() {
  return <ReceiptsView />;
}
