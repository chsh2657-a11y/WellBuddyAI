import type { Metadata } from 'next';
import { AcceptInvitation } from './accept-invitation';

export const metadata: Metadata = { title: '초대 수락' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-2xl font-bold tracking-tight">WellBuddy ERP</p>
        <AcceptInvitation token={token} />
      </div>
    </div>
  );
}
