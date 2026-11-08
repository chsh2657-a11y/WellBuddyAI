'use client';

import { formatWon, parseWon } from '@wellbuddy/accounting-core';
import { type ComponentProps, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Props = Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValueChange: (value: number) => void;
};

function toNonNegative(text: string): number {
  const parsed = parseWon(text);
  return parsed !== null && parsed >= 0 ? parsed : 0;
}

/**
 * 원 단위 금액 입력칸. 입력하는 동안에는 친 글자를 그대로 두고, 포커스가 빠지면 천 단위 쉼표로 보여 준다.
 * 0 은 빈칸으로 보여 준다(장부 표기).
 */
export function WonInput({ value, onValueChange, className, onBlur, ...props }: Props) {
  // 입력 중인 글자(포커스가 없으면 null → value 를 서식화해 보여 준다)
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value ? formatWon(value) : '');

  return (
    <Input
      inputMode="numeric"
      autoComplete="off"
      className={cn('text-right tabular-nums', className)}
      value={shown}
      onChange={(e) => {
        setDraft(e.target.value);
        onValueChange(toNonNegative(e.target.value));
      }}
      onBlur={(e) => {
        if (draft !== null) onValueChange(toNonNegative(draft));
        setDraft(null);
        onBlur?.(e);
      }}
      {...props}
    />
  );
}
