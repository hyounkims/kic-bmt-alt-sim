// 관리보수 (DESIGN.md 7.4, 3.4 v0.9). 펀드 단위, 약정액 기준, 1월 1일(Q1) 발생, 약정 안에서 충당

import type { CashEvent, Fees, Fund } from './types';
import { asYear, qOfYearStart, startOf, type Year } from './time';

export interface FeeItem {
  readonly year: Year;
  readonly amount: number;
}

/**
 * 보수 일정: V ≤ y ≤ 마지막 회수 연도, 요율은 y < V + n이면 mgmtInvest, 이후 mgmtPost.
 * 회수 분기는 집행 금액과 무관하므로 금액보다 먼저 계산할 수 있다 (7.4). direct는 없음
 */
export function feeSchedule(fund: Fund, investPeriod: number, lastExitYear: number, fees: Fees): FeeItem[] {
  if (fund.type === 'direct') return [];
  const items: FeeItem[] = [];
  for (let y: number = fund.vintage; y <= lastExitYear; y++) {
    const rate = y < fund.vintage + investPeriod ? fees.mgmtInvest : fees.mgmtPost;
    items.push({ year: asYear(y), amount: fund.commitment * rate });
  }
  return items;
}

export function feeEvents(fund: Fund, schedule: readonly FeeItem[]): CashEvent[] {
  return schedule.map((f) => ({ time: startOf(f.year), year: f.year, quarter: qOfYearStart(f.year), type: 'fee', fundId: fund.id, amount: f.amount }));
}
