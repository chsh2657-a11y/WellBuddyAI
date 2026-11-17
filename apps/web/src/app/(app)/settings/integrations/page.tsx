import type { Metadata } from 'next';
import { IntegrationsSettings } from './integrations-settings';

export const metadata: Metadata = { title: '연동관리' };

export default function IntegrationsSettingsPage() {
  return <IntegrationsSettings />;
}
