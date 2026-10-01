// DESIGN.md 11.2 불변 조건 검사 함수. mock 결정론 테스트와 fast-check 무작위 테스트가 공유한다.
import { expect } from 'vitest';
import { qOfYearStart, qYear, quarterOfReach } from '../src/engine/time';
import { ASSET_CLASSES, type SimInput, type SimOutput } from '../src/engine/types';

export const FIELDS = ['callInvest', 'callFee', 'dist', 'nav', 'cumCall', 'cumDist'] as const;

/** 규모에 비례하는 허용 오차 (금액 최대 수만 $mn) */
export function tolFor(input: SimInput): number {
  const scale = input.portfolio.funds.reduce((s, f) => s + f.commitment, 0);
  return 1e-9 * Math.max(1, scale * 10);
}

const near = (a: number | undefined, b: number | undefined, tol: number, label: string) =>
  expect(Math.abs((a ?? Number.NaN) - (b ?? Number.NaN)), `${label}: ${a} vs ${b}`).toBeLessThanOrEqual(tol);

/** 11.2 공통 불변 조건 (v0.9) */
export function checkInvariants(input: SimInput, out: SimOutput): void {
  const tol = tolFor(input);
  expect(out.errors).toEqual([]);
  const total = out.series.total;
  const last = total[total.length - 1];
  const funds = new Map(input.portfolio.funds.map((f) => [f.id, f]));

  // v0.9 3.4: 누적 Call(투자 + 보수) 총합 = 약정 합계, 투자 합 = 약정 − 보수
  const commitments = input.portfolio.funds.reduce((s, f) => s + f.commitment, 0);
  const investSum = total.reduce((s, p) => s + p.callInvest, 0);
  const feeSum = total.reduce((s, p) => s + p.callFee, 0);
  near(investSum + feeSum, commitments, tol, 'Call(투자 + 보수) 합 = 약정');
  near(last?.cumCall, commitments, tol, '최종 누적 Call = 약정');
  // 펀드별로도 Call 합 = 약정
  for (const f of input.portfolio.funds) {
    const s = out.series.byFund[f.id] ?? [];
    near(s.at(-1)?.cumCall, f.commitment, tol, `${f.id} Call 합 = 약정`);
  }

  // 회수 총액 = A × M′, 성과보수 = carry × (회수 총액 − A), direct는 0
  for (const t of out.tranches) {
    near(t.exitGross, t.amount * t.moic, tol, `${t.fundId} ${t.investYear} 회수 총액`);
    const carry = funds.get(t.fundId)?.type === 'direct' ? 0 : input.portfolio.fees.carry * (t.exitGross - t.amount);
    near(t.carry, carry, tol, `${t.fundId} 성과보수`);
    near(t.exitNet, t.exitGross - t.carry, tol, `${t.fundId} 순회수`);
    expect(t.exitTime, `${t.fundId} 회수 시각 > 투자 시각`).toBeGreaterThan(t.investYear);
    // v0.9 7.3: 회수는 도달 시각이 속한 분기의 분기말
    expect(t.exitQuarter, `${t.fundId} 회수 분기`).toBe(quarterOfReach(t.reachTime));
    expect(Number.isInteger(t.exitTime * 4), `${t.fundId} 분기말 인식`).toBe(true);
    expect(t.exitTime).toBeGreaterThanOrEqual(t.reachTime - 1e-9);
    expect(t.exitYear).toBe(qYear(t.exitQuarter));
    expect(t.amount, `${t.fundId} 집행 금액 > 0`).toBeGreaterThan(0);
  }

  // 최종 연도 NAV = 0, 최종 누적 Distribution = Σ 순회수
  expect(last?.nav, '최종 NAV').toBe(0);
  near(last?.cumDist, out.tranches.reduce((s, t) => s + t.exitNet, 0), tol, '최종 누적 Distribution');

  // 연도별 집계 = 해당 연도 이벤트 합
  const byYear = new Map<number, { call: number; fee: number; dist: number }>();
  for (const e of out.events) {
    const y = e.year;
    // 이벤트 분기·연도 일관성: call·fee는 그해 Q1
    if (e.type !== 'dist') expect(e.quarter).toBe(qOfYearStart(e.year));
    expect(qYear(e.quarter)).toBe(e.year);
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

