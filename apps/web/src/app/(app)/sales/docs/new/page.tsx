import { TRADE_DOC_KINDS, type TradeDocKind } from '@wellbuddy/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocForm } from './doc-form';

export const metadata: Metadata = { title: '문서 입력' };

export default async function NewDocPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; source?: string }>;
}) {
  const { kind, source } = await searchParams;
  if (!TRADE_DOC_KINDS.includes(kind as TradeDocKind)) notFound();
  return <DocForm key={`${kind}:${source ?? ''}`} kind={kind as TradeDocKind} sourceId={source} />;
}
