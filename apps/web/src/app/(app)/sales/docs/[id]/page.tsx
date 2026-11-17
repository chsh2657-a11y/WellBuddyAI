import type { Metadata } from 'next';
import { DocDetail } from './doc-detail';

export const metadata: Metadata = { title: '거래 문서' };

export default async function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocDetail id={id} />;
}
