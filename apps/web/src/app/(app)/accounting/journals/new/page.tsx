import type { Metadata } from 'next';
import { Card, CardContent } from '@/components/ui/card';
import { JournalEditor } from '../_components/journal-editor';

export const metadata: Metadata = { title: '전표입력' };

export default async function NewJournalPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; kind?: string }>;
}) {
  const { mode, kind } = await searchParams;
  return (
    <Card>
      <CardContent className="pt-5">
        <JournalEditor
          initialMode={mode === 'vat' ? 'vat' : 'general'}
          initialKind={kind === 'purchase' ? 'purchase' : 'sales'}
        />
      </CardContent>
    </Card>
  );
}
