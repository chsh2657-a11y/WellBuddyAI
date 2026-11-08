import type { Metadata } from 'next';
import { FixedAssetsManager } from './fixed-assets-manager';

export const metadata: Metadata = { title: '고정자산' };

export default function FixedAssetsPage() {
  return <FixedAssetsManager />;
}
