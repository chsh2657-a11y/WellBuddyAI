import type { Metadata } from 'next';
import { JournalDetail } from './journal-detail';

export const metadata: Metadata = { title: '전표' };

export default async function JournalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JournalDetail id={id} />;
}
