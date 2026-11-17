import { expect, type Page, test } from '@playwright/test';
import { signupWithCompany, snap } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n'));
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const daysAgo = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

async function uploadFile(page: Page, options: object, name: string, buffer: Buffer) {
  const res = await page.request.post('/api/evidence/uploads/commit', {
    multipart: {
      options: JSON.stringify(options),
      file: { name, mimeType: 'text/csv', buffer },
    },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test('자동분개: 실행 → 검토함에서 계정 고치고 승인 → 규칙 추가 → 자동 전기', async ({ page }) => {
  const tab = (name: string) =>
    page.getByRole('navigation', { name: '증빙 메뉴' }).getByRole('link', { name, exact: true });
  const combo = (name: string) => page.getByRole('combobox', { name, exact: true });
  await signupWithCompany(page, 'p2-auto', '자동분개상사');

  // ── 준비(API): 계좌·카드·거래처, 통장·카드 파일 ──
  const api = page.request;
  const accounts = (await (await api.get('/api/accounts')).json()) as {
    id: string;
    code: string;
  }[];
  const acc = Object.fromEntries(accounts.map((a) => [a.code, a.id])) as Record<string, string>;
  const bank = await api.post('/api/bank-accounts', {
    data: {
      bankCode: '0004',
      alias: '운영자금',
      accountNo: '12345678901234',
      ledgerAccountId: acc['103'],
    },
  });
  expect(bank.status()).toBe(201);
  const card = await api.post('/api/corporate-cards', {
    data: {
      cardCompany: '0306',
      alias: '법인카드',
      cardNo: '4518123456789012',
      ledgerAccountId: acc['253'],
    },
  });
  expect(card.status()).toBe(201);
  expect((await api.post('/api/partners', { data: { name: '(주)한빛상사' } })).status()).toBe(201);
  await uploadFile(
    page,
    { kind: 'bank', sourceId: (await bank.json()).id },
    'bank.csv',
    csv([
      ['거래일시', '적요', '보낸분/받는분', '출금액(원)', '입금액(원)', '잔액(원)'],
      [`${daysAgo(9)} 09:00:00`, '타행입금', '(주)한빛상사', '0', '"1,100,000"', '"11,100,000"'],
      [`${daysAgo(8)} 10:00:00`, '임대료', '(주)강남빌딩', '"2,200,000"', '0', '"8,900,000"'],
      [`${daysAgo(7)} 11:00:00`, '타행이체', '처음보는상점', '"50,000"', '0', '"8,850,000"'],
      [`${daysAgo(6)} 12:00:00`, '급여', '급여 일괄이체', '"3,000,000"', '0', '"5,850,000"'],
    ]),
  );
  await uploadFile(
    page,
    { kind: 'card', sourceId: (await card.json()).id },
    'card.csv',
    csv([
      ['승인일자', '승인시간', '가맹점명', '업종', '승인금액', '승인번호', '승인구분'],
      [daysAgo(5), '12:30', '스타벅스 역삼점', '커피전문점', '"11,000"', '30010001', '승인'],
    ]),
  );

  // ── 자동분개 실행 → 검토함 ──
  await page.getByRole('link', { name: '증빙·자동분개' }).click();
  await expect(page).toHaveURL(/\/evidence\/review/);
  await expect(page.getByText('검토할 거래가 없습니다.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '자동분개 실행' }).click();
  await expect(page.getByText('자동분개: 매칭 0건, 자동 전기 0건, 검토 5건')).toBeVisible();

  const inbox = page.getByRole('table', { name: '자동분개 검토함' });
  const rent = inbox.getByRole('row', { name: '(주)강남빌딩 임대료' });
  await expect(combo('(주)강남빌딩 임대료 계정')).toHaveValue('819 지급임차료');
  await expect(rent).toContainText('기본 추천');
  await expect(page.getByLabel('(주)강남빌딩 임대료 전표 미리보기')).toContainText(
    '차) 819 지급임차료 2,200,000',
  );
  const deposit = inbox.getByRole('row', { name: '(주)한빛상사 타행입금' });
  await expect(combo('(주)한빛상사 타행입금 계정')).toHaveValue('108 외상매출금');
  await expect(combo('(주)한빛상사 타행입금 거래처')).toHaveValue(/\(주\)한빛상사/);

  // 추천이 없는 거래는 계정을 골라야 승인할 수 있다
  const unknown = inbox.getByRole('row', { name: '처음보는상점 타행이체' });
  await expect(unknown).toContainText('추천 없음');
  await expect(unknown.getByRole('button', { name: '승인' })).toBeDisabled();
  await combo('처음보는상점 타행이체 계정').fill('831');
  await combo('처음보는상점 타행이체 계정').press('Enter');
  await expect(unknown).toContainText('직접 지정');
  await expect(unknown).toContainText('100%');
  await expect(combo('처음보는상점 타행이체 계정')).toHaveValue('831 지급수수료');
  await snap(page, 'p2-24-review');

  // 골라서 승인 → 전표
  await rent.getByRole('checkbox').check();
  await unknown.getByRole('checkbox').check();
  await page.getByRole('button', { name: '선택 승인 (2)' }).click();
  await expect(page.getByText('2건을 전표로 만들었습니다.')).toBeVisible();
  await expect(inbox.getByRole('row', { name: '(주)강남빌딩 임대료' })).toHaveCount(0);

  await tab('수집 내역').click();
  await expect(page).toHaveURL(/\/evidence\/records/);
  const bankTable = page.getByRole('table', { name: '통장 거래' });
  await expect(bankTable.getByRole('row', { name: /임대료/ })).toContainText('전표 연결');
  await expect(bankTable.getByRole('row', { name: /급여/ })).toContainText('검토 필요');

  // ── 규칙: 스타벅스는 복리후생비 ──
  await tab('분개 규칙').click();
  await expect(page).toHaveURL(/\/evidence\/rules/);
  await page.getByLabel('규칙 이름').fill('커피는 복리후생비');
  await page.getByLabel('키워드').fill('스타벅스, 이디야');
  await combo('분개 계정').fill('811');
  await combo('분개 계정').press('Enter');
  await page.getByLabel('카드 승인').check();
  await page.getByLabel('전표 적요(선택)').fill('직원 커피');
  await page.getByRole('button', { name: '규칙 추가' }).click();
  await expect(page.getByText("'커피는 복리후생비' 규칙을 추가했습니다.")).toBeVisible();
  const ruleRow = page
    .getByRole('table', { name: '분개 규칙' })
    .getByRole('row', { name: /커피는 복리후생비/ });
  await expect(ruleRow).toContainText('811 복리후생비');
  await expect(ruleRow).toContainText("'스타벅스, 이디야'");

  // ── 자동 전기 켜고 다시 실행: 규칙에 맞는 카드는 바로 전표 ──
  await tab('자동분개 검토함').click();
  await expect(page).toHaveURL(/\/evidence\/review/);
  await page.getByRole('switch', { name: '신뢰도 높은 거래는 자동 전기' }).click();
  await expect(page.getByText('자동 전기 설정을 저장했습니다.')).toBeVisible();
  await expect(page.getByLabel('자동 전기 신뢰도 기준')).toHaveValue('0.9');
  await page.getByRole('button', { name: '자동분개 실행' }).click();
  await expect(page.getByText('자동분개: 매칭 0건, 자동 전기 1건, 검토 2건')).toBeVisible();
  await expect(inbox.getByRole('row', { name: '스타벅스 역삼점' })).toHaveCount(0);

  // 한 건씩 승인·제외
  await deposit.getByRole('button', { name: '승인' }).click();
  await expect(page.getByText('1건을 전표로 만들었습니다.')).toBeVisible();
  await inbox
    .getByRole('row', { name: '급여 일괄이체 급여' })
    .getByRole('button', { name: '제외' })
    .click();
  await expect(page.getByText('제외했습니다.')).toBeVisible();
  await expect(page.getByText('검토할 거래가 없습니다.', { exact: false })).toBeVisible();

  await tab('분개 규칙').click();
  await expect(ruleRow).toContainText('1회');
  await tab('수집 내역').click();
  await page.getByRole('button', { name: '카드', exact: true }).click();
  await expect(
    page.getByRole('table', { name: '카드 승인' }).getByRole('row', { name: /스타벅스/ }),
  ).toContainText('전표 연결');

  // ── 같은 거래를 3번 승인하면 규칙을 제안한다 ──
  await uploadFile(
    page,
    { kind: 'card', sourceId: (await card.json()).id },
    'card2.csv',
    csv([
      ['승인일자', '승인시간', '가맹점명', '업종', '승인금액', '승인번호', '승인구분'],
      [daysAgo(4), '08:10', 'GS25 역삼점', '편의점', '"3,300"', '30020001', '승인'],
      [daysAgo(3), '08:10', 'GS25 역삼점', '편의점', '"2,200"', '30020002', '승인'],
      [daysAgo(2), '08:10', 'GS25 역삼점', '편의점', '"4,400"', '30020003', '승인'],
    ]),
  );
  await tab('자동분개 검토함').click();
  await page.getByRole('button', { name: '자동분개 실행' }).click();
  await expect(page.getByText('자동분개: 매칭 0건, 자동 전기 0건, 검토 3건')).toBeVisible();
  await page.getByRole('checkbox', { name: '모두 선택' }).check();
  await page.getByRole('button', { name: '선택 승인 (3)' }).click();
  await expect(page.getByText('3건을 전표로 만들었습니다.')).toBeVisible();

  await tab('분개 규칙').click();
  const suggestion = page
    .getByRole('list', { name: '추천 규칙' })
    .getByRole('listitem', { name: 'GS25 역삼점 → 복리후생비' });
  await expect(suggestion).toContainText("'GS25 역삼점' → 811 복리후생비");
  await expect(suggestion).toContainText('카드 승인 · 3번 중 3번 이 계정으로 승인');
  await snap(page, 'p2-25-rule-suggestion');
  await suggestion.getByRole('button', { name: '규칙으로 만들기' }).click();
  await expect(page.getByText("'GS25 역삼점 → 복리후생비' 규칙을 만들었습니다.")).toBeVisible();
  await expect(page.getByRole('list', { name: '추천 규칙' })).toHaveCount(0);
  await expect(
    page.getByRole('table', { name: '분개 규칙' }).getByRole('row', { name: /GS25 역삼점/ }),
  ).toContainText('811 복리후생비');
});
