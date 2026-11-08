import type { Metadata } from 'next';
import { MenusSettings } from './menus-settings';

export const metadata: Metadata = { title: '메뉴 사용' };

export default function MenusSettingsPage() {
  return <MenusSettings />;
}
