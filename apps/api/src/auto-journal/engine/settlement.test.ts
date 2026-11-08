import { describe, expect, it } from 'vitest';
import { type MemoryEntry, suggestRules } from './rule-suggestions.js';
import type { RuleLike } from './rules.js';
import { matchSettlement } from './settlement.js';

const inv = (id: string, total: number, date = `2026-09-0${id}`) => ({ id, date, total });

describe('외상 반제 매칭', () => {
  const open = [inv('1', 1_100_000), inv('2', 2_200_000), inv('3', 550_000), inv('4', 3_300_000)];

  it('금액이 같은 한 장을 먼저, 그다음 오래된 순서 합, 그다음 조합', () => {
    expect(matchSettlement(2_200_000, open, '외상매출금')).toEqual({
      ids: ['2'],
      confidence: 0.95,
      reason: '외상매출금 반제: 2026-09-02 세금계산서 2,200,000원',
    });
    // 1 + 2 + 3 = 3,850,000 (오래된 순서 합)
    expect(matchSettlement(3_850_000, open, '외상매출금')).toMatchObject({
      ids: ['1', '2', '3'],
      confidence: 0.93,
    });
    expect(matchSettlement(3_850_000, open, '외상매출금')?.reason).toBe(
      '외상매출금 반제: 세금계산서 3장(2026-09-01~2026-09-03) 합계 3,850,000원',
    );
    // 1 + 4 = 4,400,000 (조합)
    expect(matchSettlement(4_400_000, open, '외상매출금')).toMatchObject({
      ids: ['1', '4'],
      confidence: 0.9,
    });
  });

  it('같은 금액이 여럿이면 가장 오래된 것', () => {
    expect(
      matchSettlement(
        500_000,
        [inv('7', 500_000, '2026-08-01'), inv('8', 500_000, '2026-08-05')],
        'x',
      )?.ids,
    ).toEqual(['7']);
  });

  it('맞는 조합이 없으면 일부 반제(0.7), 잔액보다 많으면 0.6, 미결이 없으면 추천하지 않는다', () => {
    expect(matchSettlement(1_000_000, open, '외상매출금')).toMatchObject({
      ids: [],
      confidence: 0.7,
      reason: '외상매출금 일부 반제(미결 4장 7,150,000원 중 1,000,000원)',
    });
    expect(matchSettlement(9_000_000, open, '외상매입금')).toMatchObject({
      ids: [],
      confidence: 0.6,
    });
    expect(matchSettlement(1_000, [], '외상매출금')).toBeNull();
    expect(matchSettlement(1_000, [inv('9', -1_000)], '외상매출금')).toBeNull();
  });
});

describe('규칙 제안', () => {
  const at = (d: number) => new Date(2026, 0, d);
  const m = (over: Partial<MemoryEntry>): MemoryEntry => ({
    kind: 'card',
    key: 'name:스타벅스역삼점',
    label: '스타벅스 역삼점',
    accountId: 'a811',
    deductible: null,
    useCount: 3,
    lastUsedAt: at(1),
    suggestionDismissed: false,
    ...over,
  });
  const partners = [
    { id: 'p1', name: '(주)강남빌딩', bizRegNo: '1208111111' },
    { id: 'p2', name: '동양자재(주)', bizRegNo: null },
  ];

  it('3번 이상, 80% 이상 같은 계정이면 키워드 규칙을 제안한다', () => {
    expect(suggestRules([m({})], [], partners)).toEqual([
      {
        kind: 'card',
        keys: ['name:스타벅스역삼점'],
        label: '스타벅스 역삼점',
        partnerId: null,
        keywords: '스타벅스 역삼점',
        accountId: 'a811',
        deductible: null,
        useCount: 3,
        total: 3,
      },
    ]);
    expect(suggestRules([m({ useCount: 2 })], [], partners)).toEqual([]);
    // 4번 중 3번(75%)은 제안하지 않는다
    expect(suggestRules([m({}), m({ accountId: 'a830', useCount: 1 })], [], partners)).toEqual([]);
    expect(suggestRules([m({ suggestionDismissed: true })], [], partners)).toEqual([]);
  });

  it('사업자번호·이름·거래처 열쇠는 한 거래처 조건으로 합친다', () => {
    const rows = [
      m({ kind: 'bank_out', key: 'biz:1208111111', label: '(주)강남빌딩', accountId: 'a819' }),
      m({ kind: 'bank_out', key: 'partner:p1', label: '(주)강남빌딩', accountId: 'a819' }),
      m({
        kind: 'bank_out',
        key: 'name:강남빌딩',
        label: '(주)강남빌딩',
        accountId: 'a819',
        useCount: 4,
      }),
    ];
    const [one, ...rest] = suggestRules(rows, [], partners);
    expect(rest).toEqual([]);
    expect(one).toMatchObject({
      partnerId: 'p1',
      keywords: null,
      label: '(주)강남빌딩',
      accountId: 'a819',
      total: 4,
    });
    expect(one!.keys.sort()).toEqual(['biz:1208111111', 'name:강남빌딩', 'partner:p1']);
  });

  it('활성 규칙이 이미 처리하는 거래는 제안하지 않는다(금액 조건은 무시)', () => {
    const rule: RuleLike = {
      id: 'r',
      priority: 100,
      isActive: true,
      kinds: ['card'],
      keywords: '스타벅스',
      partnerId: null,
      minAmount: 100_000,
      maxAmount: null,
      createdAt: at(1),
    };
    expect(suggestRules([m({})], [rule], partners)).toEqual([]);
    expect(suggestRules([m({})], [{ ...rule, isActive: false }], partners)).toHaveLength(1);
    expect(suggestRules([m({})], [{ ...rule, kinds: ['bank_out'] }], partners)).toHaveLength(1);
  });
});
