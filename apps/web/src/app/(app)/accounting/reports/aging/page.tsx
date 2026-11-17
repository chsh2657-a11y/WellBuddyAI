import type { Metadata } from 'next';
import { AgingReport } from './aging-report';

export const metadata: Metadata = { title: '채권·채무' };

export default function Page() {
  return <AgingReport />;
}
