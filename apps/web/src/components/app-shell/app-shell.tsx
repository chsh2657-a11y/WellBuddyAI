'use client';

import { MODULES, ROLE_LABELS } from '@wellbuddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ChevronDown, LogOut, Menu, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError, apiFetch } from '@/lib/api';
import { moduleVisible, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { MODULE_ICONS, MODULE_PATHS } from './module-icons';

export function AppShell({ children }: { children: ReactNode }) {
  const { data: session, error, isPending } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace('/login');
    else if (session && !session.company) router.replace('/onboarding/company');
  }, [error, session, router]);

  if (isPending || !session?.company) {
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">
        불러오는 중…
      </div>
    );
  }

  async function switchCompany(companyId: string) {
    try {
      await apiFetch('/auth/switch-company', { method: 'POST', json: { companyId } });
      queryClient.clear();
      router.push('/dashboard');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '회사를 전환하지 못했습니다.');
    }
  }

  async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
    queryClient.clear();
    router.replace('/login');
  }

  const nav = (
    <nav className="flex flex-col gap-0.5 p-3" aria-label="주 메뉴">
      {MODULES.filter((m) => moduleVisible(session, m.key) || !m.available).map((m) => {
        const Icon = MODULE_ICONS[m.key];
        const href = MODULE_PATHS[m.key];
        const active = href ? pathname.startsWith(href) : false;
        if (!m.available || !href) {
          return (
            <span
              key={m.key}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/70"
              title={`${m.phase} 단계에서 제공 예정`}
            >
              <Icon className="size-4" />
              <span className="flex-1">{m.label}</span>
              <Badge variant="muted">준비 중</Badge>
            </span>
          );
        }
        return (
          <Link
            key={m.key}
            href={href}
            onClick={() => setMenuOpen(false)}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-primary-soft text-primary' : 'hover:bg-surface-muted',
            )}
          >
            <Icon className="size-4" />
            {m.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 border-r bg-surface md:block print:hidden">
        <div className="flex h-14 items-center border-b px-5 font-semibold">WellBuddy ERP</div>
        {nav}
      </aside>

      {menuOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 overflow-y-auto bg-surface shadow-lg">
            <div className="flex h-14 items-center justify-between border-b px-4 font-semibold">
              WellBuddy ERP
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMenuOpen(false)}
                aria-label="메뉴 닫기"
              >
                <X />
              </Button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b bg-surface px-4 print:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="메뉴 열기"
          >
            <Menu />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="max-w-[60vw] gap-2 px-2"
                data-testid="company-switcher"
              >
                <Building2 />
                <span className="truncate">{session.company.name}</span>
                <ChevronDown className="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>회사 전환</DropdownMenuLabel>
              {session.companies.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => switchCompany(c.id)}>
                  <Check
                    className={cn(c.id === session.company?.id ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{ROLE_LABELS[c.role]}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => router.push('/onboarding/company')}>
                <Plus />새 회사 만들기
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2" data-testid="user-menu">
                  <span className="grid size-7 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                    {session.user.name.slice(0, 1)}
                  </span>
                  <span className="hidden text-sm sm:inline">{session.user.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {session.user.email}
                  {session.role ? ` · ${ROLE_LABELS[session.role]}` : ''}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={logout}>
                  <LogOut />
                  로그아웃
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 print:p-0">{children}</main>
      </div>
    </div>
  );
}
