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

// ── 분기 (DESIGN.md 2장·7.3·7.6 v0.9) ─────────────────────────
// 분기 키 qIndex = 4 × 연도 + (분기 − 1). Q4 말(y + 1.0)과 다음 해 1월 1일은 시각이 같으므로
// 비교·집계는 시각이 아니라 qIndex로 한다.

export type QIndex = number & { readonly __brand: 'QIndex' };

export function qIndexOf(year: number, quarter: number): QIndex {
  if (!Number.isInteger(year) || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) throw new RangeError(`분기 오류: ${year} Q${quarter}`);
  return (4 * year + quarter - 1) as QIndex;
}

/** 분기의 연도 */
export function qYear(q: QIndex): Year {
  return Math.floor(q / 4) as Year;
}

/** 분기 번호 1~4 */
export function qNumber(q: QIndex): 1 | 2 | 3 | 4 {
  return ((((q % 4) + 4) % 4) + 1) as 1 | 2 | 3 | 4;
}

/** 분기말 시각 (Q1 말 = y.25, Q4 말 = y + 1) */
export function qEndTime(q: QIndex): YearTime {
  return ((q + 1) / 4) as YearTime;
}

/** 연도 y의 1월 1일이 속한 분기 (그해 Q1) */
export function qOfYearStart(y: Year): QIndex {
  return (4 * y) as QIndex;
}

/** 도달 시각 T가 속한 분기: ⌈4T⌉ − 1 (분기 경계에 정확히 닿으면 그 경계로 끝나는 분기). 회수는 이 분기말에 인식 (7.3) */
export function quarterOfReach(t: YearTime): QIndex {
  return (Math.ceil(4 * t - 1e-9) - 1) as QIndex;
}

/**
 * 회수일 (7.3 v0.9.2): 도달 시각 T의 달력 날짜 YYYY-MM-DD.
 * 1월 1일 + ⌊(T − y) × 그해 일수⌋일. 분기 규칙(4등분)과 달력 분기의 차이로 경계 근처에서
 * 다른 분기 날짜가 나오면 회수 분기 q의 첫날~마지막 날로 제한한다
 */
export function reachDateOf(t: YearTime, q: QIndex): string {
  const y = Math.floor(t);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dayIndex = Math.floor((t - y) * (leap ? 366 : 365) + 1e-9);
  const ms = Date.UTC(y, 0, 1 + dayIndex);
  const qy = qYear(q);
  const qn = qNumber(q);
  const first = Date.UTC(qy, (qn - 1) * 3, 1);
  const last = Date.UTC(qy, qn * 3, 0);
  return new Date(Math.min(Math.max(ms, first), last)).toISOString().slice(0, 10);
}

/** 기준 분기: 날짜 이전 마지막 분기말이 속한 분기 (그 날짜가 분기말이면 그 분기) (7.6) */
export function asOfQuarterOf(iso: string): QIndex {
  if (!isValidIsoDate(iso)) throw new RangeError(`유효하지 않은 날짜: ${iso}`);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const quarterOfMonth = Math.floor((month - 1) / 3); // 0~3
  const lastDayOfQuarterMonth = new Date(Date.UTC(year, quarterOfMonth * 3 + 3, 0)).getUTCDate();
  const isQuarterEnd = month === quarterOfMonth * 3 + 3 && day === lastDayOfQuarterMonth;
  return (4 * year + quarterOfMonth - (isQuarterEnd ? 0 : 1)) as QIndex;
}
