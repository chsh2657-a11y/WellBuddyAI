import { expect, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

test('구매 흐름: 발주서 → 입고(일부) → 구매(단가 수정) → 재고·수불부 → 구매 취소', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signupWithCompany(page, 'p3-purchase', '구매상사');
  const api = page.request;
  expect(
    (
      await api.post('/api/partners', {
        data: { name: '대한물산', kind: 'supplier', bizRegNo: '105-81-34560' },
      })
    ).status(),
  ).toBe(201);
  for (const item of [
    { name: '레이저 토너', unit: 'BOX', purchasePrice: 40_000 },
    { name: 'A4 용지', unit: 'BOX', purchasePrice: 3_000 },
  ]) {
    expect((await api.post('/api/items', { data: item })).status()).toBe(201);
  }
  const accounts = (await (await api.get('/api/accounts')).json()) as {
    id: string;
    code: string;
  }[];
  const inventoryAccount = accounts.find((a) => a.code === '146')!.id;
  const balance146 = async () =>
    (
      (await (
        await api.get(
          `/api/reports/account-ledger?accountId=${inventoryAccount}&from=${today.slice(0, 4)}-01-01&to=${today}`,
        )
      ).json()) as { closing: number }
    ).closing;

  // ── 발주서 ──
  await page.goto('/sales/purchases');
  await expect(page.getByText('문서가 없습니다.')).toBeVisible();
  await page.getByRole('link', { name: '새 발주서' }).click();
  await expect(page.getByText('발주서 입력')).toBeVisible();
  await page.getByRole('combobox', { name: '거래처' }).fill('대한');
  await page.getByRole('option', { name: /대한물산/ }).click();
  await page.getByRole('combobox', { name: '1행 품목' }).fill('토너');
  await page.getByRole('option', { name: /레이저 토너/ }).click();
  await page.getByLabel('1행 수량').fill('10');
  await expect(page.getByLabel('1행 단가')).toHaveValue('40,000'); // 품목 구매단가
  await page.getByRole('button', { name: '줄 추가' }).click();
  await page.getByRole('combobox', { name: '2행 품목' }).fill('A4');
  await page.getByRole('option', { name: /A4 용지/ }).click();
  await page.getByLabel('2행 수량').fill('5');
  await expect(page.getByRole('table', { name: '품목 줄' }).locator('tfoot')).toContainText(
    '합계 456,500',
  );
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(/발주서 PO-\d{8}-001을\(를\) 저장했습니다\./)).toBeVisible();
  await expect(page.getByRole('heading', { name: /발주서 PO-/ })).toContainText('진행 중');
  const poUrl = page.url();

  // ── 입고(토너 6개만) ──
  await page.getByRole('link', { name: '입고 만들기' }).click();
  await expect(page.getByText(/발주서 PO-\d{8}-001에서 만듭니다/)).toBeVisible();
  await expect(page.getByLabel('1행 수량')).toHaveValue('10');
  await page.getByLabel('1행 수량').fill('6');
  await page.getByRole('button', { name: '2행 지우기' }).click();
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(/입고 RC-\d{8}-001을\(를\) 저장했습니다\./)).toBeVisible();
  await expect(page.getByRole('link', { name: /-\d+\(전기\)$/ })).toBeVisible();
  expect(await balance146()).toBe(240_000);

  await page.goto(poUrl);
  const poLines = page.getByRole('table', { name: '문서 줄' });
  await expect(poLines.getByRole('row', { name: /레이저 토너/ })).toContainText(/4$/);
  await expect(page.getByRole('heading', { name: /발주서/ })).toContainText('진행 중');
  await page.getByRole('link', { name: /입고 RC-/ }).click();

  // ── 구매로 전환(단가 39,000) ──
  await page.getByRole('link', { name: '구매 만들기' }).click();
  await expect(page.getByText('줄은 그대로 옮기고 단가만 고칠 수 있습니다.')).toBeVisible();
  await expect(page.getByLabel('1행 수량')).toHaveAttribute('readonly', '');
  await page.getByLabel('1행 단가').fill('39000');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(/구매 PU-\d{8}-001을\(를\) 저장했습니다\./)).toBeVisible();
  const purchaseUrl = page.url();
  await expect(page.getByRole('table', { name: '문서 줄' }).locator('tfoot')).toContainText(
    '합계 257,400',
  );
  await snap(page, 'p3-06-purchase');

  // ── 재고: 구매 단가로 재고금액, 수불부 ──
  await page
    .getByRole('navigation', { name: '영업 메뉴' })
    .getByRole('link', { name: '재고', exact: true })
    .click();
  const stock = page.getByRole('table', { name: '현재고' });
  const toner = stock.getByRole('row', { name: /레이저 토너/ });
  await expect(toner).toContainText('6 BOX');
  await expect(toner).toContainText('39,000');
  await expect(toner).toContainText('234,000');
  await toner.click();
  const ledger = page.getByRole('table', { name: '재고수불부' });
  await expect(ledger.getByRole('row', { name: /입고 RC-/ })).toContainText('234,000');
  await snap(page, 'p3-09-inventory');
  expect(await balance146()).toBe(234_000);

  // ── 구매 취소: 입고 단가로 되돌아간다 ──
  await page.goto(purchaseUrl);
  page.once('dialog', (d) => void d.accept('단가 오류'));
  await page.getByRole('button', { name: '취소' }).click();
  await expect(page.getByText(/PU-\d{8}-001을\(를\) 취소했습니다\./)).toBeVisible();
  await expect(page.getByText('취소 사유: 단가 오류')).toBeVisible();
  expect(await balance146()).toBe(240_000);

  // 목록
  await page.goto('/sales/purchases');
  const list = page.getByRole('table', { name: '구매 문서' });
  await expect(list.getByRole('row')).toHaveCount(4); // 머리글 + 발주·입고·구매
  await expect(list.getByRole('row', { name: /PU-/ })).toContainText('취소');
  await page
    .getByRole('group', { name: '문서 종류' })
    .getByRole('button', { name: '입고' })
    .click();
  await expect(list.getByRole('row')).toHaveCount(2);
});
