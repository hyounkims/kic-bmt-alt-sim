// 엔진 상수와 기본값. [권장] 항목은 여기서 한 번에 바꿀 수 있게 분리한다 (CLAUDE.md 기준 문서).

import { ASSET_CLASSES, type ByClass, type Options, type Scenario } from './types';
import { asYear } from './time';

/** 3.3-C [권장] 조정 후 IRR′ 하한 (이상) */
export const ADJUSTED_IRR_MIN = 0.01;
/** 3.3-C [권장] 조정 후 MoIC′ 하한 (초과) */
export const ADJUSTED_MOIC_MIN_EXCLUSIVE = 1.0;
/** 하한 경계 비교용 부동소수 허용 오차 */
export const BOUND_EPSILON = 1e-9;

/** 3.3-7 조정 단위: 원문 "±3%씩", "±20%씩". 해석(pp/relative 등)은 options가 정한다 */
export const IRR_STEPS: readonly number[] = [-0.06, -0.03, 0, 0.03, 0.06];
export const MOIC_STEPS: readonly number[] = [-0.4, -0.2, 0, 0.2, 0.4];

/** 6장 mock 무결성 */
export const MOCK_FUND_COUNT = 12;
export const MOCK_TOTAL_COMMITMENT = 3000;

/** 3.2 기준일 기본값 (원문 "2026년 9월" → 9월 말). 화면·인쇄 공통, 인쇄는 화면 기준일을 따름 (v0.9.4) */
export const DEFAULT_AS_OF = '2026-09-30';

/** 모든 자산군에 같은 값 */
export function byClassOf<T>(value: T): ByClass<T> {
  return Object.fromEntries(ASSET_CLASSES.map((c) => [c, value])) as ByClass<T>;
}

/** 조정 없음 = 원문 기본 가정 */
export const ZERO_SCENARIO: Scenario = {
  irrShift: byClassOf(0),
  moicShift: byClassOf(0),
};

/** 5장 입력 예시의 기본 옵션. 화면·인쇄 기준일 기본값 2026-09-30 (3.2 v0.9.1) */
export const DEFAULT_OPTIONS: Options = {
  asOf: DEFAULT_AS_OF,
  irrShiftMode: 'pp',
  moicShiftMode: 'relative',
  applyToDirect: true,
  navBasis: 'gross',
  calcStart: asYear(2015),
  displayStart: asYear(2017),
};
