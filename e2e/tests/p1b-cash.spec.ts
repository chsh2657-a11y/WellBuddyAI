import { expect, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('자금: 일일자금일보 → 예정 입출금 등록 → 자금계획 부족 경고 → 완료 처리', async ({ page }) => {
  await signupWithCompany(page, 'p1b-cash', '자금상사');

  // ── 데이터 준비(API): 현금 100만, 3/10 복리후생비 현금 5만 ──
  const api = page.request;
  const accounts = (await (await api.get('/api/accounts')).json()) as {
    id: string;
    code: string;
  }[];
  const acc = Object.fromEntries(accounts.map((a) => [a.code, a.id])) as Record<string, string>;
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
  const spend = await api.post('/api/journals', {
    data: {
      entry: {
        entryDate: '2026-03-10',
        description: '직원 간식',
        lines: [
          { accountId: acc['811'], debit: 50_000, credit: 0 },
          { accountId: acc['101'], debit: 0, credit: 50_000 },
        ],
      },
      status: 'posted',
    },
  });
  expect(spend.status(), await spend.text()).toBe(201);

  // ── 일일자금일보 ──
  await page.getByRole('link', { name: '회계' }).click();
  await page.getByRole('link', { name: '장부·보고서' }).click();
  await page.getByRole('link', { name: '일일자금일보' }).click();
  await expect(page).toHaveURL(/\/accounting\/reports\/daily-cash/);
  await page.getByLabel('일자').fill('2026-03-10');
  const cashRow = page.getByRole('row', { name: /직원 간식/ });
  await expect(cashRow).toContainText('복리후생비');
  await expect(cashRow).toContainText('950,000');
  await expect(page.getByRole('row', { name: /현금 금일/ })).toContainText('50,000');
  await snap(page, 'p1b-09-daily-cash');

  // ── 자금계획: 3/25 급여 120만 출금 예정 → 잔액 부족 ──
  await page.getByRole('link', { name: '자금계획' }).click();
  await expect(page).toHaveURL(/\/accounting\/reports\/cash-plan/);
  await page.getByLabel('시작일').fill('2026-03-11');
  await page.getByLabel('종료일').fill('2026-03-31');
  await page.getByLabel('예정일').fill('2026-03-25');
  await page.getByLabel('입출금').selectOption('out');
  await page.getByLabel('예정 금액').fill('1200000');
  await page.getByLabel('내용').fill('3월 급여');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.getByText('예정 입출금을 추가했습니다.')).toBeVisible();
  await expect(page.getByRole('row', { name: /현재 잔액/ })).toContainText('950,000');
  const payroll = page.getByRole('row', { name: /3월 급여.*-250,000/ });
  await expect(payroll).toContainText('1,200,000');
  await expect(page.getByText('2026-03-25부터 자금 부족 예상')).toBeVisible();
  await snap(page, 'p1b-10-cash-plan');

  // 실제로 지급했으면 완료 처리 → 계획에서 빠진다
  await page.getByLabel('3월 급여 완료').check();
  await expect(page.getByText('2026-03-25부터 자금 부족 예상')).toBeHidden();
  await expect(page.getByText('기간 중 최저 950,000원')).toBeVisible();
});
