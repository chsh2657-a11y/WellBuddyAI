import type { Metadata } from 'next';
import { ItemsManager } from './items-manager';

export const metadata: Metadata = { title: '품목' };

export default function Page() {
  return <ItemsManager />;
}
