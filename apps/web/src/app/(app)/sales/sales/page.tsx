import { SALES_DOC_KINDS } from '@wellbuddy/shared';
import type { Metadata } from 'next';
import { DocsList } from '../_components/docs-list';

export const metadata: Metadata = { title: '판매' };

export default function SalesDocsPage() {
  return <DocsList kinds={SALES_DOC_KINDS} label="판매" />;
}
