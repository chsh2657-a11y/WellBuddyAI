import type { Metadata } from 'next';
import { PartnersManager } from './partners-manager';

export const metadata: Metadata = { title: '거래처' };

export default function PartnersPage() {
  return <PartnersManager />;
}
