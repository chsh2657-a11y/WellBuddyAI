import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** 접근성과 모바일 입력을 위해 네이티브 select 를 스타일만 입혀 쓴다. */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'flex h-10 w-full rounded-md border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
