// 예상 최종 성과 (DESIGN.md 7.8 v0.9): 범위별 LP 순현금흐름의 Net IRR·Net MoIC

import type { FundCalc } from './aggregate';
import type { CashEvent, Performance } from './types';
import type { QIndex } from './time';

interface Flow {
  readonly time: number;
  readonly amount: number;
}

/** LP 순현금흐름: Call(투자·보수)은 음수, Distribution은 양수 */
export function lpFlows(events: readonly CashEvent[]): Flow[] {
  return events.map((e) => ({ time: e.time, amount: e.type === 'dist' ? e.amount : -e.amount }));
}

/** 순현재가치: Σ CFᵢ × (1 + r)^−(tᵢ − t₀) */
export function npv(flows: readonly Flow[], rate: number): number {
  if (flows.length === 0) return 0;
  const t0 = Math.min(...flows.map((f) => f.time));
  return flows.reduce((s, f) => s + f.amount / Math.pow(1 + rate, f.time - t0), 0);
}

/**
 * Net IRR: NPV(r) = 0의 해 (이분법). 유입·유출이 모두 있어야 하며,
 * 구간 (−99%, 1,000%)에서 부호가 바뀌지 않으면 null
 */
export function netIrr(flows: readonly Flow[]): number | null {
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(flows, lo);
  const fHi = npv(flows, hi);
  if (fLo === 0) return lo;
  if (Math.sign(fLo) === Math.sign(fHi)) return null;
  for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(flows, mid);
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/** 7.8 범위(펀드 묶음)의 예상 최종 성과 */
export function performanceOf(fcs: readonly FundCalc[]): Performance {
  const events = fcs.flatMap((fc) => fc.events);
  const totalCall = events.filter((e) => e.type !== 'dist').reduce((s, e) => s + e.amount, 0);
  const totalDist = events.filter((e) => e.type === 'dist').reduce((s, e) => s + e.amount, 0);
  const exits = fcs.flatMap((fc) => fc.tranches.map((t) => t.exitQuarter));
  return {
    netIrr: netIrr(lpFlows(events)),
    netMoic: totalCall > 0 ? totalDist / totalCall : 0,
    totalCall,
    totalDist,
    lastExitQuarter: exits.length > 0 ? (Math.max(...exits) as QIndex) : null,
  };
}
