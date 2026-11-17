import type { Metadata } from 'next';
import { CountForm } from './count-form';

export const metadata: Metadata = { title: '재고 실사' };

export default function StockCountPage() {
  return <CountForm />;
}
