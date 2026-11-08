import type { AutoJournalKind, UploadKind } from '@wellbuddy/shared';

/** 자동분개 엔진이 보는 증빙 한 건(통장·카드·세금계산서·현금영수증을 같은 모양으로) */
export interface EvidenceItem {
  evidenceKind: UploadKind;
  evidenceId: string;
  kind: AutoJournalKind;
  date: string;
  /** 통장 적요, 카드 가맹점, 세금계산서 품목, 현금영수증 상호 */
  description: string;
  /** 보낸분·받는분, 가맹점, 상대 상호 */
  counterparty: string | null;
  /** 상대 사업자번호(숫자 10자리) */
  bizNo: string | null;
  /** 증빙에서 찾은 거래처 */
  partnerId: string | null;
  /** 합계(양수) */
  amount: number;
  /** 공급가액·부가세(알 때만) */
  supply: number | null;
  vat: number | null;
  vatType: 'taxable' | 'zero_rated' | 'exempt';
  /** 통장·카드의 장부 계정 ID(보통예금, 미지급금) */
  ledgerAccountId: string | null;
  /** 카드 가맹점 업종 */
  category: string | null;
  /** 카드사 이름(카드대금 미지급금 거래처) */
  issuerName: string | null;
  /** 되돌리는 거래(카드 취소, 마이너스 세금계산서, 현금영수증 취소): 분개의 차대를 바꾼다 */
  reversal: boolean;
}

/** 회사 형태 표시·공백·기호를 빼고 소문자로: "(주)한빛 상사" → "한빛상사" */
export function normalizeName(value: string): string {
  return value
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(사\)|\(재\)/g, '')
    .replace(/[\s()[\]{}.,·\-_/&]/g, '')
    .toLowerCase();
}

/** 키워드를 찾을 글(적요·거래처·업종) */
export function searchText(item: EvidenceItem): string {
  return normalizeName([item.description, item.counterparty ?? '', item.category ?? ''].join(' '));
}

/** 전표 적요: "카드 스타벅스 역삼점", "출금 (주)강남빌딩 임대료" */
export function entryDescription(item: EvidenceItem, label: string): string {
  const who = item.counterparty?.trim();
  const what = item.description.trim();
  const body = who && what && who !== what ? `${who} ${what}` : who || what;
  return `${label} ${body}`.trim().slice(0, 200);
}
