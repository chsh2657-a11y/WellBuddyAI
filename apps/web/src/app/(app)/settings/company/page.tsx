import type { Metadata } from 'next';
import { BusinessPlacesSection } from './business-places-section';
import { CompanyInfoSection } from './company-info-section';

export const metadata: Metadata = { title: '회사정보·사업장' };

export default function CompanySettingsPage() {
  return (
    <div className="grid gap-6">
      <CompanyInfoSection />
      <BusinessPlacesSection />
    </div>
  );
}
