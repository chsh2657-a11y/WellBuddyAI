import { UPLOAD_KINDS, type UploadKind } from '@wellbuddy/shared';
import type { Metadata } from 'next';
import { RecordsView } from './records-view';

export const metadata: Metadata = { title: '수집 내역' };

export default async function EvidenceRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  const initial = UPLOAD_KINDS.includes(kind as UploadKind) ? (kind as UploadKind) : 'bank';
  return <RecordsView initialKind={initial} />;
}
