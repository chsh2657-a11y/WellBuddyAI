import type { Metadata } from 'next';
import { SourcesManager } from './sources-manager';

export const metadata: Metadata = { title: '계좌·카드' };

export default function SourcesPage() {
  return <SourcesManager />;
}
