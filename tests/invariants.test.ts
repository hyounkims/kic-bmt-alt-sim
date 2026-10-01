import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine/simulate';
import type { SimInput } from '../src/engine/types';
import { arbInput } from './arbitraries';
import { baseInput, uniformScenario } from './fixtures';
import { checkInvariants } from './invariantChecks';

// DESIGN.md 11.2 불변 조건: mock + 8장 5개 시나리오(결정론적), fast-check 무작위 입력.

const TOL = 1e-6;
/** 속성 테스트는 수백 회 실행하므로 기본 5초 대신 60초 (PC 부하에 따른 시간 초과 방지) */
const PROPERTY_TIMEOUT = 60_000;

const cases: [string, SimInput][] = [
  ['base', baseInput()],
  ['irrDown', baseInput({ scenario: uniformScenario(-0.03, 0) })],
  ['irrUp', baseInput({ scenario: uniformScenario(0.03, 0) })],
  ['moicDown', baseInput({ scenario: uniformScenario(0, -0.2) })],
  ['moicUp', baseInput({ scenario: uniformScenario(0, 0.2) })],
  ['net NAV', baseInput({ options: { navBasis: 'net' } })],
];

function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null) {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

describe.each(cases)('11.2 불변 조건 (mock): %s', (_name, input) => {
  it('공통 불변 조건', () => checkInvariants(input, simulate(input)));


  it('입력을 변경하지 않음 (CLAUDE.md 원본 불변)', () => {
    const frozen = deepFreeze(structuredClone(input));
    expect(() => simulate(frozen)).not.toThrow();
    expect(frozen).toEqual(input);
  });
});

describe('KPI 기준일 정의 (9장)', () => {
  it('기준일이 종료 이후면 KPI = 최종 누적값, NAV 0', () => {
    const out = simulate(baseInput({ options: { asOf: '2040-01-01' } }));
    const last = out.series.total[out.series.total.length - 1];
    expect(Math.abs(out.kpi.total.cumCall - (last?.cumCall ?? Number.NaN))).toBeLessThan(TOL);
    expect(Math.abs(out.kpi.total.cumDist - (last?.cumDist ?? Number.NaN))).toBeLessThan(TOL);
    expect(out.kpi.total.nav).toBe(0);
  });
});

// 11.2 무작위 입력: 펀드 1~15개, 임의 약정·Vintage·집행기간·IRR·MoIC·보수율, 3.3-C 안의 조정, 임의 옵션·기준일
describe('11.2 불변 조건 (fast-check 무작위 입력)', () => {
  it('공통 불변 조건', () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        checkInvariants(input, simulate(input));
      }),
      { numRuns: 300 },
    );
  }, PROPERTY_TIMEOUT);

  it('입력을 변경하지 않음', () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        const frozen = deepFreeze(structuredClone(input));
        simulate(frozen);
        expect(frozen).toEqual(input);
      }),
      { numRuns: 50 },
    );
  }, PROPERTY_TIMEOUT);
});
