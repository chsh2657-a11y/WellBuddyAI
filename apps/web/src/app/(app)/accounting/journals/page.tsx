import type { Metadata } from 'next';
import { JournalList } from './journal-list';

export const metadata: Metadata = { title: '전표조회' };

export default function JournalsPage() {
  return <JournalList />;
}
