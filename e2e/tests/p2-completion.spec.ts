import { expect, type Page, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** 설정 > 연동관리에서 채널을 모의 데이터로 켜거나 끈다 */
async function setMock(page: Page, key: string, label: string, on: boolean) {
  await page.goto('/settings/integrations');
  const card = page.getByTestId(`integration-${key}`);
  await card.getByLabel('연동 방식').selectOption('mock');
  const toggle = card.getByRole('switch', { name: `${label} 사용` });
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  await card.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(`${label} 연동 설정을 저장했습니다.`)).toBeVisible();
  await expect(card.getByText(on ? '사용 중' : '꺼짐', { exact: true })).toBeVisible();
}

/**
 * P2-29 단계 완료 기준: 모의 모드로 수집 → 자동분개(자동 전기) → 검토함 승인 → 전기,
 * 증빙센터·시산표 확인, 연동 스위치 ON/OFF. 파일 업로드 방식은 p2-upload·p2-auto-journal 이 확인한다.
 */
test('P2 완료 기준: 모의 수집 → 자동분개 → 검토 → 전기, 연동 스위치 ON/OFF', async ({ page }) => {
  test.setTimeout(120_000);
  const tab = (name: string) =>
    page.getByRole('navigation', { name: '증빙 메뉴' }).getByRole('link', { name, exact: true });
  await signupWithCompany(page, 'p2-done', '완료기준상사');

  // ── 준비(API): 계좌·카드, 임대료 규칙 ──
  const api = page.request;
  const accounts = (await (await api.get('/api/accounts')).json()) as {
    id: string;
    code: string;
  }[];
  const acc = Object.fromEntries(accounts.map((a) => [a.code, a.id])) as Record<string, string>;
  expect(
    (
      await api.post('/api/bank-accounts', {
        data: {
          bankCode: '0004',
          alias: '운영자금',
          accountNo: '12345678901234',
          ledgerAccountId: acc['103'],
        },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await api.post('/api/corporate-cards', {
        data: {
          cardCompany: '0306',
          alias: '법인카드',
          cardNo: '4518123456789012',
          ledgerAccountId: acc['253'],
        },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await api.post('/api/auto-journal/rules', {
        data: { name: '임대료', kinds: ['bank_out'], keywords: '임대료', accountId: acc['819'] },
      })
    ).status(),
  ).toBe(201);

  // ── 연동 스위치 ON: 세 채널을 모의 데이터로 켜고 수집 ──
  await setMock(page, 'bank', '은행 입출금', true);
  await setMock(page, 'card', '법인카드', true);
  await setMock(page, 'hometax', '홈택스 증빙', true);
  await page.goto('/evidence/collect');
  for (const label of ['통장', '법인카드', '홈택스']) {
    await page.getByRole('button', { name: `${label} 지금 수집` }).click();
    await expect(
      page.getByText(new RegExp(`^${label}: 새로 [1-9]\\d*건, 중복 0건$`)),
    ).toBeVisible();
  }

  // ── 자동분개: 자동 전기를 켜고 실행 ──
  await tab('자동분개 검토함').click();
  await page.getByRole('switch', { name: '신뢰도 높은 거래는 자동 전기' }).click();
  await expect(page.getByText('자동 전기 설정을 저장했습니다.')).toBeVisible();
  await page.getByRole('button', { name: '자동분개 실행' }).click();
  await expect(
    page.getByText(/^자동분개: 매칭 \d+건, 자동 전기 [1-9]\d*건, 검토 [1-9]\d*건$/),
  ).toBeVisible();

  // 추천이 있는 거래는 모두 선택해 승인
  await page.getByRole('checkbox', { name: '모두 선택' }).check();
  await page.getByRole('button', { name: /^선택 승인 \([1-9]\d*\)$/ }).click();
  await expect(page.getByText(/^[1-9]\d*건을 전표로 만들었습니다\.$/)).toBeVisible();

  // 추천이 없어 남은 거래는 계정을 정해 승인(여기서는 API 로 지급수수료를 지정)
  const left = (await (await api.get('/api/auto-journal/review')).json()) as {
    evidenceKind: string;
    evidenceId: string;
    accountId: string | null;
  }[];
  expect(left.every((i) => !i.accountId)).toBe(true);
  if (left.length > 0) {
    for (const item of left) {
      const res = await api.put(
        `/api/auto-journal/review/${item.evidenceKind}/${item.evidenceId}`,
        {
          data: { accountId: acc['831'] },
        },
      );
      expect(res.status()).toBe(204);
    }
    await page.reload();
    await page.getByRole('checkbox', { name: '모두 선택' }).check();
    await page.getByRole('button', { name: `선택 승인 (${left.length})` }).click();
    await expect(page.getByText(`${left.length}건을 전표로 만들었습니다.`)).toBeVisible();
  }
  await expect(page.getByText('검토할 거래가 없습니다.', { exact: false })).toBeVisible();

  // ── 증빙센터: 처리하지 않은 증빙이 없다 ──
  await tab('증빙센터').click();
  const chips = page.getByRole('group', { name: '처리 상태' });
  await expect(chips.getByRole('button', { name: '미처리 0' })).toBeVisible();
  await expect(chips.getByRole('button', { name: '검토 필요 0' })).toBeVisible();
  await expect(chips.getByRole('button', { name: /^전표 연결 [1-9]\d*$/ })).toBeVisible();
  await snap(page, 'p2-29-center');

  // ── 합계잔액시산표: 대차 일치 ──
  await page.goto('/accounting/reports/trial-balance');
  await expect(page.getByText('대차 일치', { exact: true })).toBeVisible();

  // ── 연동 스위치 OFF: 수집 버튼이 사라지고, 다시 켜면 중복만 ──
  await setMock(page, 'bank', '은행 입출금', false);
  await page.goto('/evidence/collect');
  const bankCard = page.getByTestId('collect-bank');
  await expect(bankCard).toContainText('꺼짐');
  await expect(page.getByRole('button', { name: '통장 지금 수집' })).toHaveCount(0);
  await setMock(page, 'bank', '은행 입출금', true);
  await page.goto('/evidence/collect');
  await page.getByRole('button', { name: '통장 지금 수집' }).click();
  await expect(page.getByText(/^통장: 새로 0건, 중복 [1-9]\d*건$/)).toBeVisible();
});
