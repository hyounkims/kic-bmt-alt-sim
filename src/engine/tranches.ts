// 집행분 생성·가정 조정·집행분 계산 (DESIGN.md 7.1~7.3, 전 구간 모드)

import type { Fees, Fund, NavBasis, Options, Scenario, Tranche } from './types';
import { asYear, asYearTime, startOf, type Year, type YearTime } from './time';

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

/** 집행분 하나를 만든다. 가치 경로 기본값은 투자 시각에서 시작하는 단일 성장 (전 구간 모드) */
function makeTranche(
  fund: Fund,
  fees: Fees,
  investYear: Year,
  amount: number,
  a: Assumptions,
  exitTime: YearTime,
  exitGross: number,
): Tranche {
  const carry = fund.type === 'direct' ? 0 : fees.carry * (exitGross - amount);
  return {
    fundId: fund.id,
    investYear,
    amount,
    irr: a.irr,
    moic: a.moic,
    tStar: exitTime - investYear,
    exitTime,
    exitYear: Math.floor(exitTime) as Year,
    exitGross,
    carry,
    exitNet: exitGross - carry,
  };
}

/** 7.1 + 7.3 펀드의 집행분 목록 (전 구간 모드) */
export function buildTranches(fund: Fund, a: Assumptions, fees: Fees): Tranche[] {
  const n = effectivePeriod(fund);
  const amount = fund.commitment / n;
  const tStar = timeToMoic(a.irr, a.moic);
  const tranches: Tranche[] = [];
  for (let k = 0; k < n; k++) {
    const investYear = asYear(fund.vintage + k);
    const start = startOf(investYear);
    const exitTime = asYearTime(start + tStar);
    tranches.push(makeTranche(fund, fees, investYear, amount, a, exitTime, amount * a.moic));
  }
  return tranches;
}

/** 가치 공식 (회수 여부와 무관): A × (1 + r′)^(τ − Y) */
function pathValue(t: Tranche, time: number): number {
  return t.amount * Math.pow(1 + t.irr, time - t.investYear);
}

/** 7.3 시각 τ의 평가가치: Y ≤ τ < T에서 가치 경로, 그 밖은 0 */
export function trancheValueAt(t: Tranche, time: YearTime): number {
  if (time < t.investYear || time >= t.exitTime) return 0;
  return pathValue(t, time);
}

/** 7.3 연말 NAV(y): Y ≤ y < E에서 연말 시각(y + 1)의 가치 경로, 그 밖은 0 */
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
