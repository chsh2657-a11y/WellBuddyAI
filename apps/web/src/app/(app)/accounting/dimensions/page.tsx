import type { Metadata } from 'next';
import { DimensionsManager } from './dimensions-manager';

export const metadata: Metadata = { title: '부서·프로젝트' };

export default function DimensionsPage() {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <DimensionsManager kind="departments" />
      <DimensionsManager kind="projects" />
    </div>
  );
}
