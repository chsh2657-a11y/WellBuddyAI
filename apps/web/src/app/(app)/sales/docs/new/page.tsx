import { TRADE_DOC_KINDS, type TradeDocKind } from '@wellbuddy/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocForm } from './doc-form';

export const metadata: Metadata = { title: '문서 입력' };

export default async function NewDocPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; source?: string; items?: string }>;
}) {
  const { kind, source, items } = await searchParams;
  if (!TRADE_DOC_KINDS.includes(kind as TradeDocKind)) notFound();
  // 적정재고 미달 → 발주서처럼 품목·수량을 미리 채운다(items=품목id:수량,…)
  const prefill = (items ?? '')
    .split(',')
    .map((pair) => pair.split(':'))
    .flatMap(([itemId, qty]) =>
      itemId && Number(qty) > 0 ? [{ itemId, qty: Number(qty) }] : [],
    );
  return (
    <DocForm
      key={`${kind}:${source ?? ''}:${items ?? ''}`}
      kind={kind as TradeDocKind}
      sourceId={source}
      prefill={prefill}
    />
  );
}
