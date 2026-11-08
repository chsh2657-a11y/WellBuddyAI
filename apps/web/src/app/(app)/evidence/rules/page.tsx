import type { Metadata } from 'next';
import { RulesManager } from './rules-manager';

export const metadata: Metadata = { title: '분개 규칙' };

export default function EvidenceRulesPage() {
  return <RulesManager />;
}
