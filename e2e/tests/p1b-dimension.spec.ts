import { expect, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('부서·프로젝트별 손익: 부서 열과 미지정 열, 프로젝트별 전환', async ({ page }) => {
  await signupWithCompany(page, 'p1b-dim', '부서상사');

  // ── 데이터 준비(API): 영업부·관리부, 프로젝트 P1, 2026년 2월 전표 ──
  const api = page.request;
  const accounts = (await (await api.get('/api/accounts')).json()) as {
    id: string;
    code: string;
  }[];
  const acc = Object.fromEntries(accounts.map((a) => [a.code, a.id])) as Record<string, string>;
  const sales = (
    await (await api.post('/api/departments', { data: { code: 'S', name: '영업부' } })).json()
  ).id as string;
  const admin = (
    await (await api.post('/api/departments', { data: { code: 'A', name: '관리부' } })).json()
  ).id as string;
  const p1 = (
    await (await api.post('/api/projects', { data: { code: 'P1', name: '신제품' } })).json()
  ).id as string;
  const post = async (lines: object[]) => {
    const res = await api.post('/api/journals', {
      data: { entry: { entryDate: '2026-02-10', lines }, status: 'posted' },
    });
    expect(res.status(), await res.text()).toBe(201);
  };
  await post([
    { accountId: acc['101'], debit: 1_000_000, credit: 0 },
    { accountId: acc['401'], debit: 0, credit: 1_000_000, departmentId: sales, projectId: p1 },
  ]);
  await post([
    { accountId: acc['811'], debit: 100_000, credit: 0, departmentId: admin },
    { accountId: acc['101'], debit: 0, credit: 100_000 },
  ]);
  await post([
    { accountId: acc['811'], debit: 20_000, credit: 0 },
    { accountId: acc['101'], debit: 0, credit: 20_000 },
  ]);

  await page.getByRole('link', { name: '회계' }).click();
  await page.getByRole('link', { name: '장부·보고서' }).click();
  await page.getByRole('link', { name: '부서·프로젝트별 손익' }).click();
  await expect(page).toHaveURL(/\/accounting\/reports\/dimension-pl/);
  await page.getByLabel('시작일').fill('2026-01-01');
  await page.getByLabel('종료일').fill('2026-12-31');
  await expect(page.getByRole('columnheader', { name: '영업부' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '미지정' })).toBeVisible();
  // 손익: 관리부 -100,000 · 영업부 1,000,000 · 미지정 -20,000 · 합계 880,000
  const profit = page.getByRole('row', { name: /^손익/ });
  await expect(profit).toContainText('-100,000');
  await expect(profit).toContainText('880,000');
  await snap(page, 'p1b-11-dimension-pl');

  await page.getByRole('tab', { name: '프로젝트별' }).click();
  await expect(page.getByRole('columnheader', { name: '신제품' })).toBeVisible();
  await expect(page.getByRole('row', { name: /^손익/ })).toContainText('1,000,000');
});
