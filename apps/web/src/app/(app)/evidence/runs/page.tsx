import type { Metadata } from 'next';
import { RunsView } from './runs-view';

export const metadata: Metadata = { title: '수집 이력' };

export default function EvidenceRunsPage() {
  return <RunsView />;
}
