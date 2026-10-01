import { describe, expect, it } from 'vitest';
import { netIrr, npv } from '../src/engine/performance';

// DESIGN.md 7.8 Net IRR 풀이
describe('netIrr', () => {
  it('−100 → 2년 뒤 +121 이면 10%', () => {
    expect(Math.abs((netIrr([{ time: 0, amount: -100 }, { time: 2, amount: 121 }]) ?? Number.NaN) - 0.1)).toBeLessThan(1e-9);
  });
  it('분기말 시각(소수 연도)도 처리: −400 → 3.5년 뒤 +1,000 = 2.5^(1/3.5) − 1', () => {
    const r = netIrr([{ time: 2024, amount: -400 }, { time: 2027.5, amount: 1000 }]);
    expect(Math.abs((r ?? Number.NaN) - (Math.pow(2.5, 1 / 3.5) - 1))).toBeLessThan(1e-9);
  });
  it('여러 유출·유입에서 NPV(IRR) = 0', () => {
    const flows = [{ time: 0, amount: -50 }, { time: 1, amount: -50 }, { time: 1.25, amount: 30 }, { time: 4, amount: 120 }];
    const r = netIrr(flows);
    expect(r).not.toBeNull();
    expect(Math.abs(npv(flows, r ?? 0))).toBeLessThan(1e-8);
  });
  it('유입이나 유출만 있으면 null', () => {
    expect(netIrr([{ time: 0, amount: -1 }])).toBeNull();
    expect(netIrr([{ time: 0, amount: 1 }])).toBeNull();
    expect(netIrr([])).toBeNull();
  });
  it('원금 손실(−100 → +80)이면 음수 IRR', () => {
    expect(netIrr([{ time: 0, amount: -100 }, { time: 1, amount: 80 }])).toBeCloseTo(-0.2, 9);
  });
});
