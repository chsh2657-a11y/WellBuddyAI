import { redirect } from 'next/navigation';

export default function ReportsIndexPage() {
  redirect('/accounting/reports/daily');
}
