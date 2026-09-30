import { describe, expect, it } from 'vitest';
import { asYear, asYearTime, endOf, startOf, yearOf, type Year, type YearTime } from '../src/engine/time';

describe('연도·연 소수 시각 타입 (DESIGN.md 2장)', () => {
  it('asYear는 정수만 허용', () => {
    expect(asYear(2024)).toBe(2024);
    expect(() => asYear(2024.5)).toThrow(RangeError);
  });

  it('asYearTime은 유한한 수만 허용', () => {
    expect(asYearTime(2024.19)).toBe(2024.19);
    expect(() => asYearTime(Number.NaN)).toThrow(RangeError);
  });

  it('yearOf는 ⌊t⌋, startOf·endOf는 y.0·y+1', () => {
    expect(yearOf(asYearTime(2024.19))).toBe(2024);
    expect(yearOf(asYearTime(2024))).toBe(2024);
    expect(startOf(asYear(2024))).toBe(2024);
    expect(endOf(asYear(2024))).toBe(2025);
  });

  it('연도와 시각은 서로 대입할 수 없음 (컴파일 타임 검사, npm run typecheck)', () => {
    const y: Year = asYear(2024);
    const t: YearTime = asYearTime(2024.19);
    // @ts-expect-error Year는 YearTime 자리에 쓸 수 없다
    const wrongTime: YearTime = y;
    // @ts-expect-error YearTime은 Year 자리에 쓸 수 없다
    const wrongYear: Year = t;
    // @ts-expect-error 일반 number도 Year 자리에 쓸 수 없다
    const plain: Year = 2024;
    expect([wrongTime, wrongYear, plain]).toHaveLength(3);
  });
});

describe('dateToYearTime (DESIGN.md 2장)', () => {
  it('2026-09-30 → 2026 + 272/365 ≈ 2026.745', async () => {
    const { dateToYearTime } = await import('../src/engine/time');
    expect(dateToYearTime('2026-09-30')).toBeCloseTo(2026 + 272 / 365, 12);
    expect(dateToYearTime('2026-01-01')).toBe(2026);
    expect(dateToYearTime('2026-12-31')).toBeCloseTo(2026 + 364 / 365, 12);
  });

  it('윤년은 366일 기준', async () => {
    const { dateToYearTime } = await import('../src/engine/time');
    expect(dateToYearTime('2024-12-31')).toBeCloseTo(2024 + 365 / 366, 12);
    expect(dateToYearTime('2024-03-01')).toBeCloseTo(2024 + 60 / 366, 12);
  });

  it('존재하지 않는 날짜·형식 오류는 거부', async () => {
    const { dateToYearTime, isValidIsoDate } = await import('../src/engine/time');
    for (const bad of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-9-30', '20260930', '']) {
      expect(isValidIsoDate(bad), bad).toBe(false);
      expect(() => dateToYearTime(bad), bad).toThrow(RangeError);
    }
    expect(isValidIsoDate('2024-02-29')).toBe(true);
  });
});
