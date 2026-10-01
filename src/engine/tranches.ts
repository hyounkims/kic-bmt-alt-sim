// 집행분 생성·가정 조정·집행분 계산 (DESIGN.md 7.1~7.4, v0.9 분기 인식, v0.10 관리보수 B안)

import { accruedPostFee, investFeeSchedule, postFeeTerms, type FeeItem, type PostFeeTerms } from './fees';
import type { Fees, Fund, NavBasis, Options, Scenario, Tranche } from './types';
import { asYear, asYearTime, qEndTime, qOfYearStart, qYear, quarterOfReach, startOf, type QIndex, type Year, reachDateOf } from './time';

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
  /** 집행기간 보수 Call 일정 (7.4) */
  readonly feeSchedule: FeeItem[];
  /** 집행기간 이후 보수 조건 (7.4 v0.10) */
  readonly postFee: PostFeeTerms;
  /** 회수금에서 다 빼지 못한 보수 (검증용, 정상 입력은 0) */
  readonly unpaidPostFee: number;
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
  return { n, tStar, rows };
}


/**
 * 7.1 + 7.3 + 7.4 (v0.10 B안): 매년 Call C/n 중 집행기간 보수를 빼고 투자 A = C/n − C × mgmtInvest.
 * 회수는 도달 시각 T가 속한 분기의 분기말에 인식(보고), 현금흐름은 T에 A × M′ (가정 4, v0.9.2).
 * 집행기간 이후 보수는 기간 비례로 쌓이고, 회수할 때마다 그 회수 분기 말까지의 미지급분을 회수금에서 뺀다
 */
export function buildTranches(fund: Fund, a: Assumptions, fees: Fees): FundBuild {
  const t = timings(fund, a);
  const schedule = investFeeSchedule(fund, t.n, fees);
  const amount = fund.commitment / t.n - (schedule[0]?.amount ?? 0);
  const exitGross = amount * a.moic;
  const carry = fund.type === 'direct' ? 0 : fees.carry * (exitGross - amount);
  const lastExitQuarter = Math.max(...t.rows.map((r) => r.exitQuarter)) as QIndex;
  const postFee = postFeeTerms(fund, t.n, qEndTime(lastExitQuarter), fees);
  // 도달 시각 순으로 미지급분을 차감 (모자라면 다음 회수로 이월)
  let paid = 0;
  const netted = t.rows.map((r) => {
    const due = Math.max(0, accruedPostFee(postFee, qEndTime(r.exitQuarter)) - paid);
    const take = Math.min(due, exitGross - carry);
    paid += take;
    return take;
  });
  const tranches = t.rows.map(
    (r, i): Tranche => ({
      fundId: fund.id,
      investYear: r.investYear,
      amount,
      irr: a.irr,
      moic: a.moic,
      tStar: t.tStar,
      reachTime: r.reachTime,
      exitQuarter: r.exitQuarter,
      reachDate: reachDateOf(r.reachTime, r.exitQuarter),
      exitTime: qEndTime(r.exitQuarter),
      exitYear: qYear(r.exitQuarter),
      exitGross,
      carry,
      feeNetted: netted[i] ?? 0,
      exitNet: exitGross - carry - (netted[i] ?? 0),
    }),
  );
  return { tranches, feeSchedule: schedule, postFee, unpaidPostFee: Math.max(0, accruedPostFee(postFee, postFee.end) - paid) };
}

/** 7.4 분기말 q의 미지급 보수 = 그때까지 쌓인 보수 − 회수 분기 ≤ q인 집행분의 차감 합 (Net NAV에서 차감) */
export function unpaidPostFeeAt(postFee: PostFeeTerms, tranches: readonly Tranche[], q: QIndex): number {
  const paid = tranches.filter((t) => t.exitQuarter <= q).reduce((s, t) => s + t.feeNetted, 0);
  return Math.max(0, accruedPostFee(postFee, qEndTime(q)) - paid);
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
