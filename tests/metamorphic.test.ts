import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IRR_STEPS, MOIC_STEPS } from '../src/engine/constants';
import { stepAvailability } from '../src/engine/scenarios';
import { simulate } from '../src/engine/simulate';
import { asYear } from '../src/engine/time';
import { ASSET_CLASSES, type AssetClass, type SeriesPoint, type SimInput, type SimOutput } from '../src/engine/types';
import { arbFees, arbFunds, arbInput, arbOptions, arbPortfolio, arbRawScenario, clampToAllowed } from './arbitraries';
import { tolFor } from './invariantChecks';

// DESIGN.md 11.3 변환 관계 (fast-check 무작위 입력)

const PROPERTY_TIMEOUT = 60_000;
const FLOWS = ['callInvest', 'callFee', 'dist', 'nav'] as const;

const near = (a: number | undefined, b: number | undefined, tol: number, label: string) =>
  expect(Math.abs((a ?? Number.NaN) - (b ?? Number.NaN)), `${label}: ${a} vs ${b}`).toBeLessThanOrEqual(tol);

function byYear(series: readonly SeriesPoint[]): Map<number, SeriesPoint> {
  return new Map(series.map((p) => [p.year as number, p]));
}

/** 연도 y의 누적값: 시계열이 끝났으면 마지막 값 유지 */
function cumAt(series: readonly SeriesPoint[], y: number, key: 'cumCall' | 'cumDist'): number {
  let v = 0;
  for (const p of series) if (p.year <= y) v = p[key];
  return v;
}

function ok(out: SimOutput): SimOutput {
  expect(out.errors).toEqual([]);
  return out;
}

describe('11.3 변환 관계', () => {
  it('비례성: 약정 × k → Call·Distribution·NAV·보수 × k, 회수 시각 불변', () => {
    fc.assert(
      fc.property(arbInput(), fc.constantFrom(0.5, 2, 3.7), (input, k) => {
        const scaled: SimInput = { ...input, portfolio: { ...input.portfolio, funds: input.portfolio.funds.map((f) => ({ ...f, commitment: f.commitment * k })) } };
        const a = ok(simulate(input));
        const b = ok(simulate(scaled));
        const tol = tolFor(scaled);
        expect(b.meta.endYear).toBe(a.meta.endYear);
        a.tranches.forEach((t, i) => {
          near(b.tranches[i]?.exitTime, t.exitTime, 1e-9, '회수 시각');
          expect(b.tranches[i]?.exitYear).toBe(t.exitYear);
        });
        a.series.total.forEach((p, i) => {
          for (const f of [...FLOWS, 'cumCall', 'cumDist'] as const) near(b.series.total[i]?.[f], p[f] * k, tol, `${p.year} ${f}`);
        });
        for (const f of ['cumCall', 'cumDist', 'nav'] as const) near(b.kpi.total[f], a.kpi.total[f] * k, tol, `KPI ${f}`);
        for (const f of ['dpi', 'tvpi'] as const) near(b.kpi.total[f], a.kpi.total[f], 1e-9, `KPI ${f}`);
      }),
      { numRuns: 200 },
    );
  }, PROPERTY_TIMEOUT);

  it('합산성: simulate(A ∪ B) = simulate(A) + simulate(B)', () => {
    fc.assert(
      fc.property(arbFunds('A', 8), arbFunds('B', 8), arbFees, arbOptions(), arbRawScenario, (fa, fb, fees, options, raw) => {
        const union = { funds: [...fa, ...fb], fees };
        const scenario = clampToAllowed(union, options, raw);
        const u = ok(simulate({ portfolio: union, scenario, options }));
        const a = ok(simulate({ portfolio: { funds: fa, fees }, scenario, options }));
        const b = ok(simulate({ portfolio: { funds: fb, fees }, scenario, options }));
        const tol = tolFor({ portfolio: union, scenario, options });
        expect(u.meta.endYear).toBe(Math.max(a.meta.endYear, b.meta.endYear));
        const am = byYear(a.series.total);
        const bm = byYear(b.series.total);
        for (const p of u.series.total) {
          for (const f of FLOWS) near(p[f], (am.get(p.year)?.[f] ?? 0) + (bm.get(p.year)?.[f] ?? 0), tol, `${p.year} ${f}`);
          for (const f of ['cumCall', 'cumDist'] as const) near(p[f], cumAt(a.series.total, p.year, f) + cumAt(b.series.total, p.year, f), tol, `${p.year} ${f}`);
        }
        for (const f of ['cumCall', 'cumDist', 'nav'] as const) near(u.kpi.total[f], a.kpi.total[f] + b.kpi.total[f], tol, `KPI ${f}`);
        expect(u.events).toHaveLength(a.events.length + b.events.length);
      }),
      { numRuns: 200 },
    );
  }, PROPERTY_TIMEOUT);

  it('시간 이동: Vintage + 1 → 해당 펀드 이벤트 시각·원시 시계열 + 1 (구간 판정 제외, 전 구간 모드)', () => {
    fc.assert(
      fc.property(arbInput(['full']), fc.nat(), (input, pick) => {
        const funds = input.portfolio.funds;
        const j = pick % funds.length;
        const target = funds[j];
        if (!target) return;
        const moved: SimInput = {
          ...input,
          portfolio: { ...input.portfolio, funds: funds.map((f, i) => (i === j ? { ...f, vintage: asYear(f.vintage + 1) } : f)) },
        };
        const a = ok(simulate(input));
        const b = ok(simulate(moved));
        const tol = tolFor(input);
        // 해당 펀드 이벤트: 시각 + 1
        const ea = a.events.filter((e) => e.fundId === target.id);
        const eb = b.events.filter((e) => e.fundId === target.id);
        expect(eb).toHaveLength(ea.length);
        ea.forEach((e, i) => {
          near(eb[i]?.time, e.time + 1, 1e-9, `${e.type} 시각`);
          near(eb[i]?.amount, e.amount, tol, `${e.type} 금액`);
          expect(eb[i]?.type).toBe(e.type);
        });
        // 해당 펀드 시계열: 연도 y의 값 = 이동 후 y + 1의 값 (phase 제외)
        const sa = a.series.byFund[target.id] ?? [];
        const sb = byYear(b.series.byFund[target.id] ?? []);
        // 시계열 범위(calcStart ~ endYear) 밖 연도의 흐름은 정의상 0. 0이 아닌 흐름이 범위 밖으로 밀리면 실패
        for (const p of sa) {
          for (const f of FLOWS) {
            const moved = sb.get(p.year + 1);
            if (moved === undefined) expect(Math.abs(p[f]), `${p.year} ${f}가 이동 후 범위 밖`).toBeLessThanOrEqual(tol);
            else near(moved[f], p[f], tol, `${p.year} → ${p.year + 1} ${f}`);
          }
        }
        for (const f of FLOWS) near(sb.get(input.options.calcStart)?.[f], 0, tol, `calcStart ${f}`);
        // 다른 펀드는 그대로
        for (const f of funds) {
          if (f.id === target.id) continue;
          const oa = a.series.byFund[f.id] ?? [];
          const ob = byYear(b.series.byFund[f.id] ?? []);
          for (const p of oa) for (const k of FLOWS) near(ob.get(p.year)?.[k], p[k], tol, `${f.id} ${p.year} ${k}`);
        }
      }),
      { numRuns: 200 },
    );
  }, PROPERTY_TIMEOUT);

  // 방향성: 연도가 아니라 시각 기준, 엄격 부등호. 조정 대상 집행분만 (applyToDirect: false면 direct 제외)
  function affected(input: SimInput, cls: AssetClass): Set<string> {
    return new Set(input.portfolio.funds.filter((f) => f.assetClass === cls && (f.type === 'fund' || input.options.applyToDirect)).map((f) => f.id));
  }

  const arbDirection = fc.tuple(arbPortfolio, arbOptions(['full']), fc.constantFrom<AssetClass>(...ASSET_CLASSES), fc.nat(), fc.nat());

  it("방향성: r′↑ → 회수 시각 단축", () => {
    fc.assert(
      fc.property(arbDirection, ([portfolio, options, cls, i1, i2]) => {
        const allowed = stepAvailability(portfolio, options, cls, 'irr').filter((s) => s.allowed).map((s) => s.shift);
        const lo = allowed[i1 % allowed.length];
        const hi = allowed[i2 % allowed.length];
        if (lo === undefined || hi === undefined || lo >= hi) return;
        const zero = { irrShift: { PE: 0, RE: 0, Infra: 0, PD: 0 }, moicShift: { PE: 0, RE: 0, Infra: 0, PD: 0 } };
        const a = ok(simulate({ portfolio, options, scenario: { ...zero, irrShift: { ...zero.irrShift, [cls]: lo } } }));
        const b = ok(simulate({ portfolio, options, scenario: { ...zero, irrShift: { ...zero.irrShift, [cls]: hi } } }));
        const ids = affected({ portfolio, options, scenario: zero }, cls);
        a.tranches.forEach((t, i) => {
          if (ids.has(t.fundId)) expect(b.tranches[i]?.exitTime, `${t.fundId} ${t.investYear}`).toBeLessThan(t.exitTime);
          else expect(b.tranches[i]?.exitTime).toBe(t.exitTime);
        });
      }),
      { numRuns: 200 },
    );
  }, PROPERTY_TIMEOUT);

  it('방향성: M′↑ → 회수 시각 연장', () => {
    fc.assert(
      fc.property(arbDirection, ([portfolio, options, cls, i1, i2]) => {
        const allowed = stepAvailability(portfolio, options, cls, 'moic').filter((s) => s.allowed).map((s) => s.shift);
        const lo = allowed[i1 % allowed.length];
        const hi = allowed[i2 % allowed.length];
        if (lo === undefined || hi === undefined || lo >= hi) return;
        const zero = { irrShift: { PE: 0, RE: 0, Infra: 0, PD: 0 }, moicShift: { PE: 0, RE: 0, Infra: 0, PD: 0 } };
        const a = ok(simulate({ portfolio, options, scenario: { ...zero, moicShift: { ...zero.moicShift, [cls]: lo } } }));
        const b = ok(simulate({ portfolio, options, scenario: { ...zero, moicShift: { ...zero.moicShift, [cls]: hi } } }));
        const ids = affected({ portfolio, options, scenario: zero }, cls);
        a.tranches.forEach((t, i) => {
          if (ids.has(t.fundId)) expect(b.tranches[i]?.exitTime, `${t.fundId} ${t.investYear}`).toBeGreaterThan(t.exitTime);
          else expect(b.tranches[i]?.exitTime).toBe(t.exitTime);
        });
      }),
      { numRuns: 200 },
    );
  }, PROPERTY_TIMEOUT);

  it('조정 단계 상수는 3.3-7과 일치', () => {
    expect(IRR_STEPS).toEqual([-0.06, -0.03, 0, 0.03, 0.06]);
    expect(MOIC_STEPS).toEqual([-0.4, -0.2, 0, 0.2, 0.4]);
  });
});
