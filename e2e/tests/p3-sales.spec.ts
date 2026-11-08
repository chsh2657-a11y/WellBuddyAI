import { expect, type Page, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

async function pick(page: Page, combobox: string, text: string, option: RegExp) {
  await page.getByRole('combobox', { name: combobox }).fill(text);
  await page.getByRole('option', { name: option }).click();
}

test('판매 흐름: 견적서 → 주문서 → 출고(매출원가) → 판매(매출) → 거래명세서 인쇄 → 재고', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signupWithCompany(page, 'p3-sales', '판매상사');
  const api = page.request;
  const post = async (path: string, data: object) => {
    const res = await api.post(`/api/${path}`, { data });
    expect(res.status(), `${path} ${await res.text()}`).toBe(201);
    return (await res.json()) as { id: string };
  };
  await post('partners', { name: '한빛상사', kind: 'customer', bizRegNo: '220-81-12341' });
  const supplier = await post('partners', { name: '대한물산', kind: 'supplier' });
  const toner = await post('items', { name: '레이저 토너', unit: 'BOX', salesPrice: 55_000 });
  await post('trade-docs', {
    kind: 'receipt',
    docDate: today,
    partnerId: supplier.id,
    lines: [{ itemId: toner.id, qty: 10, unitPrice: 40_000 }],
  });
  const accounts = (await (await api.get('/api/accounts')).json()) as {
    id: string;
    code: string;
  }[];
  const closing = async (code: string) =>
    (
      (await (
        await api.get(
          `/api/reports/account-ledger?accountId=${accounts.find((a) => a.code === code)!.id}&from=${today.slice(0, 4)}-01-01&to=${today}`,
        )
      ).json()) as { closing: number }
    ).closing;

  // ── 견적서 ──
  await page.goto('/sales');
  await expect(page).toHaveURL(/\/sales\/sales/);
  await page.getByRole('link', { name: '새 견적서' }).click();
  await pick(page, '거래처', '한빛', /한빛상사/);
  await pick(page, '1행 품목', '토너', /레이저 토너/);
  await expect(page.getByLabel('1행 단가')).toHaveValue('55,000'); // 품목 판매단가
  await page.getByLabel('1행 수량').fill('5');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(/견적서 QT-\d{8}-001을\(를\) 저장했습니다\./)).toBeVisible();

  // ── 주문서(4개) ──
  await page.getByRole('link', { name: '주문서 만들기' }).click();
  await page.getByLabel('1행 수량').fill('4');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(/주문서 SO-\d{8}-001을\(를\) 저장했습니다\./)).toBeVisible();

  // ── 출고(3개): 매출원가 전표 ──
  await page.getByRole('link', { name: '출고 만들기' }).click();
  await page.getByLabel('1행 수량').fill('3');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(/출고 SH-\d{8}-001을\(를\) 저장했습니다\./)).toBeVisible();
  await expect(page.getByRole('link', { name: /\(전기\)$/ })).toHaveCount(1);
  expect(await closing('451')).toBe(120_000);
  expect(await closing('146')).toBe(280_000);

  // ── 판매(출고에서 전환, 단가 56,000) ──
  await page.getByRole('link', { name: '판매 만들기' }).click();
  await page.getByLabel('1행 단가').fill('56000');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(/판매 SL-\d{8}-001을\(를\) 저장했습니다\./)).toBeVisible();
  expect(await closing('401')).toBe(168_000);
  expect(await closing('108')).toBe(184_800);

  // ── 거래명세서 인쇄 ──
  await page.getByRole('link', { name: '거래명세서 인쇄' }).click();
  const sheet = page.getByRole('article', { name: '거래명세서' });
  await expect(sheet).toContainText('일금 일십팔만사천팔백원정');
  await expect(sheet).toContainText('판매상사');
  await expect(sheet).toContainText('한빛상사');
  await expect(sheet).toContainText('220-81-12341');
  await expect(sheet).toContainText('레이저 토너');
  await snap(page, 'p3-04-statement');

  // ── 재고·목록 ──
  await page.goto('/sales/inventory');
  await expect(
    page.getByRole('table', { name: '현재고' }).getByRole('row', { name: /레이저 토너/ }),
  ).toContainText('280,000');
  await page.goto('/sales/sales');
  const list = page.getByRole('table', { name: '판매 문서' });
  await expect(list.getByRole('row')).toHaveCount(5); // 머리글 + 견적·주문·출고·판매
  await expect(list.getByRole('row', { name: /견적서 QT-/ })).toContainText('진행 중');
  await snap(page, 'p3-04-sales-list');
});
