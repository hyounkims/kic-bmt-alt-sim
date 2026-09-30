// 엔진 상수와 기본값. [권장] 항목은 여기서 한 번에 바꿀 수 있게 분리한다 (CLAUDE.md 기준 문서).

import { ASSET_CLASSES, type ByClass, type Options, type Scenario } from './types';
import { asYear } from './time';

/** 3.3-C [권장] 조정 후 IRR′ 하한 (이상) */
export const ADJUSTED_IRR_MIN = 0.01;
/** 3.3-C [권장] 조정 후 MoIC′ 하한 (초과) */
export const ADJUSTED_MOIC_MIN_EXCLUSIVE = 1.0;
/** 하한 경계 비교용 부동소수 허용 오차 */
export const BOUND_EPSILON = 1e-9;

/** 6장 mock 무결성 */
export const MOCK_FUND_COUNT = 12;
export const MOCK_TOTAL_COMMITMENT = 3000;

/** 3.2 인쇄 기준일 고정 (원문 "2026년 9월" → 9월 말) */
export const PRINT_AS_OF = '2026-09-30';

/** 모든 자산군에 같은 값 */
export function byClassOf<T>(value: T): ByClass<T> {
  return Object.fromEntries(ASSET_CLASSES.map((c) => [c, value])) as ByClass<T>;
}

/** 조정 없음 = 원문 기본 가정 */
export const ZERO_SCENARIO: Scenario = {
  irrShift: byClassOf(0),
  moicShift: byClassOf(0),
};

/** 5장 입력 예시의 기본 옵션. 화면 기준일은 UI가 오늘 날짜로 덮어쓴다 (3.2) */
export const DEFAULT_OPTIONS: Options = {
  asOf: PRINT_AS_OF,
  irrShiftMode: 'pp',
  moicShiftMode: 'relative',
  applyToDirect: true,
  sensitivityMode: 'full',
  navBasis: 'gross',
  calcStart: asYear(2015),
  displayStart: asYear(2017),
};
