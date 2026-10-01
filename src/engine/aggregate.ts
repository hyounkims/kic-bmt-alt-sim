// 이벤트 생성·집계·구간 판정 (DESIGN.md 7.5~7.6, v0.9 분기 기준)

import type { CashEvent, Fees, Fund, KpiPoint, NavBasis, Phase, SeriesPoint, StepPoint, Tranche } from './types';
import { applyNavBasis, trancheValueAtQuarter, trancheYearEndNav } from './tranches';
import { qOfYearStart, startOf, type QIndex, type Year, type YearTime } from './time';

/** 펀드 하나의 계산 결과 */
export interface FundCalc {
  readonly fund: Fund;
  readonly tranches: readonly Tranche[];
  readonly events: readonly CashEvent[];
}

export interface AggregateContext {
  readonly calcStart: Year;
  readonly endYear: Year;
  readonly asOfTime: YearTime;
  /** 기준 분기 (7.6 v0.9) */
  readonly asOfQuarter: QIndex;
  readonly asOfYear: Year;
  readonly fees: Fees;
  readonly navBasis: NavBasis;
}

const EVENT_ORDER: Record<CashEvent['type'], number> = { call: 0, fee: 1, dist: 2 };

/** 시각 → 분기 → 유형(call, fee, dist) → 펀드 id 순 정렬. 같은 시각(Q4 말 = 다음 해 1/1)은 분기 순 */
export function sortEvents(events: readonly CashEvent[]): CashEvent[] {
  return [...events].sort(
    (a, b) => a.time - b.time || a.quarter - b.quarter || EVENT_ORDER[a.type] - EVENT_ORDER[b.type] || a.fundId.localeCompare(b.fundId),
  );
}

/** 7.5 집행(call)·회수(dist) 이벤트. call은 1월 1일(그해 Q1), dist는 실제 회수 시각 T·회수 분기 (v0.9.2) */
export function trancheEvents(tranches: readonly Tranche[]): CashEvent[] {
  return tranches.flatMap((t): CashEvent[] => [
    { time: startOf(t.investYear), year: t.investYear, quarter: qOfYearStart(t.investYear), type: 'call', fundId: t.fundId, amount: t.amount },
    { time: t.reachTime, year: t.exitYear, quarter: t.exitQuarter, type: 'dist', fundId: t.fundId, amount: t.exitNet },
  ]);
}

/** 7.6 연도 라벨: y < ⌊τ_asOf⌋ past, = current, > future */
export function phaseOf(year: Year, asOfYear: Year): Phase {
  if (year < asOfYear) return 'past';
  return year === asOfYear ? 'current' : 'future';
}

function yearsOf(ctx: AggregateContext): Year[] {
  const years: Year[] = [];
  for (let y = ctx.calcStart; y <= ctx.endYear; y++) years.push(y as Year);
  return years;
}

interface MutablePoint {
  callInvest: number;
  callFee: number;
  dist: number;
  nav: number;
}

function toSeries(ctx: AggregateContext, raw: readonly MutablePoint[]): SeriesPoint[] {
  let cumCall = 0;
  let cumDist = 0;
  return yearsOf(ctx).map((year, i) => {
    const p = raw[i] ?? { callInvest: 0, callFee: 0, dist: 0, nav: 0 };
    cumCall += p.callInvest + p.callFee;
    cumDist += p.dist;
    return { year, phase: phaseOf(year, ctx.asOfYear), ...p, cumCall, cumDist };
  });
}

/** 7.5 여러 펀드의 연도별 집계 (범위: calcStart ~ endYear, 누적은 calcStart부터) */
export function seriesOf(fcs: readonly FundCalc[], ctx: AggregateContext): SeriesPoint[] {
  const years = yearsOf(ctx);
  const raw: MutablePoint[] = years.map(() => ({ callInvest: 0, callFee: 0, dist: 0, nav: 0 }));
  for (const fc of fcs) {
    for (const e of fc.events) {
      const p = raw[e.year - ctx.calcStart];
      if (!p) continue;
      if (e.type === 'call') p.callInvest += e.amount;
      else if (e.type === 'fee') p.callFee += e.amount;
      else p.dist += e.amount;
    }
    const isDirect = fc.fund.type === 'direct';
    years.forEach((y, i) => {
      const p = raw[i];
      if (!p) return;
      for (const t of fc.tranches) {
        p.nav += applyNavBasis(trancheYearEndNav(t, y), t, isDirect, ctx.fees, ctx.navBasis);
      }
    });
  }
  return toSeries(ctx, raw);
}

/** 3.1-7 계단형 누적선: (시각, 분기)마다 그때까지 반영한 누적값. 첫 점은 calcStart의 0 */
export function stepsOf(fcs: readonly FundCalc[], ctx: AggregateContext): StepPoint[] {
  const events = sortEvents(fcs.flatMap((fc) => fc.events));
  const points: StepPoint[] = [{ time: startOf(ctx.calcStart), quarter: (qOfYearStart(ctx.calcStart) - 1) as QIndex, cumCall: 0, cumDist: 0 }];
  let cumCall = 0;
  let cumDist = 0;
  events.forEach((e, i) => {
    if (e.type === 'dist') cumDist += e.amount;
    else cumCall += e.amount;
    const next = events[i + 1];
    if (next === undefined || next.time !== e.time || next.quarter !== e.quarter) points.push({ time: e.time, quarter: e.quarter, cumCall, cumDist });
  });
  return points;
}

/** 9장 kpi (7.6 v0.9): 기준 분기까지의 이벤트 합(분기 ≤ 기준 분기)과 기준 분기말 평가가치 */
export function kpiOf(fcs: readonly FundCalc[], ctx: AggregateContext): KpiPoint {
  let cumCall = 0;
  let cumDist = 0;
  let nav = 0;
  for (const fc of fcs) {
    for (const e of fc.events) {
      if (e.quarter > ctx.asOfQuarter) continue;
      if (e.type === 'dist') cumDist += e.amount;
      else cumCall += e.amount;
    }
    const isDirect = fc.fund.type === 'direct';
    for (const t of fc.tranches) {
      nav += applyNavBasis(trancheValueAtQuarter(t, ctx.asOfQuarter), t, isDirect, ctx.fees, ctx.navBasis);
    }
  }
  return {
    cumCall,
    cumDist,
    nav,
    dpi: cumCall > 0 ? cumDist / cumCall : 0,
    tvpi: cumCall > 0 ? (cumDist + nav) / cumCall : 0,
  };
}
