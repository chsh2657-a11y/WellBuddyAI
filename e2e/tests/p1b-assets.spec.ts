import { expect, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('고정자산: 등록 → 월 상각 전표 → 원장 누계액 확인 → 마지막 실행 취소', async ({ page }) => {
  await signupWithCompany(page, 'p1b-assets', '자산상사');

  // ── 데이터 준비(API): 기초잔액 + 비품 취득 전표 ──
  const api = page.request;
  const accounts = (await (await api.get('/api/accounts')).json()) as {
    id: string;
    code: string;
  }[];
  const acc = Object.fromEntries(accounts.map((a) => [a.code, a.id])) as Record<string, string>;
  const fy = (await (await api.post('/api/fiscal-years', { data: { date: '2026-01-01' } })).json())
    .id as string;
  const opening = await api.put(`/api/fiscal-years/${fy}/opening-balances`, {
    data: {
      lines: [
        { accountId: acc['103'], debit: 20_000_000, credit: 0 },
        { accountId: acc['331'], debit: 0, credit: 20_000_000 },
      ],
    },
  });
  expect(opening.ok()).toBe(true);
  const purchase = await api.post('/api/journals', {
    data: {
      entry: {
        entryDate: '2026-03-15',
        description: '사무용 책상 구입',
        lines: [
          { accountId: acc['212'], debit: 12_000_000, credit: 0 },
          { accountId: acc['103'], debit: 0, credit: 12_000_000 },
        ],
      },
      status: 'posted',
    },
  });
  expect(purchase.status(), await purchase.text()).toBe(201);

  // ── 자산 등록(기본 계정: 비품·감가상각누계액·감가상각비) ──
  await page.getByRole('link', { name: '회계' }).click();
  await page.getByRole('link', { name: '고정자산' }).click();
  await expect(page).toHaveURL(/\/accounting\/assets/);
  await page.getByRole('button', { name: '자산 등록' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('자산명').fill('사무용 책상 세트');
  await dialog.getByLabel('취득일').fill('2026-03-15');
  await dialog.getByLabel('취득가액').fill('12000000');
  await expect(dialog.getByRole('combobox', { name: '자산 계정', exact: true })).toHaveValue(
    /비품/,
  );
  await dialog.getByRole('button', { name: '등록' }).click();
  await expect(page.getByText('FA0001 사무용 책상 세트을(를) 등록했습니다.')).toBeVisible();
  const assetRow = page.getByRole('row', { name: /FA0001/ });
  await expect(assetRow).toContainText('12,000,000');

  // ── 3월·4월 상각 실행 ──
  await page.getByLabel('상각할 달').fill('2026-03');
  await page.getByRole('button', { name: '상각 실행' }).click();
  await expect(page.getByText('2026-03 감가상각 199,983원(1건)을 전기했습니다.')).toBeVisible();
  // 다음 달이 기본으로 잡힌다
  await expect(page.getByLabel('상각할 달')).toHaveValue('2026-04');
  await page.getByRole('button', { name: '상각 실행' }).click();
  await expect(page.getByText('2026-04 감가상각 199,983원(1건)을 전기했습니다.')).toBeVisible();
  await expect(assetRow).toContainText('399,966');
  await expect(assetRow).toContainText('11,600,034');

  await page.getByRole('button', { name: '사무용 책상 세트 상각 일정' }).click();
  await expect(page.getByRole('dialog')).toContainText('반영 399,966원');
  await snap(page, 'p1b-01-asset-schedule');
  await page.keyboard.press('Escape');
  await snap(page, 'p1b-02-fixed-assets');

  // ── 전표 → 원장: 누계액 계정 잔액 = 상각 누계 ──
  await page.getByRole('link', { name: '2026-04-30-1' }).click();
  await expect(page).toHaveURL(/\/accounting\/journals\/[0-9a-f-]{36}/);
  await expect(page.getByText('2026-04 감가상각').first()).toBeVisible();
  await page.goto(
    `/accounting/reports/ledger?accountId=${acc['213']}&from=2026-01-01&to=2026-12-31`,
  );
  const total = page.locator('tr', {
    has: page.getByRole('cell', { name: '합계', exact: true }),
  });
  await expect(total).toContainText('399,966');
  const tb = await (await api.get('/api/reports/trial-balance?date=2026-12-31')).json();
  expect(tb.balanced).toBe(true);

  // ── 마지막 실행(4월) 취소 → 역분개 ──
  await page.goto('/accounting/assets');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: '2026-04 상각 취소' }).click();
  await expect(page.getByText('2026-04 감가상각을 취소했습니다(역분개).')).toBeVisible();
  await expect(page.getByRole('button', { name: '2026-03 상각 취소' })).toBeVisible();
  await expect(page.getByRole('row', { name: /FA0001/ })).toContainText('199,983');
});
