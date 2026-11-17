import type { Metadata } from 'next';
import { DocPrint } from './doc-print';

export const metadata: Metadata = { title: '인쇄' };

export default async function DocPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocPrint id={id} />;
}
