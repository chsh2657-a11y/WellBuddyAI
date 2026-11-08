import type { Metadata } from 'next';
import { PricesManager } from './prices-manager';

export const metadata: Metadata = { title: '거래처별 단가' };

export default function Page() {
  return <PricesManager />;
}
