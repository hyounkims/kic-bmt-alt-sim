import { expect } from 'vitest';
import mock from '../src/data/portfolio.mock.json';
import { DEFAULT_OPTIONS, ZERO_SCENARIO, byClassOf } from '../src/engine/constants';
import type { Options, Portfolio, Scenario, SimInput } from '../src/engine/types';
import { parsePortfolio } from '../src/engine/validate';

export function mockPortfolio(): Portfolio {
  const { portfolio, errors } = parsePortfolio(mock);
  if (!portfolio) throw new Error(`mock 파싱 실패: ${JSON.stringify(errors)}`);
  return portfolio;
}

/** 11.1 고정 입력: mock, 기준일 2026-09-30, 전 구간 모드 */
export function baseInput(patch: { scenario?: Scenario; options?: Partial<Options> } = {}): SimInput {
  return {
    portfolio: mockPortfolio(),
    scenario: patch.scenario ?? ZERO_SCENARIO,
    options: { ...DEFAULT_OPTIONS, ...patch.options },
  };
}

/** 전 자산군 동시 조정 (8장 5개 시나리오 방식) */
export function uniformScenario(irrShift: number, moicShift: number): Scenario {
  return { irrShift: byClassOf(irrShift), moicShift: byClassOf(moicShift) };
}

/** 표시값 비교: |차이| ≤ 0.01 (CLAUDE.md 코드 규칙) */
export function expectDisplay(actual: number | undefined, expected: number, label: string): void {
  expect(actual, `${label}: 값 없음`).toBeDefined();
  expect(Math.abs((actual ?? Number.NaN) - expected), `${label}: 실제 ${actual}, 기대 ${expected}`).toBeLessThanOrEqual(0.01);
}

/** 정확값 비교: |차이| ≤ 1e-6 */
export function expectExact(actual: number | undefined, expected: number, label: string): void {
  expect(actual, `${label}: 값 없음`).toBeDefined();
  expect(Math.abs((actual ?? Number.NaN) - expected), `${label}: 실제 ${actual}, 기대 ${expected}`).toBeLessThanOrEqual(1e-6);
}
