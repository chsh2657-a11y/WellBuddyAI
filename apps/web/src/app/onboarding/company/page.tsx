import type { Metadata } from 'next';
import { CreateCompanyForm } from './create-company-form';

export const metadata: Metadata = { title: '회사 만들기' };

export default function OnboardingCompanyPage() {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <p className="text-2xl font-bold tracking-tight">회사 정보를 입력해 주세요</p>
          <p className="mt-1 text-sm text-muted-foreground">
            회계 장부와 모든 데이터는 회사 단위로 분리되어 관리됩니다.
          </p>
        </div>
        <CreateCompanyForm />
      </div>
    </div>
  );
}
