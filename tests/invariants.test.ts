import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ZERO_SCENARIO } from '../src/engine/constants';
import { simulate } from '../src/engine/simulate';
import type { Scenario, SimInput } from '../src/engine/types';
import { presetScenario, SCENARIO_PRESETS } from '../src/engine/scenarios';
import { arbInput, arbOptions, arbPortfolio } from './arbitraries';
import { baseInput, uniformScenario } from './fixtures';
import { checkForwardFixedPast, checkInvariants, FIELDS, tolFor } from './invariantChecks';

// DESIGN.md 11.2 불변 조건: mock + 8장 5개 시나리오(결정론적), fast-check 무작위 입력, 실무 모드.

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
  ['실무 모드 irrDown', baseInput({ scenario: uniformScenario(-0.03, 0), options: { sensitivityMode: 'forward' } })],
  ['실무 모드 moicDown', baseInput({ scenario: uniformScenario(0, -0.2), options: { sensitivityMode: 'forward' } })],
  ['실무 모드 moicUp', baseInput({ scenario: uniformScenario(0, 0.2), options: { sensitivityMode: 'forward' } })],
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

  if (input.options.sensitivityMode === 'forward') {
    it('실무 모드: 기준일 이전 = 기본 가정', () => checkForwardFixedPast(input, simulate(input)));
  }

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
  it('공통 불변 조건 — 전 구간·실무 모드', () => {
    fc.assert(
      fc.property(arbInput(), (input) => {
        checkInvariants(input, simulate(input));
      }),
      { numRuns: 300 },
    );
  }, PROPERTY_TIMEOUT);

  it('실무 모드: 기준일 이전 이벤트·연말 NAV·기준일 KPI = 기본 가정', () => {
    fc.assert(
      fc.property(arbInput(['forward']), (input) => {
        checkForwardFixedPast(input, simulate(input));
      }),
      { numRuns: 300 },
    );
  }, PROPERTY_TIMEOUT);

  it('조정 없음이면 실무 모드 = 전 구간 모드', () => {
    fc.assert(
      fc.property(arbPortfolio, arbOptions(['full']), (portfolio, options) => {
        const full = simulate({ portfolio, scenario: ZERO_SCENARIO, options });
        const fwd = simulate({ portfolio, scenario: ZERO_SCENARIO, options: { ...options, sensitivityMode: 'forward' } });
        const tol = tolFor({ portfolio, scenario: ZERO_SCENARIO, options });
        expect(fwd.meta.endYear).toBe(full.meta.endYear);
        fwd.series.total.forEach((pt, i) => {
          for (const k of FIELDS) expect(Math.abs(pt[k] - (full.series.total[i]?.[k] ?? Number.NaN))).toBeLessThanOrEqual(tol);
        });
      }),
      { numRuns: 200 },
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

// 11.2 실무 모드 (7.7): 기준일 이전 이벤트·연말 NAV = 기본 가정 결과
describe('11.2 실무 모드 (7.7)', () => {
  const fwd = (scenario: Scenario) => simulate(baseInput({ scenario, options: { sensitivityMode: 'forward' } }));
  const base = simulate(baseInput());
  const tau = base.meta.asOfTime;
  const shifts: [string, Scenario][] = [
    ...SCENARIO_PRESETS.map((p): [string, Scenario] => [p.key, presetScenario(p)]),
    ['PE IRR −6%p', { ...uniformScenario(0, 0), irrShift: { PE: -0.06, RE: 0, Infra: 0, PD: 0 } }],
    ['Infra MoIC +40%', { ...uniformScenario(0, 0), moicShift: { PE: 0, RE: 0, Infra: 0.4, PD: 0 } }],
    ['IRR +6%p·MoIC −20%', uniformScenario(0.06, -0.2)],
  ];

  it('조정 없음이면 전 구간 모드와 같음', () => {
    const f = fwd(uniformScenario(0, 0));
    f.tranches.forEach((t, i) => expect(Math.abs(t.exitTime - (base.tranches[i]?.exitTime ?? Number.NaN))).toBeLessThan(1e-9));
    f.series.total.forEach((pt, i) => {
      for (const k of FIELDS) expect(Math.abs(pt[k] - (base.series.total[i]?.[k] ?? Number.NaN))).toBeLessThan(TOL);
    });
  });

  describe.each(shifts)('%s', (_name, scenario) => {
    const out = fwd(scenario);
    it('오류 없음', () => expect(out.errors).toEqual([]));

    it('기준일 KPI = 기본 가정 KPI (기준일 이전 고정)', () => {
      for (const k of ['cumCall', 'cumDist', 'nav', 'dpi', 'tvpi'] as const) expect(Math.abs(out.kpi.total[k] - base.kpi.total[k]), k).toBeLessThan(TOL);
    });

    it('기준일 이전 이벤트 = 기본 가정 결과', () => {
      const key = (e: { time: number; type: string; fundId: string; amount: number }) => `${e.fundId}|${e.type}|${e.time.toFixed(9)}|${e.amount.toFixed(9)}`;
      const before = (o: typeof out) => o.events.filter((e) => e.time < tau).map(key).sort();
      expect(before(out)).toEqual(before(base));
    });

    it('기준일 이전 연말 NAV (y + 1 ≤ 기준일) = 기본 가정 결과', () => {
      out.series.total.filter((pt) => pt.year + 1 <= tau).forEach((pt, i) => {
        expect(Math.abs(pt.nav - (base.series.total[i]?.nav ?? Number.NaN)), `${pt.year}`).toBeLessThan(TOL);
      });
    });

    it('고정 집행분 = 기본 가정 회수 시각 ≤ 기준일, 회수 총액 ≥ A × M′', () => {
      out.tranches.forEach((t, i) => {
        const b = base.tranches[i];
        expect(t.locked).toBe((b?.exitTime ?? Number.NaN) <= tau);
        if (!t.locked) expect(t.exitGross).toBeGreaterThanOrEqual(t.amount * t.moic - TOL);
        expect(t.exitTime).toBeGreaterThanOrEqual(Math.min(b?.exitTime ?? 0, tau) - TOL);
      });
    });
  });

  // 손 계산: AAA VII 2023 집행분, N₀ = 75 × 1.18^(2026.745 − 2023) = 139.41
  const aaa2023 = (o: ReturnType<typeof fwd>) => o.tranches.find((t) => t.fundId === 'AAA_VII' && t.investYear === 2023);

  it('MoIC −20%: N₀ 139.41 ≥ 목표 120 → 기준일 직후에 N₀로 회수 (3.3-D, v0.6)', () => {
    const out = fwd(uniformScenario(0, -0.2));
    const t = aaa2023(out);
    expect(t?.exitTime).toBeGreaterThan(tau);
    expect((t?.exitTime ?? 0) - tau).toBeLessThan(1e-6);
    // 기준일 시점에는 보유 중: 기준일 KPI = 기본 가정 KPI
    for (const k of ['cumCall', 'cumDist', 'nav', 'dpi', 'tvpi'] as const) expect(Math.abs(out.kpi.total[k] - base.kpi.total[k]), k).toBeLessThan(TOL);
    expect(Math.abs((t?.exitGross ?? 0) - 139.41)).toBeLessThanOrEqual(0.01);
    expect(Math.abs((t?.carry ?? 0) - 0.2 * (139.4085 - 75))).toBeLessThanOrEqual(0.01);
  });

  it('PE IRR −3%p: 139.41 → 150에 0.524년, 회수 시각 2027.27 (전 구간 모드 2027.96)', () => {
    const t = aaa2023(fwd({ ...uniformScenario(0, 0), irrShift: { PE: -0.03, RE: 0, Infra: 0, PD: 0 } }));
    expect(Math.abs((t?.exitTime ?? 0) - 2027.27)).toBeLessThanOrEqual(0.01);
    expect(Math.abs((t?.exitGross ?? 0) - 150)).toBeLessThan(TOL);
    expect(t?.locked).toBe(false);
  });
});
