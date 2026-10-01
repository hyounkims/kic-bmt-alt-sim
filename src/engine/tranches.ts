// 집행분 생성·가정 조정·집행분 계산 (DESIGN.md 7.1~7.4, v0.9 분기 인식·약정 내 보수)

import { feeSchedule, type FeeItem } from './fees';
import type { Fees, Fund, NavBasis, Options, Scenario, Tranche } from './types';
import { asYear, asYearTime, qEndTime, qOfYearStart, qYear, quarterOfReach, startOf, type QIndex, type Year } from './time';

export interface Assumptions {
  readonly irr: number;
  readonly moic: number;
}

/** 7.2 가정 조정. applyToDirect가 false면 direct는 원 가정 유지 */
export function adjustAssumptions(fund: Fund, scenario: Scenario, options: Options): Assumptions {
  if (fund.type === 'direct' && !options.applyToDirect) {
    return { irr: fund.gIRR, moic: fund.gMOIC };
  }
  const dr = scenario.irrShift[fund.assetClass];
  const dm = scenario.moicShift[fund.assetClass];
  const irr = options.irrShiftMode === 'pp' ? fund.gIRR + dr : fund.gIRR * (1 + dr);
  const moic = options.moicShiftMode === 'relative' ? fund.gMOIC * (1 + dm) : fund.gMOIC + dm;
  return { irr, moic };
}

/** t* = ln(M′) / ln(1 + r′) : MoIC 도달 기간(년) */
export function timeToMoic(irr: number, moic: number): number {
  return Math.log(moic) / Math.log1p(irr);
}

/** 7.1 집행기간. direct는 1 (원문 가정 6) */
export function effectivePeriod(fund: Fund): number {
  return fund.type === 'direct' ? 1 : fund.investPeriod;
}

export interface FundBuild {
  readonly tranches: Tranche[];
  /** 보수 일정 (7.4) — 총보수 F = 합계 */
  readonly feeSchedule: FeeItem[];
}

/** 집행 연도별 도달 시각·회수 분기 (금액과 무관) */
function timings(fund: Fund, a: Assumptions) {
  const n = effectivePeriod(fund);
  const tStar = timeToMoic(a.irr, a.moic);
  const rows = Array.from({ length: n }, (_, k) => {
    const investYear = asYear(fund.vintage + k);
    const reachTime = asYearTime(startOf(investYear) + tStar);
    const exitQuarter = quarterOfReach(reachTime);
    return { investYear, reachTime, exitQuarter };
  });
  return { n, tStar, rows, lastExitYear: Math.max(...rows.map((r) => qYear(r.exitQuarter))) };
}

/** 펀드 총보수 F (7.4). 검증(F < 약정)과 집행 금액 계산에 사용 */
export function fundFeeTotal(fund: Fund, a: Assumptions, fees: Fees): number {
  const t = timings(fund, a);
  return feeSchedule(fund, t.n, t.lastExitYear, fees).reduce((s, f) => s + f.amount, 0);
}

/**
 * 7.1 + 7.3 + 7.4 (v0.9): 회수 분기 → 보수 일정·총보수 F → 집행 금액 A = (약정 − F) / n.
 * 회수는 도달 시각 T가 속한 분기의 분기말에 인식, 금액은 A × M′ (가정 4)
 */
export function buildTranches(fund: Fund, a: Assumptions, fees: Fees): FundBuild {
  const t = timings(fund, a);
  const schedule = feeSchedule(fund, t.n, t.lastExitYear, fees);
  const totalFee = schedule.reduce((s, f) => s + f.amount, 0);
  const amount = (fund.commitment - totalFee) / t.n;
  const exitGross = amount * a.moic;
  const carry = fund.type === 'direct' ? 0 : fees.carry * (exitGross - amount);
  const tranches = t.rows.map(
    (r): Tranche => ({
      fundId: fund.id,
      investYear: r.investYear,
      amount,
      irr: a.irr,
      moic: a.moic,
      tStar: t.tStar,
      reachTime: r.reachTime,
      exitQuarter: r.exitQuarter,
      exitTime: qEndTime(r.exitQuarter),
      exitYear: qYear(r.exitQuarter),
      exitGross,
      carry,
      exitNet: exitGross - carry,
    }),
  );
  return { tranches, feeSchedule: schedule };
}

/** 가치 공식: A × (1 + r′)^(τ − Y) */
function pathValue(t: Tranche, time: number): number {
  return t.amount * Math.pow(1 + t.irr, time - t.investYear);
}

/** 7.3 분기말 q의 평가가치: 투자 분기 ≤ q < 회수 분기에서 A × (1 + r′)^(분기말 − Y), 그 밖은 0 */
export function trancheValueAtQuarter(t: Tranche, q: QIndex): number {
  if (q < qOfYearStart(t.investYear) || q >= t.exitQuarter) return 0;
  return pathValue(t, qEndTime(q));
}

/** 7.3 연말 NAV(y) = Q4 말 가치: Y ≤ y < 회수 연도(회수 분기가 y년 Q4 이하면 0) */
export function trancheYearEndNav(t: Tranche, year: Year): number {
  if (year < t.investYear || year >= t.exitYear) return 0;
  return pathValue(t, year + 1);
}

/**
 * 3.5 NAV 기준 적용. gross는 평가가치 그대로,
 * net은 미실현 이익 × 성과보수율을 차감 (직접투자 제외)
 */
export function applyNavBasis(value: number, t: Tranche, isDirect: boolean, fees: Fees, basis: NavBasis): number {
  if (basis === 'gross' || isDirect || value <= 0) return value;
  return value - fees.carry * Math.max(0, value - t.amount);
}
