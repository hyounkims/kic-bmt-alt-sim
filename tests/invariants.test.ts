import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine/simulate';
import { ASSET_CLASSES, type Scenario, type SeriesPoint, type SimInput } from '../src/engine/types';
import { yearOf } from '../src/engine/time';
import { presetScenario, SCENARIO_PRESETS } from '../src/engine/scenarios';
import { baseInput, uniformScenario } from './fixtures';

// DESIGN.md 11.2 불변 조건.
// 현재: mock + 8장 5개 시나리오(결정론적 입력), 실무 모드. fast-check 무작위 입력은 M6.

const TOL = 1e-6;
const FIELDS = ['callInvest', 'callFee', 'dist', 'nav', 'cumCall', 'cumDist'] as const;

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

describe.each(cases)('11.2 불변 조건: %s', (_name, input) => {
  const out = simulate(input);
  const total = out.series.total;
  const last = total[total.length - 1] as SeriesPoint;

  it('오류 없음', () => {
    expect(out.errors).toEqual([]);
  });

  it('누적 투자 Call 총합 = 약정 합계', () => {
    const commitments = input.portfolio.funds.reduce((s, f) => s + f.commitment, 0);
    expect(Math.abs(total.reduce((s, p) => s + p.callInvest, 0) - commitments)).toBeLessThan(TOL);
  });

  it('각 집행분 회수 총액 = A × M′ (실무 모드 초과 케이스는 ≥), 성과보수 = carry × (회수 총액 − A), direct는 0', () => {
    const funds = new Map(input.portfolio.funds.map((f) => [f.id, f]));
    const forward = input.options.sensitivityMode === 'forward';
    for (const t of out.tranches) {
      const f = funds.get(t.fundId);
      if (forward) expect(t.exitGross).toBeGreaterThanOrEqual(t.amount * t.moic - TOL);
      else expect(Math.abs(t.exitGross - t.amount * t.moic)).toBeLessThan(TOL);
      const carry = f?.type === 'direct' ? 0 : input.portfolio.fees.carry * (t.exitGross - t.amount);
      expect(Math.abs(t.carry - carry)).toBeLessThan(TOL);
      expect(Math.abs(t.exitNet - (t.exitGross - t.carry))).toBeLessThan(TOL);
    }
  });

  it('최종 연도 NAV = 0, 최종 누적 Distribution = Σ 순회수', () => {
    expect(last.nav).toBe(0);
    expect(Math.abs(last.cumDist - out.tranches.reduce((s, t) => s + t.exitNet, 0))).toBeLessThan(TOL);
  });

  it('연도별 집계 = 해당 연도 이벤트 합', () => {
    for (const p of total) {
      const ev = out.events.filter((e) => yearOf(e.time) === p.year);
      const sum = (type: string) => ev.filter((e) => e.type === type).reduce((s, e) => s + e.amount, 0);
      expect(Math.abs(p.callInvest - sum('call'))).toBeLessThan(TOL);
      expect(Math.abs(p.callFee - sum('fee'))).toBeLessThan(TOL);
      expect(Math.abs(p.dist - sum('dist'))).toBeLessThan(TOL);
    }
  });

  it('자산군 합 = 전체 (모든 연도, 모든 필드), 펀드 합 = 전체', () => {
    total.forEach((p, i) => {
      for (const k of FIELDS) {
        const byClass = ASSET_CLASSES.reduce((s, c) => s + (out.series.byClass[c][i]?.[k] ?? Number.NaN), 0);
        const byFund = Object.values(out.series.byFund).reduce((s, fs) => s + (fs[i]?.[k] ?? Number.NaN), 0);
        expect(Math.abs(byClass - p[k]), `${p.year} ${k} 자산군 합`).toBeLessThan(TOL);
        expect(Math.abs(byFund - p[k]), `${p.year} ${k} 펀드 합`).toBeLessThan(TOL);
      }
    });
  });

  it('모든 수치 ≥ 0', () => {
    const points = [...total, ...Object.values(out.series.byFund).flat()];
    for (const p of points) for (const k of FIELDS) expect(p[k]).toBeGreaterThanOrEqual(0);
    for (const e of out.events) expect(e.amount).toBeGreaterThanOrEqual(0);
  });

  it('계단형 누적선 최종값 = 연도별 최종 누적값', () => {
    const lastStep = out.steps.total[out.steps.total.length - 1];
    expect(Math.abs((lastStep?.cumCall ?? Number.NaN) - last.cumCall)).toBeLessThan(TOL);
    expect(Math.abs((lastStep?.cumDist ?? Number.NaN) - last.cumDist)).toBeLessThan(TOL);
  });

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

describe('11.2 무작위 입력', () => {
  it.todo('fast-check 무작위 포트폴리오 (M6)');
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

  it('MoIC −20%: N₀ 139.41 ≥ 목표 120 → 기준일에 N₀로 회수 (3.3-D)', () => {
    const t = aaa2023(fwd(uniformScenario(0, -0.2)));
    expect(Math.abs((t?.exitTime ?? 0) - tau)).toBeLessThan(1e-12);
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
