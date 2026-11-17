import { expect, type Page, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const combo = (page: Page, name: string) => page.getByRole('combobox', { name, exact: true });

test('예산: 연간 예산 편성(월 배분) → 실적 → 예산 대비 실적 초과 표시', async ({ page }) => {
  await signupWithCompany(page, 'p1b-budget', '예산상사');

  // ── 데이터 준비(API): 2026 회계연도, 1월 복리후생비 15만 ──
  const api = page.request;
  const accounts = (await (await api.get('/api/accounts')).json()) as {
    id: string;
    code: string;
  }[];
  const acc = Object.fromEntries(accounts.map((a) => [a.code, a.id])) as Record<string, string>;
  expect((await api.post('/api/fiscal-years', { data: { date: '2026-01-01' } })).ok()).toBe(true);
  const expense = await api.post('/api/journals', {
    data: {
      entry: {
        entryDate: '2026-01-20',
        lines: [
          { accountId: acc['811'], debit: 150_000, credit: 0 },
          { accountId: acc['101'], debit: 0, credit: 150_000 },
        ],
      },
      status: 'posted',
    },
  });
  expect(expense.status(), await expense.text()).toBe(201);

  // ── 예산 편성: 연간 120만 → 월 10만 ──
  await page.getByRole('link', { name: '회계' }).click();
  await page.getByRole('link', { name: '예산', exact: true }).click();
  await expect(page).toHaveURL(/\/accounting\/budgets/);
  await page.getByLabel('회계연도').selectOption({ label: '2026 회계연도' });
  await combo(page, '예산 계정 추가').fill('811');
  await combo(page, '예산 계정 추가').press('Enter');
  await page.getByLabel('복리후생비 연간 합계').fill('1200000');
  await page.getByLabel('복리후생비 연간 합계').blur();
  await expect(page.getByLabel('복리후생비 2026-01')).toHaveValue('100,000');
  await expect(page.getByLabel('복리후생비 2026-12')).toHaveValue('100,000');
  await page.getByRole('button', { name: '예산 저장' }).click();
  await expect(page.getByText('예산을 저장했습니다.')).toBeVisible();
  await snap(page, 'p1b-07-budget');

  // ── 예산 대비 실적: 1월까지 누계 예산 10만, 실적 15만 → 150%, 예산 초과 ──
  await page.getByRole('link', { name: '장부·보고서' }).click();
  await page.getByRole('link', { name: '예산 대비 실적' }).click();
  await expect(page).toHaveURL(/\/accounting\/reports\/budget/);
  await page.getByLabel('회계연도').selectOption({ label: '2026 회계연도' });
  await page.getByLabel('기준월').selectOption({ label: '2026-01까지' });
  const row = page.getByRole('row', { name: /811 복리후생비/ });
  await expect(row).toContainText('1,200,000');
  await expect(row).toContainText('150,000');
  await expect(row).toContainText('150.0%');
  await expect(row).toContainText('예산 초과');
  await snap(page, 'p1b-08-budget-report');
});
