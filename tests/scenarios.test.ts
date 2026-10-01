import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../src/engine/constants';
import { runScenarios, SCENARIO_PRESETS, stepAvailability, summarizeScenarios } from '../src/engine/scenarios';
import { ASSET_CLASSES } from '../src/engine/types';
import { qIndexOf } from '../src/engine/time';
import { baseInput, mockPortfolio } from './fixtures';

// DESIGN.md 8장 시나리오 실행, 3.3-7 조정 단위, 3.3-C 하한
describe('runScenarios (8장)', () => {
  const { runs, maxEndYear } = runScenarios(baseInput());

  it('5개 시나리오: 기본 / IRR ∓3%p / MoIC ∓20%', () => {
    expect(runs.map((r) => r.preset.key)).toEqual(['base', 'irrDown', 'irrUp', 'moicDown', 'moicUp']);
    runs.forEach((r) => expect(r.output.errors).toEqual([]));
  });

  it('기본 endYear 2032, 비교 x축 끝 = 최대 endYear 2033 (11.1)', () => {
    expect(runs[0]?.output.meta.endYear).toBe(2032);
    expect(maxEndYear).toBe(2033);
  });

  it('프리셋은 전 자산군 동시 적용 (3.3-A)', () => {
    const irrDown = runs.find((r) => r.preset.key === 'irrDown')?.output;
    for (const f of irrDown?.funds ?? []) expect(f.irr).toBeCloseTo(f.gIRR - 0.03, 12);
  });

  it('프리셋 정의는 8장 표와 일치', () => {
    expect(SCENARIO_PRESETS.map((p) => [p.irrShift, p.moicShift])).toEqual([[0, 0], [-0.03, 0], [0.03, 0], [0, -0.2], [0, 0.2]]);
  });
});

describe('stepAvailability (3.3-C)', () => {
  const p = mockPortfolio();
  const blocked = (opts = DEFAULT_OPTIONS, kind: 'irr' | 'moic' = 'moic') =>
    Object.fromEntries(ASSET_CLASSES.map((c) => [c, stepAvailability(p, opts, c, kind).filter((s) => !s.allowed).map((s) => s.shift)]));

  it('기본 해석: IRR 단계는 전부 사용 가능', () => {
    expect(blocked(DEFAULT_OPTIONS, 'irr')).toEqual({ PE: [], RE: [], Infra: [], PD: [] });
  });

  it('기본 해석: MoIC −40%는 RE(0.96x)·PD(0.84x)만 비활성, 사유 표시', () => {
    expect(blocked()).toEqual({ PE: [], RE: [-0.4], Infra: [], PD: [-0.4] });
    const re = stepAvailability(p, DEFAULT_OPTIONS, 'RE', 'moic').find((s) => s.shift === -0.4);
    expect(re?.reason).toContain('CCC V: 조정 후 MoIC 0.96x ≤ 1.0x');
  });

  it('MoIC 절대 가감 해석: PD −0.40x(1.00x)만 비활성', () => {
    expect(blocked({ ...DEFAULT_OPTIONS, moicShiftMode: 'absolute' })).toEqual({ PE: [], RE: [], Infra: [], PD: [-0.4] });
  });

  it('IRR 상대 변동 해석: 전부 사용 가능', () => {
    expect(blocked({ ...DEFAULT_OPTIONS, irrShiftMode: 'relative' }, 'irr')).toEqual({ PE: [], RE: [], Infra: [], PD: [] });
  });
});

// 8장 시나리오 요약·기본 대비 차이 (v0.9 분기). 기대값은 12장 t*와 손 계산에서 유도
describe('summarizeScenarios (8장)', () => {
  const runs = runScenarios(baseInput());
  const near = (a: number | undefined, b: number, tol = 0.01) => expect(Math.abs((a ?? Number.NaN) - b)).toBeLessThanOrEqual(tol);

  // 기본 마지막 회수 = BBB IX 2028 + 4.19 → 2032 Q1. IRR −3%p에서는 FFF VII 2028 + 4.97(PD) → 2032 Q4
  it('전체: 기본 행은 차이 없음, IRR −3%p 마지막 회수 +3분기, MoIC +20% 종료 연도 +1', () => {
    const rows = summarizeScenarios(runs, { kind: 'total' });
    expect(rows.map((r) => r.preset.key)).toEqual(['base', 'irrDown', 'irrUp', 'moicDown', 'moicUp']);
    expect(rows[0]?.vsBase).toBeNull();
    expect(rows[0]?.lastExitQuarter).toBe(qIndexOf(2032, 1));
    expect(rows[1]?.vsBase?.lastExitQuarters).toBe(3);
    expect(rows[1]?.vsBase?.endYear).toBe(0);
    expect(rows[4]?.vsBase?.endYear).toBe(1);
    near(rows[0]?.finalCumCall, 3000, 1e-6);
  });

  it('AAA VII: IRR +3%p 마지막 회수 2026 Q3 (−2분기), MoIC −20% 최종 Distribution 399.6 (−75.6)', () => {
    const rows = summarizeScenarios(runs, { kind: 'fund', id: 'AAA_VII' });
    expect(rows[0]?.lastExitQuarter).toBe(qIndexOf(2027, 1));
    expect(rows[2]?.lastExitQuarter).toBe(qIndexOf(2026, 3));
    expect(rows[2]?.vsBase?.lastExitQuarters).toBe(-2);
    // MoIC −20%: t* 2.84 → 2025 Q4 마지막, 보수 24 + 6 = 30 → 집행분 67.5 → 순회수 99.9 × 4
    near(rows[3]?.finalCumDist, 399.6, 1e-6);
    near(rows[3]?.vsBase?.finalCumDist, -75.6, 1e-6);
    expect(rows[3]?.endYear).toBe(2025);
    near(rows[3]?.finalCumCall, 300, 1e-6);
  });

  it('차이 = 행 값 − 기본 행 값 (모든 범위)', () => {
    for (const scope of [{ kind: 'total' } as const, { kind: 'class', id: 'PD' } as const, { kind: 'fund', id: 'XXX' } as const]) {
      const rows = summarizeScenarios(runs, scope);
      const b = rows[0];
      for (const r of rows.slice(1)) {
        near(r.vsBase?.finalCumCall, r.finalCumCall - (b?.finalCumCall ?? 0), 1e-9);
        expect(r.vsBase?.lastExitQuarters).toBe(r.lastExitQuarter - (b?.lastExitQuarter ?? 0));
      }
    }
  });

  it('없는 펀드 범위는 오류 행', () => {
    const rows = summarizeScenarios(runs, { kind: 'fund', id: 'NOPE' });
    expect(rows.every((r) => r.errors.length > 0 && r.vsBase === null)).toBe(true);
  });
});
