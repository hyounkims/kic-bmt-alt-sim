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
