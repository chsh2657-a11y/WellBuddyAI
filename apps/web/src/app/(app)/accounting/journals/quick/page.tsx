import type { Metadata } from 'next';
import { Card, CardContent } from '@/components/ui/card';
import { QuickEntry } from './quick-entry';

export const metadata: Metadata = { title: '입금·출금 간편입력' };

export default function QuickEntryPage() {
  return (
    <Card>
      <CardContent className="pt-5">
        <QuickEntry />
      </CardContent>
    </Card>
  );
}
