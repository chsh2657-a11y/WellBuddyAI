import { expect, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('영업 기초정보: 품목 등록·엑셀 일괄등록, 창고 추가, 거래처별 단가', async ({ page }) => {
  const tab = (name: string) =>
    page.getByRole('navigation', { name: '영업 메뉴' }).getByRole('link', { name, exact: true });
  await signupWithCompany(page, 'p3-master', '영업상사');

  // ── 메뉴: 영업·구매·재고가 열려 있다(준비 중 아님) ──
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('link', { name: '영업·구매·재고' })
    .click();
  await expect(page).toHaveURL(/\/sales\/sales/);
  await tab('품목').click();
  await expect(page.getByText('품목이 없습니다.', { exact: false })).toBeVisible();

  // ── 품목 추가 ──
  await page.getByRole('button', { name: '품목 추가' }).click();
  const dialog = page.getByRole('dialog', { name: '품목 추가' });
  await dialog.getByLabel('품목명').fill('레이저 토너');
  await dialog.getByLabel('규격').fill('HP 85A');
  await dialog.getByLabel('단위').fill('BOX');
  await dialog.getByLabel('바코드').fill('8801234567890');
  await dialog.getByLabel('판매단가').fill('55000');
  await dialog.getByLabel('구매단가').fill('40000');
  await dialog.getByLabel('적정재고').fill('3');
  await expect(dialog.getByLabel('매출 계정')).toContainText('기본(401 상품매출)');
  await dialog.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('품목을 추가했습니다.')).toBeVisible();
  const items = page.getByRole('table', { name: '품목' });
  const toner = items.getByRole('row', { name: /레이저 토너/ });
  await expect(toner).toContainText('00001');
  await expect(toner).toContainText('55,000');
  await expect(toner).toContainText('8801234567890');

  // 서비스로 바꾸면 재고 설정(LOT·시리얼·적정재고)이 사라진다. 새로 열면 이전 입력이 남지 않는다
  await page.getByRole('button', { name: '품목 추가' }).click();
  await expect(dialog.getByLabel('규격')).toHaveValue('');
  await expect(dialog.getByLabel('바코드')).toHaveValue('');
  await dialog.getByLabel('품목명').fill('설치비');
  await dialog.getByLabel('구분', { exact: true }).selectOption({ label: '서비스' });
  await expect(dialog.getByLabel('적정재고')).toHaveCount(0);
  await expect(dialog.getByRole('switch', { name: 'LOT 관리' })).toHaveCount(0);
  await expect(dialog.getByLabel('매출 계정')).toContainText('기본(411 용역매출)');
  await dialog.getByRole('button', { name: '저장' }).click();
  await expect(items.getByRole('row', { name: /설치비/ })).toContainText('서비스');

  // ── 엑셀 일괄 등록 ──
  await page.getByRole('button', { name: '엑셀 업로드' }).click();
  const upload = page.getByRole('dialog');
  await expect(upload.getByRole('link', { name: '양식 내려받기' })).toHaveAttribute(
    'href',
    '/api/imports/items/template',
  );
  const csv = [
    '품목코드,품목명,구분,규격,단위,바코드,과세구분,판매단가,구매단가,적정재고',
    ',A4 복사용지,상품,80g 500매,BOX,,과세,"25,000","18,000",10',
    ',쌀 10kg,상품,,포대,,면세,32000,,',
  ].join('\n');
  await upload.getByLabel('엑셀 파일 선택').setInputFiles({
    name: '품목.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(upload.getByText('정상 2행')).toBeVisible();
  await upload.getByRole('button', { name: '등록', exact: true }).click();
  await expect(page.getByText('2건 추가, 0건 수정', { exact: false })).toBeVisible();
  await expect(items.getByRole('row', { name: /A4 복사용지/ })).toContainText('25,000');
  await expect(items.getByRole('row', { name: /쌀 10kg/ })).toContainText('면세');
  await snap(page, 'p3-01-items');

  // 검색
  await page.getByLabel('품목 검색').fill('8801234');
  await expect(items.getByRole('row')).toHaveCount(2); // 머리글 + 토너
  await page.getByLabel('품목 검색').fill('');

  // ── 창고 ──
  await tab('창고').click();
  const warehouses = page.getByRole('table', { name: '창고' });
  await expect(warehouses.getByRole('row', { name: /기본창고/ })).toContainText('W01');
  await page.getByRole('button', { name: '창고 추가' }).click();
  const wDialog = page.getByRole('dialog', { name: '창고 추가' });
  await wDialog.getByLabel('창고명').fill('부산창고');
  await wDialog.getByLabel('주소').fill('부산 강서구');
  await wDialog.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('창고를 추가했습니다.')).toBeVisible();
  await expect(warehouses.getByRole('row', { name: /부산창고/ })).toContainText('W02');
  await snap(page, 'p3-02-warehouses');

  // ── 거래처별 단가 ──
  const api = page.request;
  expect(
    (
      await api.post('/api/partners', {
        data: { name: '한빛상사', kind: 'customer', bizRegNo: '220-81-12341' },
      })
    ).status(),
  ).toBe(201);
  await tab('거래처별 단가').click();
  await expect(page.getByText('거래처를 먼저 골라 주세요.')).toBeVisible();
  await page.getByRole('combobox', { name: '거래처' }).fill('한빛');
  await page.getByRole('option', { name: /한빛상사/ }).click();
  const prices = page.getByRole('table', { name: '거래처별 단가' });
  const row = prices.getByRole('row', { name: /레이저 토너/ });
  await expect(row).toContainText('55,000');
  await row.getByLabel('레이저 토너 거래처 판매단가').fill('52000');
  await row.getByRole('button', { name: '레이저 토너 단가 저장' }).click();
  await expect(page.getByText('레이저 토너 단가를 저장했습니다.')).toBeVisible();
  await expect(row).toContainText('거래처 단가');
  await snap(page, 'p3-03-prices');

  // 저장한 단가는 판매 단가 조회에 먼저 쓰인다
  const tonerItem = (
    (await (await api.get('/api/items?q=8801234567890')).json()) as { id: string }[]
  )[0]!;
  const partner = ((await (await api.get('/api/partners?q=한빛')).json()) as { id: string }[])[0]!;
  const price = await (
    await api.get(`/api/items/${tonerItem.id}/price?side=sales&partnerId=${partner.id}`)
  ).json();
  expect(price).toEqual({ unitPrice: 52_000, source: 'partner' });
});
