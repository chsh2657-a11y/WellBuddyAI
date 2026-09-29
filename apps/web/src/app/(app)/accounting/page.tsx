import { redirect } from 'next/navigation';

export default function AccountingIndexPage() {
  redirect('/accounting/journals/new');
}
