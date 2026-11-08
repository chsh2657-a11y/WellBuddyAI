import { bizNoCheckDigit } from '@wellbuddy/accounting-core';

/**
 * 모의 거래에 쓰는 가상의 거래처·가맹점. 사업자번호는 국세청 검증 공식을 통과하도록 끝자리를 계산한다.
 */
/** 앞 9자리로 검증번호를 붙인 10자리 사업자번호 */
export function bizNo(first9: string): string {
  return `${first9}${bizNoCheckDigit(first9)}`;
}

export interface MockParty {
  name: string;
  bizNo: string;
  /** 세금계산서 품목 */
  item: string;
}

/** 매출처(입금·매출 세금계산서) */
export const CUSTOMERS: MockParty[] = [
  { name: '(주)한빛상사', bizNo: bizNo('220811234'), item: '제품' },
  { name: '대한무역(주)', bizNo: bizNo('105815678'), item: '제품' },
  { name: '미래테크(주)', bizNo: bizNo('214862345'), item: '용역' },
  { name: '서울유통', bizNo: bizNo('201234567'), item: '상품' },
  { name: '(주)그린푸드', bizNo: bizNo('130868765'), item: '상품' },
];

/** 매입처(송금·매입 세금계산서) */
export const SUPPLIERS: MockParty[] = [
  { name: '동양자재(주)', bizNo: bizNo('312813456'), item: '원자재' },
  { name: '(주)성진산업', bizNo: bizNo('610817890'), item: '부품' },
  { name: '한결물류', bizNo: bizNo('119123456'), item: '운송비' },
  { name: '(주)오피스플러스', bizNo: bizNo('211875432'), item: '사무용품' },
  { name: '스마트IT솔루션', bizNo: bizNo('107452345'), item: '소프트웨어 유지보수' },
];

export const LANDLORD: MockParty = {
  name: '(주)강남빌딩',
  bizNo: bizNo('120811111'),
  item: '사무실 임대료',
};

/** 계산서(면세) 매입처 */
export const EXEMPT_SUPPLIER: MockParty = {
  name: '(주)대한농산',
  bizNo: bizNo('134812222'),
  item: '농산물',
};

export interface MockMerchant {
  name: string;
  bizNo: string;
  category: string;
  min: number;
  max: number;
  unit: number;
  /** 면세(도서 등) */
  exempt?: boolean;
}

/** 법인카드 가맹점 */
export const MERCHANTS: MockMerchant[] = [
  {
    name: '스타벅스 역삼점',
    bizNo: bizNo('201819876'),
    category: '커피전문점',
    min: 4_500,
    max: 45_000,
    unit: 100,
  },
  {
    name: '김밥천국 역삼점',
    bizNo: bizNo('220123321'),
    category: '일반음식점',
    min: 8_000,
    max: 60_000,
    unit: 500,
  },
  {
    name: 'GS25 역삼점',
    bizNo: bizNo('220851010'),
    category: '편의점',
    min: 2_000,
    max: 25_000,
    unit: 100,
  },
  {
    name: 'SK에너지 강남주유소',
    bizNo: bizNo('211860101'),
    category: '주유소',
    min: 40_000,
    max: 120_000,
    unit: 1_000,
  },
  {
    name: '쿠팡(주)',
    bizNo: bizNo('120883344'),
    category: '온라인쇼핑',
    min: 12_000,
    max: 350_000,
    unit: 100,
  },
  {
    name: '교보문고 강남점',
    bizNo: bizNo('102815656'),
    category: '서적',
    min: 12_000,
    max: 80_000,
    unit: 100,
    exempt: true,
  },
  {
    name: '한국철도공사',
    bizNo: bizNo('314820123'),
    category: '철도',
    min: 25_000,
    max: 120_000,
    unit: 100,
  },
  {
    name: '카카오T 택시',
    bizNo: bizNo('120870909'),
    category: '택시',
    min: 4_800,
    max: 45_000,
    unit: 100,
  },
  {
    name: '한우명가 강남본점',
    bizNo: bizNo('220337777'),
    category: '일반음식점',
    min: 150_000,
    max: 700_000,
    unit: 1_000,
  },
  {
    name: '다이소 강남역점',
    bizNo: bizNo('220864545'),
    category: '생활용품',
    min: 3_000,
    max: 50_000,
    unit: 1_000,
  },
];

/** 현금영수증(지출증빙) 가맹점 */
export const CASH_MERCHANTS: MockParty[] = [
  { name: '문구나라', bizNo: bizNo('220456789'), item: '문구' },
  { name: '한솥도시락 역삼점', bizNo: bizNo('220781212'), item: '식대' },
  { name: '퀵서비스24', bizNo: bizNo('215345678'), item: '퀵서비스' },
];
