import type { Metadata } from 'next';
import { CenterView } from './center-view';

export const metadata: Metadata = { title: '증빙센터' };

export default function EvidenceCenterPage() {
  return <CenterView />;
}
