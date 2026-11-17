import type { Metadata } from 'next';
import { StatementsReport } from './statements-report';

export const metadata: Metadata = { title: '재무제표' };

export default function Page() {
  return <StatementsReport />;
}
