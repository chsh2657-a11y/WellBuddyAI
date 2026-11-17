import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: '회원가입' };

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
