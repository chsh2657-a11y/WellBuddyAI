import type { ModuleKey } from '@wellbuddy/shared';
import {
  BookOpen,
  CalendarCheck,
  Factory,
  FileCheck2,
  Landmark,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Receipt,
  Settings,
  Users,
  Wallet,
} from 'lucide-react';

export const MODULE_ICONS: Record<ModuleKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  accounting: BookOpen,
  evidence: Receipt,
  sales: Package,
  production: Factory,
  approval: FileCheck2,
  hr: Users,
  attendance: CalendarCheck,
  payroll: Wallet,
  tax: Landmark,
  settings: Settings,
};

export const MODULE_PATHS: Partial<Record<ModuleKey, string>> = {
  dashboard: '/dashboard',
  accounting: '/accounting',
  evidence: '/evidence',
  settings: '/settings',
};
