import { expect, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

test('재고 문서: 기초재고 → 창고 이동 → 재고 실사(감모 전표) → 장부 대사', async ({ page }) => {
  test.setTimeout(120_000);
  await signupWithCompany(page, 'p3-stock', '재고상사');
  const api = page.request;
  expect((await api.get('/api/warehouses')).status()).toBe(200); // 기본창고
  expect((await api.post('/api/warehouses', { data: { name: '물류센터' } })).status()).toBe(201);
  expect(
    (
      await api.post('/api/items', {
        data: { name: '레이저 토너', unit: 'BOX', purchasePrice: 40_000 },
      })
    ).status(),
  ).toBe(201);

  // ── 기초재고 ──
  await page.goto('/sales/inventory');
  const views = page.getByRole('group', { name: '재고 보기' });
  await views.getByRole('button', { name: '재고 문서' }).click();
  await page.getByRole('link', { name: '새 기초재고' }).click();
  await expect(page.getByText('기초재고 입력')).toBeVisible();
  await expect(page.getByRole('combobox', { name: '거래처' })).toHaveCount(0);
  await page.getByRole('combobox', { name: '1행 품목' }).fill('토너');
  await page.getByRole('option', { name: /레이저 토너/ }).click();
  await page.getByLabel('1행 수량').fill('10');
  await expect(page.getByLabel('1행 단가')).toHaveValue('40,000'); // 품목 구매단가
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(/기초재고 OB-\d{8}-001을\(를\) 저장했습니다\./)).toBeVisible();

  // ── 창고 이동: 기본창고 → 물류센터 4개 ──
  await page.goto('/sales/docs/new?kind=transfer');
  await expect(page.getByLabel('보내는 창고')).toHaveValue(/.+/);
  await expect(page.getByLabel('받는 창고').locator('option:checked')).toHaveText('물류센터');
  await expect(page.getByLabel('1행 단가')).toHaveCount(0);
  await page.getByRole('combobox', { name: '1행 품목' }).fill('토너');
  await page.getByRole('option', { name: /레이저 토너/ }).click();
  await page.getByLabel('1행 수량').fill('4');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(/창고이동 TR-\d{8}-001을\(를\) 저장했습니다\./)).toBeVisible();
  await expect(page.getByText(/기본창고 → 물류센터/)).toBeVisible();

  // ── 재고 실사: 물류센터 장부 4 → 실사 3 ──
  await page.goto('/sales/inventory');
  await views.getByRole('button', { name: '재고 문서' }).click();
  await page.getByRole('link', { name: '재고 실사' }).click();
  await page.getByLabel('창고', { exact: true }).selectOption({ label: '물류센터' });
  const row = page
    .getByRole('table', { name: '재고 실사' })
    .getByRole('row', { name: /레이저 토너/ });
  await expect(row).toContainText('4 BOX');
  await expect(page.getByRole('button', { name: '차이가 없습니다' })).toBeDisabled();
  await page.getByLabel('레이저 토너 실사 수량').fill('3');
  await expect(row).toContainText('-1');
  await snap(page, 'p3-11-stock-count');
  await page.getByRole('button', { name: '차이 1건 조정 저장' }).click();
  await expect(page.getByText(/재고조정 AD-\d{8}-001을\(를\) 저장했습니다\./)).toBeVisible();
  await expect(page.getByRole('link', { name: /\(전기\)$/ })).toHaveCount(1); // 감모 전표

  // ── 장부 대사: 기초 재고자산 전표를 넣으면 재고금액과 일치 ──
  const accounts = (await (await api.get('/api/accounts')).json()) as {
    id: string;
    code: string;
  }[];
  const id = (code: string) => accounts.find((a) => a.code === code)!.id;
  expect(
    (
      await api.post('/api/journals', {
        data: {
          entry: {
            entryDate: today,
            description: '기초 재고자산',
            lines: [
              { accountId: id('146'), debit: 400_000, credit: 0 },
              { accountId: id('331'), debit: 0, credit: 400_000 },
            ],
          },
          status: 'posted',
        },
      })
    ).status(),
  ).toBe(201);
  await page.goto('/sales/inventory');
  await views.getByRole('button', { name: '장부 대사' }).click();
  await expect(
    page.getByRole('table', { name: '재고 장부 대사' }).getByRole('row', { name: /146 상품/ }),
  ).toContainText('360,000');
  await expect(page.getByText('일치', { exact: true }).first()).toBeVisible();
});
