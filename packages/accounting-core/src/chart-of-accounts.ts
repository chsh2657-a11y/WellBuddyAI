/**
 * 표준 계정과목(일반기업회계기준, 국내 회계 프로그램에서 널리 쓰는 3자리 코드 체계).
 * 회사를 만들면 이 목록이 복사되고, 회사는 이름 변경·추가·사용중지를 할 수 있다.
 */
export type AccountCategory = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type NormalBalance = 'debit' | 'credit';
export type Statement = 'BS' | 'IS';

export interface StatementGroupDef {
  label: string;
  statement: Statement;
  category: AccountCategory;
  /** 재무상태표의 유동/비유동 구분 */
  term?: 'current' | 'noncurrent';
  order: number;
}

export const STATEMENT_GROUPS = {
  quick_assets: {
    label: '당좌자산',
    statement: 'BS',
    category: 'asset',
    term: 'current',
    order: 10,
  },
  inventories: {
    label: '재고자산',
    statement: 'BS',
    category: 'asset',
    term: 'current',
    order: 20,
  },
  investments: {
    label: '투자자산',
    statement: 'BS',
    category: 'asset',
    term: 'noncurrent',
    order: 30,
  },
  tangible_assets: {
    label: '유형자산',
    statement: 'BS',
    category: 'asset',
    term: 'noncurrent',
    order: 40,
  },
  intangible_assets: {
    label: '무형자산',
    statement: 'BS',
    category: 'asset',
    term: 'noncurrent',
    order: 50,
  },
  other_noncurrent_assets: {
    label: '기타비유동자산',
    statement: 'BS',
    category: 'asset',
    term: 'noncurrent',
    order: 60,
  },
  current_liabilities: {
    label: '유동부채',
    statement: 'BS',
    category: 'liability',
    term: 'current',
    order: 70,
  },
  noncurrent_liabilities: {
    label: '비유동부채',
    statement: 'BS',
    category: 'liability',
    term: 'noncurrent',
    order: 80,
  },
  capital: { label: '자본금', statement: 'BS', category: 'equity', order: 90 },
  capital_surplus: { label: '자본잉여금', statement: 'BS', category: 'equity', order: 100 },
  capital_adjustment: { label: '자본조정', statement: 'BS', category: 'equity', order: 110 },
  accumulated_oci: { label: '기타포괄손익누계액', statement: 'BS', category: 'equity', order: 120 },
  retained_earnings: { label: '이익잉여금', statement: 'BS', category: 'equity', order: 130 },
  revenue: { label: '매출액', statement: 'IS', category: 'revenue', order: 200 },
  cost_of_sales: { label: '매출원가', statement: 'IS', category: 'expense', order: 210 },
  manufacturing_cost: { label: '제조원가', statement: 'IS', category: 'expense', order: 215 },
  sga: { label: '판매비와관리비', statement: 'IS', category: 'expense', order: 220 },
  non_operating_income: { label: '영업외수익', statement: 'IS', category: 'revenue', order: 230 },
  non_operating_expense: { label: '영업외비용', statement: 'IS', category: 'expense', order: 240 },
  income_tax: { label: '법인세비용', statement: 'IS', category: 'expense', order: 250 },
} as const satisfies Record<string, StatementGroupDef>;

export type StatementGroup = keyof typeof STATEMENT_GROUPS;
export const STATEMENT_GROUP_KEYS = Object.keys(STATEMENT_GROUPS) as StatementGroup[];

export function categoryOf(group: StatementGroup): AccountCategory {
  return STATEMENT_GROUPS[group].category;
}

/** 자산·비용은 차변, 부채·자본·수익은 대변이 늘어나는 쪽(정상 잔액) */
export function defaultNormalBalance(group: StatementGroup): NormalBalance {
  const category = categoryOf(group);
  return category === 'asset' || category === 'expense' ? 'debit' : 'credit';
}

export interface StandardAccount {
  code: string;
  name: string;
  group: StatementGroup;
  /** 차감 계정(대손충당금·감가상각누계액·매출할인 등)은 정상 잔액이 반대다 */
  normalBalance?: NormalBalance;
  /** 채권·채무 계정은 거래처를 반드시 입력한다 */
  requiresPartner?: boolean;
}

const A = (
  code: string,
  name: string,
  group: StatementGroup,
  extra: Partial<Pick<StandardAccount, 'normalBalance' | 'requiresPartner'>> = {},
): StandardAccount => ({ code, name, group, ...extra });

const contra = { normalBalance: 'credit' as const };
const contraRevenue = { normalBalance: 'debit' as const };
const partner = { requiresPartner: true };

export const STANDARD_ACCOUNTS: readonly StandardAccount[] = [
  // 당좌자산
  A('101', '현금', 'quick_assets'),
  A('102', '당좌예금', 'quick_assets'),
  A('103', '보통예금', 'quick_assets'),
  A('104', '기타제예금', 'quick_assets'),
  A('105', '정기예금', 'quick_assets'),
  A('106', '정기적금', 'quick_assets'),
  A('107', '단기매매증권', 'quick_assets'),
  A('108', '외상매출금', 'quick_assets', partner),
  A('109', '대손충당금(외상매출금)', 'quick_assets', contra),
  A('110', '받을어음', 'quick_assets', partner),
  A('111', '대손충당금(받을어음)', 'quick_assets', contra),
  A('114', '단기대여금', 'quick_assets', partner),
  A('116', '미수수익', 'quick_assets'),
  A('120', '미수금', 'quick_assets', partner),
  A('131', '선급금', 'quick_assets', partner),
  A('133', '선급비용', 'quick_assets'),
  A('134', '가지급금', 'quick_assets'),
  A('135', '부가세대급금', 'quick_assets'),
  A('136', '선납세금', 'quick_assets'),
  // 재고자산
  A('146', '상품', 'inventories'),
  A('150', '제품', 'inventories'),
  A('153', '원재료', 'inventories'),
  A('162', '부재료', 'inventories'),
  A('169', '재공품', 'inventories'),
  // 투자자산
  A('176', '장기성예금', 'investments'),
  A('178', '장기투자증권', 'investments'),
  A('179', '장기대여금', 'investments', partner),
  // 유형자산
  A('201', '토지', 'tangible_assets'),
  A('202', '건물', 'tangible_assets'),
  A('203', '감가상각누계액(건물)', 'tangible_assets', contra),
  A('206', '기계장치', 'tangible_assets'),
  A('207', '감가상각누계액(기계장치)', 'tangible_assets', contra),
  A('208', '차량운반구', 'tangible_assets'),
  A('209', '감가상각누계액(차량운반구)', 'tangible_assets', contra),
  A('212', '비품', 'tangible_assets'),
  A('213', '감가상각누계액(비품)', 'tangible_assets', contra),
  A('214', '건설중인자산', 'tangible_assets'),
  // 무형자산
  A('218', '영업권', 'intangible_assets'),
  A('219', '특허권', 'intangible_assets'),
  A('226', '개발비', 'intangible_assets'),
  A('227', '소프트웨어', 'intangible_assets'),
  // 기타비유동자산
  A('232', '임차보증금', 'other_noncurrent_assets', partner),
  A('246', '부도어음과수표', 'other_noncurrent_assets', partner),
  // 유동부채
  A('251', '외상매입금', 'current_liabilities', partner),
  A('252', '지급어음', 'current_liabilities', partner),
  A('253', '미지급금', 'current_liabilities', partner),
  A('254', '예수금', 'current_liabilities'),
  A('255', '부가세예수금', 'current_liabilities'),
  A('256', '당좌차월', 'current_liabilities'),
  A('257', '가수금', 'current_liabilities'),
  A('259', '선수금', 'current_liabilities', partner),
  A('260', '단기차입금', 'current_liabilities', partner),
  A('261', '미지급세금', 'current_liabilities'),
  A('262', '미지급비용', 'current_liabilities'),
  A('263', '선수수익', 'current_liabilities'),
  A('264', '유동성장기부채', 'current_liabilities'),
  // 비유동부채
  A('291', '사채', 'noncurrent_liabilities'),
  A('293', '장기차입금', 'noncurrent_liabilities', partner),
  A('294', '임대보증금', 'noncurrent_liabilities', partner),
  A('295', '퇴직급여충당부채', 'noncurrent_liabilities'),
  // 자본
  A('331', '자본금', 'capital'),
  A('341', '주식발행초과금', 'capital_surplus'),
  A('381', '자기주식', 'capital_adjustment', { normalBalance: 'debit' }),
  A('351', '이익준비금', 'retained_earnings'),
  A('375', '이월이익잉여금', 'retained_earnings'),
  // 매출
  A('401', '상품매출', 'revenue'),
  A('402', '매출환입및에누리', 'revenue', contraRevenue),
  A('403', '매출할인', 'revenue', contraRevenue),
  A('404', '제품매출', 'revenue'),
  A('411', '용역매출', 'revenue'),
  // 매출원가
  A('451', '상품매출원가', 'cost_of_sales'),
  A('455', '제품매출원가', 'cost_of_sales'),
  // 제조원가(500번대) — 생산 모듈(P4)에서 확장
  A('501', '원재료비', 'manufacturing_cost'),
  A('503', '급여(제조)', 'manufacturing_cost'),
  A('511', '복리후생비(제조)', 'manufacturing_cost'),
  A('533', '외주가공비', 'manufacturing_cost'),
  // 판매비와관리비
  A('801', '급여', 'sga'),
  A('802', '상여금', 'sga'),
  A('803', '제수당', 'sga'),
  A('804', '잡급', 'sga'),
  A('806', '퇴직급여', 'sga'),
  A('811', '복리후생비', 'sga'),
  A('812', '여비교통비', 'sga'),
  A('813', '기업업무추진비', 'sga'),
  A('814', '통신비', 'sga'),
  A('815', '수도광열비', 'sga'),
  A('816', '전력비', 'sga'),
  A('817', '세금과공과', 'sga'),
  A('818', '감가상각비', 'sga'),
  A('819', '지급임차료', 'sga'),
  A('820', '수선비', 'sga'),
  A('821', '보험료', 'sga'),
  A('822', '차량유지비', 'sga'),
  A('823', '경상연구개발비', 'sga'),
  A('824', '운반비', 'sga'),
  A('825', '교육훈련비', 'sga'),
  A('826', '도서인쇄비', 'sga'),
  A('827', '회의비', 'sga'),
  A('828', '포장비', 'sga'),
  A('829', '사무용품비', 'sga'),
  A('830', '소모품비', 'sga'),
  A('831', '지급수수료', 'sga'),
  A('832', '보관료', 'sga'),
  A('833', '광고선전비', 'sga'),
  A('834', '판매촉진비', 'sga'),
  A('835', '대손상각비', 'sga'),
  A('837', '건물관리비', 'sga'),
  A('840', '무형자산상각비', 'sga'),
  A('848', '잡비', 'sga'),
  // 영업외수익
  A('901', '이자수익', 'non_operating_income'),
  A('903', '배당금수익', 'non_operating_income'),
  A('904', '임대료', 'non_operating_income'),
  A('907', '외환차익', 'non_operating_income'),
  A('910', '외화환산이익', 'non_operating_income'),
  A('914', '유형자산처분이익', 'non_operating_income'),
  A('930', '잡이익', 'non_operating_income'),
  // 영업외비용
  A('951', '이자비용', 'non_operating_expense'),
  A('952', '외환차손', 'non_operating_expense'),
  A('953', '기부금', 'non_operating_expense'),
  A('955', '외화환산손실', 'non_operating_expense'),
  A('956', '매출채권처분손실', 'non_operating_expense'),
  A('970', '유형자산처분손실', 'non_operating_expense'),
  A('980', '잡손실', 'non_operating_expense'),
  // 법인세
  A('998', '법인세등', 'income_tax'),
];

/** 자동 분개·결산이 기준으로 삼는 계정 코드 */
export const SYSTEM_ACCOUNTS = {
  cash: '101',
  bankDeposit: '103',
  accountsReceivable: '108',
  vatPaid: '135',
  accountsPayable: '251',
  otherPayable: '253',
  vatReceived: '255',
  retainedEarnings: '375',
  merchandiseSales: '401',
} as const;

export function accountNormalBalance(account: Pick<StandardAccount, 'group' | 'normalBalance'>) {
  return account.normalBalance ?? defaultNormalBalance(account.group);
}
