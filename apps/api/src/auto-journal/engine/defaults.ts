import type { AutoJournalKind } from '@wellbuddy/shared';
import { type EvidenceItem, normalizeName, searchText } from './items.js';

export interface DefaultSuggestion {
  accountCode: string;
  deductible: boolean | null;
  confidence: number;
  reason: string;
}

interface KeywordRule {
  kinds: AutoJournalKind[];
  keywords: string[];
  code: string;
  confidence: number;
  reason: string;
  deductible?: boolean;
}

const SPEND: AutoJournalKind[] = ['card', 'card_cancel', 'cash_purchase'];
const SALES: AutoJournalKind[] = ['tax_sales', 'cash_sales'];

/**
 * 규칙·이력이 없을 때의 기본 추천. 표준 계정과목 코드와 흔한 적요·업종 키워드로 고른다.
 * 신뢰도를 낮게 두어 기본값으로는 자동 전기되지 않고 검토함으로 간다.
 */
const KEYWORD_RULES: KeywordRule[] = [
  { kinds: ['bank_in'], keywords: ['이자'], code: '901', confidence: 0.8, reason: '예금 이자' },
  {
    kinds: ['bank_out'],
    keywords: ['카드대금', '카드결제', '카드'],
    code: '253',
    confidence: 0.75,
    reason: '카드대금 결제(미지급금 상환)',
  },
  {
    kinds: ['bank_out'],
    keywords: ['급여', '월급', '상여'],
    code: '801',
    confidence: 0.7,
    reason: '급여 지급',
  },
  {
    kinds: ['bank_out'],
    keywords: ['임대료', '월세', '임차료'],
    code: '819',
    confidence: 0.7,
    reason: '사무실 임차료',
  },
  {
    kinds: ['bank_out'],
    keywords: ['국민연금', '건강보험', '고용보험', '산재보험', '4대보험', '근로복지공단'],
    code: '811',
    confidence: 0.6,
    reason: '4대보험 회사 부담분(직원 부담분은 예수금으로 나눠 주세요)',
  },
  {
    kinds: ['bank_out'],
    keywords: ['전기요금', '한국전력'],
    code: '816',
    confidence: 0.7,
    reason: '전기요금',
  },
  {
    kinds: ['bank_out'],
    keywords: ['수도요금', '도시가스', '가스요금'],
    code: '815',
    confidence: 0.65,
    reason: '수도·가스 요금',
  },
  {
    kinds: ['bank_out', ...SPEND],
    keywords: ['통신', '인터넷', '휴대폰'],
    code: '814',
    confidence: 0.6,
    reason: '통신비',
  },
  {
    kinds: ['bank_out'],
    keywords: ['수수료'],
    code: '831',
    confidence: 0.6,
    reason: '은행·이체 수수료',
  },
  {
    kinds: ['bank_out'],
    keywords: ['이자'],
    code: '951',
    confidence: 0.6,
    reason: '대출 이자',
  },
  {
    kinds: SPEND,
    keywords: ['주유', '에너지', '오일뱅크', '주차'],
    code: '822',
    confidence: 0.6,
    reason: '주유·주차(차량유지비)',
  },
  {
    kinds: SPEND,
    keywords: ['택시', '철도', '코레일', 'ktx', 'srt', '고속버스', '항공'],
    code: '812',
    confidence: 0.65,
    deductible: false,
    reason: '교통비(여객운송은 매입세액 불공제)',
  },
  {
    kinds: SPEND,
    keywords: ['서적', '문고', '도서', '서점'],
    code: '826',
    confidence: 0.7,
    reason: '도서 구입',
  },
  {
    kinds: SPEND,
    keywords: ['문구', '사무용품', '오피스'],
    code: '829',
    confidence: 0.65,
    reason: '사무용품',
  },
  {
    kinds: SPEND,
    keywords: ['퀵', '택배', '운송', '물류'],
    code: '824',
    confidence: 0.6,
    reason: '운반비',
  },
  {
    kinds: SPEND,
    keywords: ['커피', '카페', '편의점', '도시락', '음식점', '식당', '김밥', '식대'],
    code: '811',
    confidence: 0.55,
    reason: '식대·다과(복리후생비)',
  },
  {
    kinds: SPEND,
    keywords: ['쇼핑', '마트', '다이소', '생활용품', '쿠팡'],
    code: '830',
    confidence: 0.5,
    reason: '소모품 구입',
  },
  {
    kinds: ['tax_purchase'],
    keywords: ['임대료', '임차료', '관리비'],
    code: '819',
    confidence: 0.75,
    reason: '임차료 세금계산서',
  },
  {
    kinds: ['tax_purchase'],
    keywords: ['원자재', '원재료', '부품', '자재'],
    code: '153',
    confidence: 0.65,
    reason: '원재료 매입',
  },
  {
    kinds: ['tax_purchase'],
    keywords: ['운송', '운반', '물류'],
    code: '824',
    confidence: 0.65,
    reason: '운반비',
  },
  {
    kinds: ['tax_purchase'],
    keywords: ['사무용품', '문구'],
    code: '829',
    confidence: 0.65,
    reason: '사무용품',
  },
  {
    kinds: ['tax_purchase'],
    keywords: ['소프트웨어', '유지보수', '수수료', '컨설팅', '용역'],
    code: '831',
    confidence: 0.6,
    reason: '용역·수수료',
  },
  {
    kinds: ['tax_purchase'],
    keywords: ['광고'],
    code: '833',
    confidence: 0.65,
    reason: '광고선전비',
  },
  { kinds: SALES, keywords: ['제품'], code: '404', confidence: 0.75, reason: '제품 매출' },
  { kinds: SALES, keywords: ['상품'], code: '401', confidence: 0.75, reason: '상품 매출' },
];

/** 음식점에서 10만원 이상이면 거래처 접대로 본다(기업업무추진비, 매입세액 불공제) */
const ENTERTAINMENT_MIN = 100_000;
const RESTAURANT = ['음식점', '식당', '한우', '고깃집', '일식', '주점'];

export function defaultSuggestion(item: EvidenceItem): DefaultSuggestion | null {
  const text = searchText(item);
  if (
    SPEND.includes(item.kind) &&
    item.amount >= ENTERTAINMENT_MIN &&
    RESTAURANT.some((k) => text.includes(normalizeName(k)))
  ) {
    return {
      accountCode: '813',
      deductible: false,
      confidence: 0.5,
      reason: '음식점 10만원 이상(기업업무추진비, 매입세액 불공제)',
    };
  }
  const hit = KEYWORD_RULES.find(
    (r) => r.kinds.includes(item.kind) && r.keywords.some((k) => text.includes(normalizeName(k))),
  );
  if (hit) {
    return {
      accountCode: hit.code,
      deductible: hit.deductible ?? null,
      confidence: hit.confidence,
      reason: hit.reason,
    };
  }
  switch (item.kind) {
    case 'bank_in':
      return item.partnerId
        ? {
            accountCode: '108',
            deductible: null,
            confidence: 0.6,
            reason: '거래처 입금(외상매출금 회수)',
          }
        : null;
    case 'bank_out':
      return item.partnerId
        ? {
            accountCode: '251',
            deductible: null,
            confidence: 0.6,
            reason: '거래처 송금(외상매입금 지급)',
          }
        : null;
    case 'card':
    case 'card_cancel':
    case 'cash_purchase':
      return {
        accountCode: '830',
        deductible: null,
        confidence: 0.4,
        reason: '업종을 알 수 없어 소모품비',
      };
    case 'tax_purchase':
      return {
        accountCode: '146',
        deductible: null,
        confidence: 0.4,
        reason: '품목을 알 수 없어 상품 매입',
      };
    case 'tax_sales':
    case 'cash_sales':
      return { accountCode: '401', deductible: null, confidence: 0.6, reason: '상품 매출' };
  }
}
