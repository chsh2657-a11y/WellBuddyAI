import type { Metadata } from 'next';
import { DimensionPlReport } from './dimension-pl-report';

export const metadata: Metadata = { title: '부서·프로젝트별 손익' };

export default function Page() {
  return <DimensionPlReport />;
}
