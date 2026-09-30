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

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** YYYY-MM-DD 문자열이 실제 존재하는 날짜인지 (2026-02-30 등 거부). 시간대 영향 없도록 UTC로만 계산 */
export function isValidIsoDate(iso: string): boolean {
  const m = ISO_DATE.exec(iso);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function daysInYear(year: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return leap ? 366 : 365;
}

/**
 * 날짜 → 연 소수 시각 (DESIGN.md 2장): year + (dayOfYear − 1) / daysInYear.
 * 예) 2026-09-30 → 2026 + 272/365 ≈ 2026.745
 */
export function dateToYearTime(iso: string): YearTime {
  if (!isValidIsoDate(iso)) throw new RangeError(`유효하지 않은 날짜: ${iso}`);
  const year = Number(iso.slice(0, 4));
  const elapsedDays = (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(year, 0, 1)) / MS_PER_DAY;
  return (year + elapsedDays / daysInYear(year)) as YearTime;
}
