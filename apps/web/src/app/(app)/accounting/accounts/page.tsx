import type { Metadata } from 'next';
import { AccountsManager } from './accounts-manager';

export const metadata: Metadata = { title: '계정과목' };

export default function AccountsPage() {
  return <AccountsManager />;
}
