import type { Metadata } from 'next';
import { PartnerReport } from './partner-report';

export const metadata: Metadata = { title: '거래처원장' };

export default function Page() {
  return <PartnerReport />;
}
