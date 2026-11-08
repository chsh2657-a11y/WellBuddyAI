import type { Metadata } from 'next';
import { ReconcileView } from './reconcile-view';

export const metadata: Metadata = { title: '잔액 대사' };

export default function EvidenceReconcilePage() {
  return <ReconcileView />;
}
