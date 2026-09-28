import type { Metadata } from 'next';
import { AuditLogTable } from './audit-log-table';

export const metadata: Metadata = { title: '감사로그' };

export default function AuditSettingsPage() {
  return <AuditLogTable />;
}
