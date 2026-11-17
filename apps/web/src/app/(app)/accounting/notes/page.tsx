import type { Metadata } from 'next';
import { NotesManager } from './notes-manager';

export const metadata: Metadata = { title: '어음관리' };

export default function NotesPage() {
  return <NotesManager />;
}
