import { PURCHASE_DOC_KINDS } from '@wellbuddy/shared';
import type { Metadata } from 'next';
import { DocsList } from '../_components/docs-list';

export const metadata: Metadata = { title: '구매' };

export default function PurchasesPage() {
  return <DocsList kinds={PURCHASE_DOC_KINDS} label="구매" />;
}
