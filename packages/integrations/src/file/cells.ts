/** 엑셀·CSV 셀 값 해석(원 단위 금액, 날짜·시각) */

/** "1,234" "-1,234" "(1,234)" "1,234원" "" → 정수. 숫자가 아니면 null */
export function parseAmount(value: string | undefined): number | null {
  const raw = (value ?? '').trim();
  if (raw === '' || raw === '-') return 0;
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith('-') || raw.startsWith('△');
  const digits = raw.replace(/[(),원\s△+-]/g, '');
  if (!/^\d+(\.0+)?$/.test(digits)) return null;
  const n = Number(digits.split('.')[0]);
  if (!Number.isSafeInteger(n)) return null;
  return negative ? -n : n;
}

/**
 * 날짜·일시 문자열 → { date: YYYY-MM-DD, time: HH:MM:SS | null }
 * 2026-03-10, 2026.03.10, 2026/03/10, 20260310, 2026-03-10 14:23(:11), 2026년 3월 10일, 엑셀 일련번호(46091)
 */
export function parseDateTime(
  value: string | undefined,
): { date: string; time: string | null } | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  if (/^\d{5}(\.\d+)?$/.test(raw)) {
    // 엑셀 날짜 일련번호(1900 날짜 체계)
    const serial = Number(raw);
    const ms = Math.round((serial - 25569) * 86_400_000);
    const d = new Date(ms);
    const date = d.toISOString().slice(0, 10);
    const secs = Math.round((serial % 1) * 86_400);
    const time =
      secs > 0
        ? [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60]
            .map((n) => String(n).padStart(2, '0'))
            .join(':')
        : null;
    return { date, time };
  }
  const m =
    /^(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})일?(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
      raw,
    ) ?? /^(\d{4})(\d{2})(\d{2})(?:\s*(\d{2}):?(\d{2}):?(\d{2})?)?$/.exec(raw);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const time = h ? `${h.padStart(2, '0')}:${mi}:${s ?? '00'}` : null;
  return { date, time };
}

/** "14:23" "142311" → HH:MM:SS */
export function parseTime(value: string | undefined): string | null {
  const raw = (value ?? '').trim();
  const m = /^(\d{1,2}):?(\d{2}):?(\d{2})?$/.exec(raw);
  if (!m) return null;
  return `${m[1]!.padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}`;
}

/** 사업자등록번호 숫자 10자리만 남긴다(아니면 null) */
export function normalizeBizNo(value: string | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length === 10 ? digits : null;
}

/** 머리글 비교용: 공백·괄호·단위 제거 */
export function normalizeHeader(value: string): string {
  return value
    .replace(/[\s()（）[\]·.*]/g, '')
    .replace(/\(?원\)?$/, '')
    .toLowerCase();
}
