import type { Metadata } from 'next';
import { WarehousesManager } from './warehouses-manager';

export const metadata: Metadata = { title: '창고' };

export default function Page() {
  return <WarehousesManager />;
}
