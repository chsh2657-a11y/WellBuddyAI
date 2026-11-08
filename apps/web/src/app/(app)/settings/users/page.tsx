import type { Metadata } from 'next';
import { InvitationsSection } from './invitations-section';
import { MembersSection } from './members-section';
import { RolePermissionsSection } from './role-permissions-section';

export const metadata: Metadata = { title: '사용자·권한' };

export default function UsersSettingsPage() {
  return (
    <div className="grid gap-6">
      <MembersSection />
      <InvitationsSection />
      <RolePermissionsSection />
    </div>
  );
}
