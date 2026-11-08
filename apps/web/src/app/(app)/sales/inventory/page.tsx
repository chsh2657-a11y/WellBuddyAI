import type { Metadata } from 'next';
import { InventoryView } from './inventory-view';

export const metadata: Metadata = { title: '재고' };

export default function InventoryPage() {
  return <InventoryView />;
}
