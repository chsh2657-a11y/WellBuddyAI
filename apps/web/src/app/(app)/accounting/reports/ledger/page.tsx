import type { Metadata } from 'next';
import { LedgerReport } from './ledger-report';

export const metadata: Metadata = { title: '계정별원장' };

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string; partnerId?: string; from?: string; to?: string }>;
}) {
  const initial = await searchParams;
  // 거래처원장에서 넘어오면 계정·거래처·기간을 이어받는다
  return <LedgerReport key={JSON.stringify(initial)} mode="account" initial={initial} />;
}
