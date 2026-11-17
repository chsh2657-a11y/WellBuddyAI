import { describe, expect, it } from 'vitest';
import { isScheduleDue, nextScheduledRun, schedulePresetOf } from './integrations.js';

const at = (iso: string) => new Date(iso);

describe('예약 수집 주기(P2-16)', () => {
  it('저장된 크론을 프리셋으로 읽는다', () => {
    expect(schedulePresetOf('0 * * * *')).toBe('hourly');
    expect(schedulePresetOf('0 6 * * *')).toBe('daily');
    expect(schedulePresetOf(null)).toBe('manual');
    expect(schedulePresetOf('*/5 * * * *')).toBe('manual');
  });

  it('매시간: 한 번도 안 돌았으면 바로, 아니면 마지막 실행 55분 뒤', () => {
    const now = at('2026-09-30T03:00:00Z');
    expect(isScheduleDue('hourly', null, now)).toBe(true);
    expect(isScheduleDue('hourly', at('2026-09-30T02:10:00Z'), now)).toBe(false);
    expect(isScheduleDue('hourly', at('2026-09-30T02:05:00Z'), now)).toBe(true);
    expect(nextScheduledRun('hourly', at('2026-09-30T02:10:00Z'), now)).toEqual(
      at('2026-09-30T03:05:00Z'),
    );
  });

  it('매일: 한국 시간 오전 6시가 지나고 오늘 아직 안 돌았을 때', () => {
    // 한국 07:00 = UTC 전날 22:00
    const morning = at('2026-09-29T22:00:00Z');
    const sixAm = at('2026-09-29T21:00:00Z');
    expect(isScheduleDue('daily', null, morning)).toBe(true);
    expect(isScheduleDue('daily', at('2026-09-29T08:00:00Z'), morning)).toBe(true);
    expect(isScheduleDue('daily', at('2026-09-29T21:30:00Z'), morning)).toBe(false);
    expect(nextScheduledRun('daily', at('2026-09-29T21:30:00Z'), morning)).toEqual(
      at('2026-09-30T21:00:00Z'),
    );
    // 한국 05:00: 아직 6시 전
    const early = at('2026-09-29T20:00:00Z');
    expect(isScheduleDue('daily', at('2026-09-28T21:00:00Z'), early)).toBe(false);
    expect(nextScheduledRun('daily', null, early)).toEqual(sixAm);
  });

  it('수동은 예약하지 않는다', () => {
    expect(nextScheduledRun('manual', null, new Date())).toBeNull();
    expect(isScheduleDue('manual', null, new Date())).toBe(false);
  });
});
