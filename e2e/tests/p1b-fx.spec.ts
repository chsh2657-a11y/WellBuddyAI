import { expect, type Page, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const combo = (page: Page, name: string) => page.getByRole('combobox', { name, exact: true });

test('외화: 환율 등록 → 외화 전표 입력 → 기말 외화평가 → 원장·시산표 확인', async ({ page }) => {
  await signupWithCompany(page, 'p1b-fx', '외화상사');

  // ── 데이터 준비(API): 거래처, 기초잔액 ──
  const api = page.request;
  const accounts = (await (await api.get('/api/accounts')).json()) as {
    id: string;
    code: string;
  }[];
  const acc = Object.fromEntries(accounts.map((a) => [a.code, a.id])) as Record<string, string>;
  await api.post('/api/partners', { data: { name: 'Global Inc', kind: 'customer' } });
  const fy = (await (await api.post('/api/fiscal-years', { data: { date: '2026-01-01' } })).json())
    .id as string;
  const opening = await api.put(`/api/fiscal-years/${fy}/opening-balances`, {
    data: {
      lines: [
        { accountId: acc['101'], debit: 5_000_000, credit: 0 },
        { accountId: acc['331'], debit: 0, credit: 5_000_000 },
      ],
    },
  });
  expect(opening.ok()).toBe(true);

  // ── 환율 등록 ──
  await page.getByRole('link', { name: '회계' }).click();
  await page.getByRole('link', { name: '환율·외화평가' }).click();
  await expect(page).toHaveURL(/\/accounting\/fx/);
  await page.getByLabel('통화', { exact: true }).selectOption('USD');
  await page.getByLabel('환율 일자').fill('2026-03-02');
  await page.getByLabel('환율', { exact: true }).fill('1350');
  await page.getByRole('button', { name: '환율 저장' }).click();
  await expect(page.getByText('2026-03-02 USD 환율을 저장했습니다.')).toBeVisible();
  await expect(page.getByRole('row', { name: /2026-03-02/ })).toContainText('1,350');

  // ── 외화 전표: 통화를 고르면 전표 일자의 환율을 불러오고, 외화금액 × 환율이 원화로 ──
  await page.getByRole('link', { name: '전표입력' }).click();
  await expect(page).toHaveURL(/\/accounting\/journals\/new/);
  await page.getByLabel('일자', { exact: true }).fill('2026-03-10');
  await page.getByRole('switch', { name: '외화 입력' }).click();
  await combo(page, '1행 계정과목').fill('108');
  await combo(page, '1행 계정과목').press('Enter');
  await combo(page, '1행 거래처').fill('Global');
  await combo(page, '1행 거래처').press('Enter');
  await page.getByLabel('1행 통화').selectOption('USD');
  await expect(page.getByLabel('1행 환율')).toHaveValue('1350');
  await page.getByLabel('1행 외화금액').fill('2000');
  await expect(page.getByLabel('1행 차변')).toHaveValue('2,700,000');
  await combo(page, '2행 계정과목').fill('401');
  await combo(page, '2행 계정과목').press('Enter');
  await page.getByLabel('2행 대변').fill('2700000');
  await snap(page, 'p1b-03-foreign-journal');
  await page.getByRole('button', { name: '전기', exact: true }).click();
  await expect(page.getByText('2026-03-10-1 전표를 전기했습니다.')).toBeVisible();

  // ── 기말 외화평가: USD 1,400 → 외상매출금 +100,000 ──
  const rate = await api.put('/api/exchange-rates', {
    data: { currency: 'USD', rateDate: '2026-03-31', rate: '1400' },
  });
  expect(rate.ok()).toBe(true);
  await page.getByRole('link', { name: '환율·외화평가' }).click();
  await expect(page).toHaveURL(/\/accounting\/fx/);
  await page.getByLabel('평가일').fill('2026-03-31');
  const row = page.getByRole('row', { name: /108 외상매출금/ });
  await expect(row).toContainText('USD 2,000.00');
  await expect(row).toContainText('2,800,000');
  await expect(row).toContainText('+100,000');
  await page.getByRole('button', { name: '외화평가 실행' }).click();
  await expect(page.getByText('2026-03-31 외화평가를 전기했습니다')).toBeVisible();
  await expect(page.getByRole('button', { name: '2026-03-31 외화평가 취소' })).toBeVisible();
  await snap(page, 'p1b-04-fx-revaluation');

  // 평가 전표: 외상매출금 줄에 통화·환율이 남는다
  await page.getByRole('link', { name: '2026-03-31-1' }).click();
  await expect(page).toHaveURL(/\/accounting\/journals\/[0-9a-f-]{36}/);
  await expect(page.getByText('USD 0.00 @ 1400')).toBeVisible();

  // ── 원장: 외상매출금 원화 잔액 = USD 2,000 × 1,400, 시산표 대차 일치 ──
  await page.goto(
    `/accounting/reports/ledger?accountId=${acc['108']}&from=2026-01-01&to=2026-12-31`,
  );
  const total = page.locator('tr', {
    has: page.getByRole('cell', { name: '합계', exact: true }),
  });
  await expect(total).toContainText('2,800,000');
  const tb = await (await api.get('/api/reports/trial-balance?date=2026-12-31')).json();
  expect(tb.balanced).toBe(true);
  const is = await (
    await api.get('/api/reports/income-statement?from=2026-01-01&to=2026-12-31')
  ).json();
  expect(is.netIncome).toBe(2_700_000 + 100_000);
});
