import type { Metadata } from 'next';
import { IssueView } from './issue-view';

export const metadata: Metadata = { title: '세금계산서 발행' };

export default function EvidenceIssuePage() {
  return <IssueView />;
}
