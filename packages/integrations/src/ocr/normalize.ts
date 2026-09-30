import { normalizeBizNo } from '@wellbuddy/accounting-core';
import type { ReceiptFields } from '../records.js';

/** 영수증 날짜 표기(2026.09.15, 26/09/15, 2026년 9월 15일, 20260915 …) → YYYY-MM-DD */
export function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  let m = s.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  let year: number;
  if (m) {
    year = Number(m[1]);
  } else if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(?!\d)/))) {
    year = Number(m[1]);
  } else if ((m = s.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/))) {
    year = 2000 + Number(m[1]);
  } else {
    return null;
  }
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || year < 2000) return null;
  return date.toISOString().slice(0, 10);
}

/** 12,000원 · ₩12,000 · 12000 → 12000(원 단위 정수). 읽을 수 없으면 null */
export function normalizeAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(Math.abs(value)) : null;
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[^\d.]/g, '');
  if (!/\d/.test(digits)) return null;
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) ? Math.round(n) : null;
}

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;

/** 공급자가 읽은 값을 공통 형식으로. 부가세가 합계보다 크면 버린다 */
export function receiptFields(raw: {
  date?: unknown;
  merchantName?: unknown;
  bizNo?: unknown;
  totalAmount?: unknown;
  vatAmount?: unknown;
  confidence?: unknown;
  items?: { name?: unknown; amount?: unknown }[] | null;
}): ReceiptFields {
  const totalAmount = normalizeAmount(raw.totalAmount);
  let vatAmount = normalizeAmount(raw.vatAmount);
  if (vatAmount !== null && totalAmount !== null && vatAmount > totalAmount) vatAmount = null;
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0;
  const items = (raw.items ?? []).flatMap((i) => {
    const name = text(i.name);
    const amount = normalizeAmount(i.amount);
    return name && amount !== null ? [{ name, amount }] : [];
  });
  return {
    date: normalizeDate(raw.date),
    merchantName: text(raw.merchantName),
    bizNo: typeof raw.bizNo === 'string' ? normalizeBizNo(raw.bizNo) : null,
    totalAmount,
    vatAmount,
    confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100,
    ...(items.length > 0 ? { items: items.slice(0, 50) } : {}),
  };
}

/** 신뢰도를 주지 않는 공급자: 핵심 값(날짜·가맹점·합계)을 얼마나 읽었는지로 어림한다 */
export function estimateConfidence(fields: Omit<ReceiptFields, 'confidence'>): number {
  const found = [fields.date, fields.merchantName, fields.totalAmount].filter(
    (v) => v !== null,
  ).length;
  return found === 3 ? 0.85 : found === 0 ? 0 : 0.5;
}
