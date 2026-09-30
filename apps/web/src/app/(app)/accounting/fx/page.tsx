import type { Metadata } from 'next';
import { ExchangeRatesCard } from './exchange-rates-card';
import { RevaluationCard } from './revaluation-card';

export const metadata: Metadata = { title: '환율·외화평가' };

export default function FxPage() {
  return (
    <div className="grid gap-6">
      <ExchangeRatesCard />
      <RevaluationCard />
    </div>
  );
}
