'use client';

import {
  type KeyboardEvent,
  type Ref,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { matchesKorean } from '@/lib/hangul';
import { cn } from '@/lib/utils';

export interface ComboItem {
  id: string;
  code: string;
  name: string;
  /** 목록에서 이름 옆에 흐리게 보여 줄 정보 */
  hint?: string;
}

export interface ComboboxHandle {
  focus: () => void;
}

interface Props {
  items: readonly ComboItem[];
  value: string | null;
  /** 고르면 호출. 두 번째 인자는 Enter 로 골랐는지(다음 칸으로 넘어갈 때 쓴다) */
  onChange: (id: string | null, viaEnter: boolean) => void;
  /** 목록이 닫힌 상태에서 Enter 를 누르면 호출(다음 칸으로 이동) */
  onEnter?: () => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  'aria-label': string;
  ref?: Ref<ComboboxHandle>;
}

const MAX_OPTIONS = 50;

function display(item: ComboItem | undefined) {
  return item ? `${item.code} ${item.name}` : '';
}

/**
 * 코드·이름·초성으로 찾는 자동완성 입력칸(키보드: ↑↓ 이동, Enter 선택, Esc 닫기).
 * 표 안에서도 잘리지 않도록 목록은 body 에 띄운다.
 */
export function Combobox({
  items,
  value,
  onChange,
  onEnter,
  placeholder,
  disabled,
  invalid,
  className,
  ref,
  'aria-label': ariaLabel,
}: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  const selected = items.find((i) => i.id === value);
  const results = useMemo(() => {
    const q = (query ?? '').trim();
    if (!q) return items.slice(0, MAX_OPTIONS);
    const byCode = items.filter((i) => i.code.startsWith(q));
    const byName = items.filter((i) => !i.code.startsWith(q) && matchesKorean(i.name, q));
    return [...byCode, ...byName].slice(0, MAX_OPTIONS);
  }, [items, query]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => setRect(inputRef.current?.getBoundingClientRect() ?? null);
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  const choose = (item: ComboItem | undefined, viaEnter: boolean) => {
    setQuery(null);
    setOpen(false);
    onChange(item?.id ?? null, viaEnter);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // 검색어를 쳤으면 강조된 항목을 고르고, 아니면 다음 칸으로 넘어간다
      if (open && query !== null && results[active]) choose(results[active], true);
      else {
        setOpen(false);
        onEnter?.();
      }
    } else if (e.key === 'Escape') {
      setQuery(null);
      setOpen(false);
    } else if (e.key === 'Tab' && open && query) {
      // 검색어를 친 채 Tab 으로 나가면 맨 위 항목을 고른다
      if (results[active]) choose(results[active], false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        className={cn(
          'flex h-9 w-full min-w-0 rounded-md border bg-surface px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
          invalid && 'border-danger',
          className,
        )}
        value={query ?? display(selected)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
          if (e.target.value === '') onChange(null, false);
        }}
        onBlur={() => {
          setQuery(null);
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
      />
      {open && rect
        ? createPortal(
            <ul
              id={listId}
              role="listbox"
              aria-label={`${ariaLabel} 목록`}
              className="fixed z-50 max-h-72 overflow-y-auto rounded-md border bg-surface py-1 text-sm shadow-lg"
              style={{
                top: rect.bottom + 4,
                left: rect.left,
                minWidth: Math.max(rect.width, 240),
              }}
              // 목록을 눌러도 입력칸 포커스가 빠지지 않게
              onMouseDown={(e) => e.preventDefault()}
            >
              {results.length === 0 ? (
                <li className="px-3 py-2 text-muted-foreground">찾는 항목이 없습니다.</li>
              ) : (
                results.map((item, i) => (
                  <li
                    key={item.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 px-3 py-1.5',
                      i === active && 'bg-primary/10 text-primary',
                    )}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(item, false)}
                  >
                    <span className="w-14 shrink-0 tabular-nums text-muted-foreground">
                      {item.code}
                    </span>
                    <span className="truncate">{item.name}</span>
                    {item.hint ? (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {item.hint}
                      </span>
                    ) : null}
                  </li>
                ))
              )}
            </ul>,
            document.body,
          )
        : null}
    </>
  );
}
