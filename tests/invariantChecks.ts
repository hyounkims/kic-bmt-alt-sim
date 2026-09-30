// DESIGN.md 11.2 불변 조건 검사 함수. mock 결정론 테스트와 fast-check 무작위 테스트가 공유한다.
import { expect } from 'vitest';
import { ZERO_SCENARIO } from '../src/engine/constants';
import { simulate } from '../src/engine/simulate';
import { yearOf } from '../src/engine/time';
import { ASSET_CLASSES, type SimInput, type SimOutput } from '../src/engine/types';

export const FIELDS = ['callInvest', 'callFee', 'dist', 'nav', 'cumCall', 'cumDist'] as const;

/** 규모에 비례하는 허용 오차 (금액 최대 수만 $mn) */
export function tolFor(input: SimInput): number {
  const scale = input.portfolio.funds.reduce((s, f) => s + f.commitment, 0);
  return 1e-9 * Math.max(1, scale * 10);
}

const near = (a: number | undefined, b: number | undefined, tol: number, label: string) =>
  expect(Math.abs((a ?? Number.NaN) - (b ?? Number.NaN)), `${label}: ${a} vs ${b}`).toBeLessThanOrEqual(tol);

/** 11.2 공통 불변 조건 (전 구간·실무 모드) */
export function checkInvariants(input: SimInput, out: SimOutput): void {
  const tol = tolFor(input);
  expect(out.errors).toEqual([]);
  const total = out.series.total;
  const last = total[total.length - 1];
  const forward = input.options.sensitivityMode === 'forward';
  const funds = new Map(input.portfolio.funds.map((f) => [f.id, f]));

  // 누적 투자 Call 총합 = 약정 합계
  near(total.reduce((s, p) => s + p.callInvest, 0), input.portfolio.funds.reduce((s, f) => s + f.commitment, 0), tol, '투자 Call 합');

  // 회수 총액 = A × M′ (실무 모드 초과 케이스는 ≥), 성과보수 = carry × (회수 총액 − A), direct는 0
  for (const t of out.tranches) {
    if (forward) expect(t.exitGross, `${t.fundId} ${t.investYear} 회수 총액`).toBeGreaterThanOrEqual(t.amount * t.moic - tol);
    else near(t.exitGross, t.amount * t.moic, tol, `${t.fundId} ${t.investYear} 회수 총액`);
    const carry = funds.get(t.fundId)?.type === 'direct' ? 0 : input.portfolio.fees.carry * (t.exitGross - t.amount);
    near(t.carry, carry, tol, `${t.fundId} 성과보수`);
    near(t.exitNet, t.exitGross - t.carry, tol, `${t.fundId} 순회수`);
    expect(t.exitTime, `${t.fundId} 회수 시각 > 투자 시각`).toBeGreaterThan(t.investYear);
  }

  // 최종 연도 NAV = 0, 최종 누적 Distribution = Σ 순회수
  expect(last?.nav, '최종 NAV').toBe(0);
  near(last?.cumDist, out.tranches.reduce((s, t) => s + t.exitNet, 0), tol, '최종 누적 Distribution');

  // 연도별 집계 = 해당 연도 이벤트 합
  const byYear = new Map<number, { call: number; fee: number; dist: number }>();
  for (const e of out.events) {
    const y = yearOf(e.time);
    const b = byYear.get(y) ?? { call: 0, fee: 0, dist: 0 };
    b[e.type] += e.amount;
    byYear.set(y, b);
  }
  for (const p of total) {
    const b = byYear.get(p.year) ?? { call: 0, fee: 0, dist: 0 };
    near(p.callInvest, b.call, tol, `${p.year} 투자 Call`);
    near(p.callFee, b.fee, tol, `${p.year} 관리보수`);
    near(p.dist, b.dist, tol, `${p.year} Distribution`);
  }
  // 모든 이벤트가 시계열 범위 안
  for (const y of byYear.keys()) expect(y >= out.meta.calcStart && y <= out.meta.endYear, `이벤트 연도 ${y} 범위`).toBe(true);

  // 자산군 합 = 전체, 펀드 합 = 전체 (모든 연도, 모든 필드)
  total.forEach((p, i) => {
    for (const k of FIELDS) {
      near(ASSET_CLASSES.reduce((s, c) => s + (out.series.byClass[c][i]?.[k] ?? Number.NaN), 0), p[k], tol, `${p.year} ${k} 자산군 합`);
      near(Object.values(out.series.byFund).reduce((s, fs) => s + (fs[i]?.[k] ?? Number.NaN), 0), p[k], tol, `${p.year} ${k} 펀드 합`);
    }
  });

  // 모든 수치 ≥ 0
  for (const p of [...total, ...Object.values(out.series.byFund).flat()]) for (const k of FIELDS) expect(p[k], `${p.year} ${k} ≥ 0`).toBeGreaterThanOrEqual(0);
  for (const e of out.events) expect(e.amount).toBeGreaterThanOrEqual(0);

  // 계단형 누적선 최종값 = 연도별 최종 누적값
  const lastStep = out.steps.total[out.steps.total.length - 1];
  near(lastStep?.cumCall, last?.cumCall, tol, '계단 최종 Call');
  near(lastStep?.cumDist, last?.cumDist, tol, '계단 최종 Distribution');
}

/** 11.2 실무 모드: 기준일 이전 이벤트·연말 NAV·기준일 KPI = 기본 가정 결과 */
export function checkForwardFixedPast(input: SimInput, out: SimOutput): void {
  const tol = tolFor(input);
  const base = simulate({ ...input, scenario: ZERO_SCENARIO, options: { ...input.options, sensitivityMode: 'full' } });
  const tau = out.meta.asOfTime;
  const key = (e: SimOutput['events'][number]) => `${e.fundId}|${e.type}|${e.time.toFixed(9)}|${e.amount.toFixed(6)}`;
  const before = (o: SimOutput) => o.events.filter((e) => e.time < tau).map(key).sort();
  expect(before(out), '기준일 이전 이벤트').toEqual(before(base));
  const baseNav = new Map(base.series.total.map((p) => [p.year as number, p.nav]));
  for (const p of out.series.total) if (p.year + 1 <= tau) near(p.nav, baseNav.get(p.year) ?? 0, tol, `${p.year} 연말 NAV`);
  for (const k of ['cumCall', 'cumDist', 'nav'] as const) near(out.kpi.total[k], base.kpi.total[k], tol, `기준일 KPI ${k}`);
  out.tranches.forEach((t, i) => expect(t.locked, `${t.fundId} ${t.investYear} 고정 여부`).toBe((base.tranches[i]?.exitTime ?? Number.NaN) <= tau));
}
