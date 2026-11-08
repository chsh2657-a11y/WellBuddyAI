import type { Metadata } from 'next';
import { CollectPanel } from './collect-panel';
import { RunsView } from './runs-view';

export const metadata: Metadata = { title: '자동 수집' };

export default function EvidenceCollectPage() {
  return (
    <div className="grid gap-6">
      <CollectPanel />
      <section className="grid gap-2">
        <h2 className="text-base font-semibold">수집 이력</h2>
        <RunsView />
      </section>
    </div>
  );
}
