// 관리보수 (DESIGN.md 7.4, 3.4). 펀드 단위, 약정액 기준, 1월 1일 발생

import type { CashEvent, Fees, Fund, Tranche } from './types';
import { effectivePeriod } from './tranches';
import { asYear, startOf } from './time';

/**
 * 기간: V ≤ y ≤ max(E) (해당 펀드 마지막 집행분 회수 연도)
 * 요율: y < V + n 이면 mgmtInvest, 이후 mgmtPost
 * direct는 관리보수 없음
 */
export function feeEvents(fund: Fund, tranches: readonly Tranche[], fees: Fees): CashEvent[] {
  if (fund.type === 'direct' || tranches.length === 0) return [];
  const n = effectivePeriod(fund);
  const lastExitYear = Math.max(...tranches.map((t) => t.exitYear));
  const events: CashEvent[] = [];
  for (let y: number = fund.vintage; y <= lastExitYear; y++) {
    const rate = y < fund.vintage + n ? fees.mgmtInvest : fees.mgmtPost;
    events.push({ time: startOf(asYear(y)), type: 'fee', fundId: fund.id, amount: fund.commitment * rate });
  }
  return events;
}
