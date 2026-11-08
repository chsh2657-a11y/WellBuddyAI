import type { Metadata } from 'next';
import { PeriodsManager } from './periods-manager';

export const metadata: Metadata = { title: '회계기간·마감' };

export default function PeriodsPage() {
  return <PeriodsManager />;
}
