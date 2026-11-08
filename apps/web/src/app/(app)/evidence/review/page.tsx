import type { Metadata } from 'next';
import { ReviewInbox } from './review-inbox';

export const metadata: Metadata = { title: '자동분개 검토함' };

export default function EvidenceReviewPage() {
  return <ReviewInbox />;
}
