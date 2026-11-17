import { expect, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('적정재고 미달 → 발주서, 바코드 스캔 입고(LOT), LOT 수불부, 바코드 실사', async ({ page }) => {
  test.setTimeout(120_000);
  await signupWithCompany(page, 'p3-lot', '추적상사');
  const api = page.request;
  expect(
    (await api.post('/api/partners', { data: { name: '대한제약', kind: 'supplier' } })).status(),
  ).toBe(201);
  for (const data of [
    {
      name: '레이저 토너',
      unit: 'BOX',
      barcode: 'TONER-001',
      purchasePrice: 40_000,
      safetyStock: 5,
    },
    { name: '백신', unit: 'EA', barcode: '8801234567893', trackLot: true, purchasePrice: 9_000 },
  ]) {
    expect((await api.post('/api/items', { data })).status()).toBe(201);
  }

  // ── 대시보드: 적정재고 미달 → 모자란 수량으로 발주서 ──
  await page.goto('/dashboard');
  await expect(page.getByText('적정재고 미달')).toBeVisible();
  await expect(page.getByText('5 BOX 부족')).toBeVisible();
  await page.getByRole('link', { name: '발주서 만들기' }).click();
  await expect(page.getByText('발주서 입력')).toBeVisible();
  await expect(page.getByRole('combobox', { name: '1행 품목' })).toHaveValue(/레이저 토너/);
  await expect(page.getByLabel('1행 수량')).toHaveValue('5');
  await page.getByRole('combobox', { name: '거래처' }).fill('대한');
  await page.getByRole('option', { name: /대한제약/ }).click();
  await expect(page.getByLabel('1행 단가')).toHaveValue('40,000');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(/발주서 PO-\d{8}-001을\(를\) 저장했습니다\./)).toBeVisible();

  // ── 바코드로 입고: 같은 바코드 두 번이면 수량 2, LOT 품목은 LOT 번호 ──
  await page.goto('/sales/docs/new?kind=receipt');
  await page.getByRole('combobox', { name: '거래처' }).fill('대한');
  await page.getByRole('option', { name: /대한제약/ }).click();
  const barcode = page.getByLabel('바코드', { exact: true });
  await barcode.fill('TONER-001');
  await barcode.press('Enter');
  await expect(page.getByRole('combobox', { name: '1행 품목' })).toHaveValue(/레이저 토너/);
  await barcode.fill('TONER-001');
  await barcode.press('Enter');
  await expect(page.getByLabel('1행 수량')).toHaveValue('2');
  await barcode.fill('NO-SUCH-CODE');
  await barcode.press('Enter');
  await expect(page.getByText('바코드 NO-SUCH-CODE에 맞는 품목이 없습니다.')).toBeVisible();
  await barcode.fill('8801234567893');
  await barcode.press('Enter');
  await expect(page.getByRole('combobox', { name: '2행 품목' })).toHaveValue(/백신/);
  await page.getByLabel('2행 수량').fill('10');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(/2행: '백신'은\(는\) LOT 번호를 입력해 주세요\./)).toBeVisible();
  await page.getByLabel('2행 LOT').fill('L2026A');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(/입고 RC-\d{8}-001을\(를\) 저장했습니다\./)).toBeVisible();
  await expect(page.getByText('LOT L2026A')).toBeVisible();

  // ── LOT 수불부 ──
  await page.goto('/sales/inventory');
  await page.getByRole('table', { name: '현재고' }).getByRole('row', { name: /백신/ }).click();
  await page.getByLabel('LOT·시리얼').selectOption('L2026A');
  await expect(
    page.getByRole('table', { name: '재고수불부' }).getByRole('row', { name: /입고 RC-/ }),
  ).toContainText('LOT L2026A');

  // ── 바코드 실사: 스캔한 품목은 1부터 센다(장부 2 → 실사 1) ──
  await page.goto('/sales/inventory/count');
  const count = page.getByRole('table', { name: '재고 실사' });
  await expect(count.getByRole('row', { name: /레이저 토너/ })).toContainText('2 BOX');
  await expect(count.getByRole('row', { name: /백신/ })).toContainText('LOT L2026A');
  const scan = page.getByLabel('바코드', { exact: true });
  await scan.fill('TONER-001');
  await scan.press('Enter');
  await expect(page.getByLabel('레이저 토너 실사 수량')).toHaveValue('1');
  await snap(page, 'p3-13-barcode-count');
  await page.getByRole('button', { name: '차이 1건 조정 저장' }).click();
  await expect(page.getByText(/재고조정 AD-\d{8}-001을\(를\) 저장했습니다\./)).toBeVisible();
});
