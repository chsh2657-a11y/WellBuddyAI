import { readFile, stat } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** 보고서 표의 "합계" 행 */
const totalRow = (page: Page) =>
  page.locator('tr', { has: page.getByRole('cell', { name: '합계', exact: true }) });

test('장부·보고서: 시산표 대차 일치, 재무제표, 엑셀·PDF, 거래처원장, 연령분석, 대시보드', async ({
  page,
}) => {
  await signupWithCompany(page, 'p1-reports', '보고서상사');
  const today = await page.evaluate(() =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()),
  );

  // ── 데이터 준비(API): 기초잔액 + 오늘 전표 3건 ──
  const api = page.request;
  const accounts = (await (await api.get('/api/accounts')).json()) as {
    id: string;
    code: string;
  }[];
  const acc = Object.fromEntries(accounts.map((a) => [a.code, a.id])) as Record<string, string>;
  const hanbit = (
    await (await api.post('/api/partners', { data: { name: '한빛상사', kind: 'customer' } })).json()
  ).id as string;
  const fy = (await (await api.post('/api/fiscal-years', { data: { date: today } })).json())
    .id as string;
  const opening = await api.put(`/api/fiscal-years/${fy}/opening-balances`, {
    data: {
      lines: [
        { accountId: acc['101'], debit: 1_000_000, credit: 0 },
        { accountId: acc['331'], debit: 0, credit: 1_000_000 },
      ],
    },
  });
  expect(opening.ok()).toBe(true);
  const post = async (entry: object) => {
    const res = await api.post('/api/journals', { data: { entry, status: 'posted' } });
    expect(res.status(), await res.text()).toBe(201);
  };
  await post({
    entryDate: today,
    type: 'sales',
    description: '한빛상사 외상 매출',
    vat: {
      vatType: 'taxable',
      evidenceType: 'tax_invoice',
      supplyAmount: 1_000_000,
      vatAmount: 100_000,
      partnerId: hanbit,
    },
    lines: [
      { accountId: acc['108'], debit: 1_100_000, credit: 0, partnerId: hanbit },
      { accountId: acc['401'], debit: 0, credit: 1_000_000 },
      { accountId: acc['255'], debit: 0, credit: 100_000 },
    ],
  });
  await post({
    entryDate: today,
    description: '직원 간식',
    lines: [
      { accountId: acc['811'], debit: 50_000, credit: 0 },
      { accountId: acc['101'], debit: 0, credit: 50_000 },
    ],
  });
  await post({
    entryDate: today,
    type: 'receipt',
    description: '외상대금 회수',
    lines: [
      { accountId: acc['101'], debit: 600_000, credit: 0 },
      { accountId: acc['108'], debit: 0, credit: 600_000, partnerId: hanbit },
    ],
  });

  // ── 일계표 ──
  await page.getByRole('link', { name: '회계' }).click();
  await page.getByRole('link', { name: '장부·보고서' }).click();
  await expect(page).toHaveURL(/\/accounting\/reports\/daily/);
  await expect(page.getByRole('heading', { name: '일계표' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '811 복리후생비' })).toBeVisible();
  // 금일 합계: 차변 = 대변 (소계 + 금일 현금 = 소계 + 전일 현금)
  const total = totalRow(page);
  await expect(total.getByRole('cell').first()).toHaveText(
    await total.getByRole('cell').last().innerText(),
  );
  await snap(page, 'p1-09-daily');

  // ── 합계잔액시산표 ──
  await page.getByRole('link', { name: '합계잔액시산표' }).click();
  await expect(page.getByText('대차 일치')).toBeVisible();
  await snap(page, 'p1-10-trial-balance');

  // ── 재무제표: 자산 = 부채 + 자본, 손익계산서 ──
  await page.getByRole('link', { name: '재무제표' }).click();
  await expect(page.getByText('자산 = 부채 + 자본')).toBeVisible();
  await expect(page.getByRole('row', { name: /자산총계/ })).toContainText('2,050,000');
  await page.getByRole('tab', { name: '손익계산서' }).click();
  await expect(page.getByRole('row', { name: /당기순이익/ })).toContainText('950,000');

  // 엑셀 내려받기
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '엑셀', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^손익계산서_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const xlsx = await readFile((await download.path())!);
  expect(xlsx.subarray(0, 2).toString()).toBe('PK'); // zip(xlsx) 파일

  // 인쇄·PDF: 메뉴는 숨기고 보고서만 인쇄
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeHidden();
  await expect(page.getByRole('button', { name: '인쇄·PDF' })).toBeHidden();
  await expect(page.getByRole('heading', { name: '손익계산서' })).toBeVisible();
  await snap(page, 'p1-11-income-statement-print');
  const pdfPath = 'test-results/screens/p1-income-statement.pdf';
  await page.pdf({ path: pdfPath, format: 'A4' });
  expect((await stat(pdfPath)).size).toBeGreaterThan(1000);
  await page.emulateMedia({ media: 'screen' });

  // ── 거래처원장 → 거래처를 누르면 줄 단위 원장 ──
  await page.getByRole('link', { name: '거래처원장' }).click();
  await expect(page.getByRole('row', { name: /한빛상사/ })).toContainText('500,000');
  await page.getByRole('link', { name: '한빛상사' }).click();
  await expect(page).toHaveURL(/\/accounting\/reports\/ledger\?.*partnerId=/);
  await expect(page.getByRole('heading', { name: '거래처원장' })).toBeVisible();
  await expect(totalRow(page)).toContainText('500,000');

  // ── 채권 연령분석 ──
  await page.getByRole('link', { name: '채권·채무' }).click();
  await expect(page.getByRole('row', { name: /한빛상사/ })).toContainText('500,000');

  // ── 대시보드 ──
  await page.getByRole('link', { name: '대시보드' }).click();
  await expect(page.getByRole('link', { name: '현금', exact: true })).toContainText('1,550,000원');
  await expect(page.getByRole('link', { name: '미수금(받을 돈)' })).toContainText('500,000원');
  await expect(page.getByRole('img', { name: '월별 매출·비용 막대그래프' })).toBeVisible();
  await snap(page, 'p1-12-dashboard');
});
