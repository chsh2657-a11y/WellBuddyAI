import { expect, type Page, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const combo = (page: Page, name: string) => page.getByRole('combobox', { name, exact: true });

test('어음: 받을어음 수취 → 할인 → 원장 확인 → 마지막 처리 취소', async ({ page }) => {
  await signupWithCompany(page, 'p1b-notes', '어음상사');

  // ── 데이터 준비(API): 거래처, 기초잔액, 외상 매출 ──
  const api = page.request;
  const accounts = (await (await api.get('/api/accounts')).json()) as {
    id: string;
    code: string;
  }[];
  const acc = Object.fromEntries(accounts.map((a) => [a.code, a.id])) as Record<string, string>;
  const hanbit = (
    await (await api.post('/api/partners', { data: { name: '한빛상사', kind: 'customer' } })).json()
  ).id as string;
  const fy = (await (await api.post('/api/fiscal-years', { data: { date: '2026-01-01' } })).json())
    .id as string;
  await api.put(`/api/fiscal-years/${fy}/opening-balances`, {
    data: {
      lines: [
        { accountId: acc['101'], debit: 1_000_000, credit: 0 },
        { accountId: acc['331'], debit: 0, credit: 1_000_000 },
      ],
    },
  });
  const sale = await api.post('/api/journals', {
    data: {
      entry: {
        entryDate: '2026-03-01',
        lines: [
          { accountId: acc['108'], debit: 5_000_000, credit: 0, partnerId: hanbit },
          { accountId: acc['401'], debit: 0, credit: 5_000_000 },
        ],
      },
      status: 'posted',
    },
  });
  expect(sale.status(), await sale.text()).toBe(201);
  const closing = async (code: string) =>
    (
      await (
        await api.get(
          `/api/reports/account-ledger?accountId=${acc[code]}&from=2026-01-01&to=2026-12-31`,
        )
      ).json()
    ).closing as number;

  // ── 받을어음 수취 ──
  await page.getByRole('link', { name: '회계' }).click();
  await page.getByRole('link', { name: '어음관리' }).click();
  await expect(page).toHaveURL(/\/accounting\/notes/);
  await page.getByRole('button', { name: '받을어음 수취' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('어음번호').fill('R-2026-001');
  await combo(page, '거래처').fill('한빛');
  await combo(page, '거래처').press('Enter');
  await form.getByLabel('발행일').fill('2026-03-05');
  await form.getByLabel('만기일').fill('2026-04-30');
  await form.getByLabel('금액').fill('1000000');
  await expect(combo(page, '상대 계정')).toHaveValue('108 외상매출금');
  await form.getByRole('button', { name: '등록' }).click();
  await expect(page.getByText('받을어음 R-2026-001을(를) 수취로 등록했습니다.')).toBeVisible();
  const row = page.getByRole('row', { name: /R-2026-001/ });
  await expect(row).toContainText('1,000,000');
  await expect(row).toContainText('보유');
  expect(await closing('110')).toBe(1_000_000);

  // ── 할인: 3/31, 연 12% → 30일, 할인료 9,863원 ──
  await page.getByRole('button', { name: 'R-2026-001 처리' }).click();
  const detail = page.getByRole('dialog');
  await detail.getByRole('tab', { name: '할인' }).click();
  await detail.getByLabel('처리일').fill('2026-03-31');
  await detail.getByLabel('연 할인율(%)').fill('12');
  await expect(detail.getByText('30일 · 할인료 9,863원 · 입금 990,137원')).toBeVisible();
  await snap(page, 'p1b-05-note-discount');
  await detail.getByRole('button', { name: '할인 전표 전기' }).click();
  await expect(page.getByText('R-2026-001 할인 전표를 전기했습니다.')).toBeVisible();
  await expect(detail.getByRole('row', { name: /할인/ })).toContainText('할인료 9,863원');
  expect(await closing('110')).toBe(0);
  expect(await closing('956')).toBe(9_863);
  const tb = await (await api.get('/api/reports/trial-balance?date=2026-12-31')).json();
  expect(tb.balanced).toBe(true);

  // ── 마지막 처리 취소 → 다시 보유 ──
  page.once('dialog', (d) => void d.accept());
  await detail.getByRole('button', { name: '마지막 처리 취소' }).click();
  await expect(page.getByText('마지막 처리를 취소했습니다(역분개).')).toBeVisible();
  await expect(detail.getByRole('tab', { name: '만기 결제' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('row', { name: /R-2026-001/ })).toContainText('보유');
  expect(await closing('110')).toBe(1_000_000);
  expect(await closing('956')).toBe(0);
  await snap(page, 'p1b-06-notes');
});
