import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-2xl font-bold tracking-tight">WellBuddy ERP</p>
          <p className="mt-1 text-sm text-muted-foreground">자동화 회계 · 경리 업무를 한 곳에서</p>
        </div>
        {children}
      </div>
    </div>
  );
}
