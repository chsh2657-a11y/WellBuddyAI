import { expect, type Page, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** 자동완성 입력칸(목록 이름과 겹치지 않게 역할로 찾는다) */
const combo = (page: Page, name: string) => page.getByRole('combobox', { name, exact: true });

/** 1x1 PNG */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('전표: 키보드로 일반전표 입력, 매입매출전표, 입금 간편입력, 증빙, 역분개', async ({
  page,
}) => {
  await signupWithCompany(page, 'p1-journal', '전표상사');
  const today = await page.evaluate(() =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()),
  );
  await page.request.post('/api/partners', { data: { name: '한빛상사', kind: 'customer' } });

  // ── 일반전표: 키보드만으로 입력 ──
  await page.getByRole('link', { name: '회계' }).click();
  await expect(page).toHaveURL(/\/accounting\/journals\/new/);
  const account1 = combo(page, '1행 계정과목');
  await account1.fill('811');
  await account1.press('Enter');
  await expect(account1).toHaveValue('811 복리후생비');
  // 거래처가 필요 없는 계정이라 차변 칸으로 바로 넘어간다
  await expect(page.getByLabel('1행 차변')).toBeFocused();
  await page.keyboard.type('50000');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('1행 적요')).toBeFocused();
  await page.getByLabel('1행 적요').fill('직원 간식');
  await page.keyboard.press('Enter');
  // 새 줄: 차액이 대변에, 적요가 이어서 들어간다
  const account2 = combo(page, '2행 계정과목');
  await expect(account2).toBeFocused();
  await expect(page.getByLabel('2행 대변')).toHaveValue('50,000');
  await expect(page.getByLabel('2행 적요')).toHaveValue('직원 간식');
  await account2.fill('ㅎㄱ'); // 초성 검색
  await account2.press('Enter');
  await expect(account2).toHaveValue('101 현금');
  await page.getByLabel('증빙 파일').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(page.getByRole('link', { name: 'receipt.png' })).toBeVisible();
  await snap(page, 'p1-05-journal-general');
  await page.getByLabel('2행 대변').press('Control+Enter');
  await expect(page.getByText(`${today}-1 전표를 전기했습니다.`)).toBeVisible();
  await expect(combo(page, '1행 계정과목')).toHaveValue('');

  // ── 매입매출전표: 공급가액만 넣으면 부가세·분개가 만들어진다 ──
  await page.getByRole('tab', { name: '매입매출전표' }).click();
  await combo(page, '거래처').fill('한빛');
  await combo(page, '거래처').press('Enter');
  await page.getByLabel('공급가액').fill('1000000');
  await page.getByLabel('공급가액').blur();
  await expect(page.getByLabel('부가세', { exact: true })).toHaveValue('100,000');
  await expect(combo(page, '1행 계정과목')).toHaveValue('108 외상매출금');
  await expect(combo(page, '1행 거래처')).toHaveValue(/한빛상사/);
  await expect(page.getByLabel('1행 차변')).toHaveValue('1,100,000');
  await expect(combo(page, '3행 계정과목')).toHaveValue('255 부가세예수금');
  await snap(page, 'p1-06-journal-sales');
  await page.getByRole('button', { name: '전기', exact: true }).click();
  await expect(page.getByText(`${today}-2 전표를 전기했습니다.`)).toBeVisible();

  // ── 입금 간편입력: 외상대금 회수 ──
  await page.getByRole('link', { name: '입금·출금' }).click();
  const counter = combo(page, '1행 계정과목');
  await counter.fill('108');
  await counter.press('Enter');
  // 외상매출금은 거래처가 필요하므로 거래처 칸으로 간다
  await expect(combo(page, '1행 거래처')).toBeFocused();
  await combo(page, '1행 거래처').fill('한빛');
  await combo(page, '1행 거래처').press('Enter');
  await expect(page.getByLabel('1행 금액')).toBeFocused();
  await page.keyboard.type('1100000');
  await page.keyboard.press('Enter');
  await page.getByLabel('1행 적요').fill('외상대금 회수');
  await page.getByRole('button', { name: '전기', exact: true }).click();
  await expect(page.getByText('1건을 저장했습니다.')).toBeVisible();

  // ── 전표조회 → 증빙 확인 → 역분개 ──
  await page.getByRole('link', { name: '전표조회' }).click();
  await expect(page.getByRole('link', { name: `${today}-3` })).toBeVisible();
  await expect(page.getByRole('cell', { name: '외상대금 회수' })).toBeVisible();
  await snap(page, 'p1-07-journal-list');

  await page.getByRole('link', { name: `${today}-1` }).click();
  await expect(page.getByRole('link', { name: 'receipt.png' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '복리후생비' })).toBeVisible();

  await page.getByRole('link', { name: '전표조회' }).first().click();
  await page.getByRole('link', { name: `${today}-2` }).click();
  await page.getByRole('button', { name: '역분개' }).click();
  await page.getByRole('button', { name: '역분개 전표 만들기' }).click();
  await expect(page.getByText('다른 전표를 취소한 역분개 전표입니다.')).toBeVisible();
  await expect(page.getByRole('cell', { name: '외상매출금' })).toBeVisible();
  await snap(page, 'p1-08-journal-reversal');

  // ── P1-23: 화면에서 입력·전기한 전표가 장부까지 맞는지 ──
  // 복리후생비 5만(현금), 매출 110만(역분개로 취소), 외상대금 회수 110만
  await page.getByRole('link', { name: '장부·보고서' }).click();
  await page.getByRole('link', { name: '합계잔액시산표' }).click();
  await expect(page.getByText('대차 일치')).toBeVisible();
  await expect(page.getByRole('cell', { name: '811 복리후생비' })).toBeVisible();

  await page.getByRole('link', { name: '재무제표' }).click();
  await expect(page.getByText('자산 = 부채 + 자본')).toBeVisible();
  await page.getByRole('tab', { name: '손익계산서' }).click();
  // 역분개한 매출은 빠지고 복리후생비만 남는다
  await expect(page.getByRole('row', { name: /Ⅰ\. 매출액/ })).toContainText('0');
  await expect(page.getByRole('row', { name: /Ⅹ\. 당기순이익/ })).toContainText('-50,000');
  await snap(page, 'p1-13-journal-to-statements');
});
