import { JOURNAL_STATUS_LABELS, type JournalStatus } from '@wellbuddy/shared';
import { Badge } from '@/components/ui/badge';

const VARIANT = {
  draft: 'muted',
  pending: 'warning',
  posted: 'success',
  reversed: 'danger',
} as const satisfies Record<JournalStatus, string>;

export function JournalStatusBadge({ status }: { status: JournalStatus }) {
  return <Badge variant={VARIANT[status]}>{JOURNAL_STATUS_LABELS[status]}</Badge>;
}
