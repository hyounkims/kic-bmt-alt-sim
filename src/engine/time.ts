// 연도(정수)와 연 소수 시각을 타입으로 구분한다 (DESIGN.md 2장, CLAUDE.md 테스트 규칙).
//   Year     : 달력 연도 정수. 예) 2024
//   YearTime : 연도 + 경과 비율. 예) 2024.19 = 2024년 1월 1일로부터 0.19년 경과
// 둘 다 런타임에는 number이며, 브랜드는 컴파일 타임에만 존재한다.

export type Year = number & { readonly __brand: 'Year' };
export type YearTime = number & { readonly __brand: 'YearTime' };

export function asYear(n: number): Year {
  if (!Number.isInteger(n)) throw new RangeError(`연도는 정수여야 함: ${n}`);
  return n as Year;
}

export function asYearTime(n: number): YearTime {
  if (!Number.isFinite(n)) throw new RangeError(`시각은 유한한 수여야 함: ${n}`);
  return n as YearTime;
}

/** 시각이 속한 연도: ⌊t⌋ */
export function yearOf(t: YearTime): Year {
  return Math.floor(t) as Year;
}

/** 연도 y의 1월 1일 시각 (y.0) */
export function startOf(y: Year): YearTime {
  return y as number as YearTime;
}

/** 연도 y의 연말 시각 (= 다음 해 1월 1일, y + 1) */
export function endOf(y: Year): YearTime {
  return (y + 1) as YearTime;
}

// TODO(M2): dateToYearTime(iso) — year + (dayOfYear − 1) / daysInYear
//           예) 2026-09-30 → 2026 + 272/365 ≈ 2026.745
