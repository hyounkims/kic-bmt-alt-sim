// 관리보수 (DESIGN.md 7.4, 3.4 v0.10). 펀드 단위, 약정액 기준.
// 집행기간 보수는 매년 1월 1일(Q1) Call에서 충당, 집행기간 이후 보수는 기간 비례로 쌓아 회수금에서 차감한다.

import type { CashEvent, Fees, Fund } from './types';
import { asYear, qOfYearStart, startOf, type Year } from './time';

export interface FeeItem {
  readonly year: Year;
  readonly amount: number;
}

/** 집행기간 보수 일정: V ≤ y < V + n, 매년 C × mgmtInvest (direct는 없음) */
export function investFeeSchedule(fund: Fund, investPeriod: number, fees: Fees): FeeItem[] {
  if (fund.type === 'direct') return [];
  return Array.from({ length: investPeriod }, (_, k) => ({ year: asYear(fund.vintage + k), amount: fund.commitment * fees.mgmtInvest }));
}

export function feeEvents(fund: Fund, schedule: readonly FeeItem[]): CashEvent[] {
  return schedule.map((f) => ({ time: startOf(f.year), year: f.year, quarter: qOfYearStart(f.year), type: 'fee', fundId: fund.id, amount: f.amount }));
}

/** 집행기간 이후 보수 조건: 시작 P₀ = V + n, 끝 P₁ = 마지막 회수 분기 말, 연 금액 C × mgmtPost */
export interface PostFeeTerms {
  readonly start: number;
  readonly end: number;
  readonly perYear: number;
}

export function postFeeTerms(fund: Fund, investPeriod: number, lastExitQuarterEnd: number, fees: Fees): PostFeeTerms {
  const start = fund.vintage + investPeriod;
  return { start, end: Math.max(start, lastExitQuarterEnd), perYear: fund.type === 'direct' ? 0 : fund.commitment * fees.mgmtPost };
}

/** 시각 τ까지 쌓인 집행기간 이후 보수: perYear × clamp(τ − P₀, 0, P₁ − P₀) */
export function accruedPostFee(terms: PostFeeTerms, time: number): number {
  return terms.perYear * Math.min(Math.max(time - terms.start, 0), terms.end - terms.start);
}
