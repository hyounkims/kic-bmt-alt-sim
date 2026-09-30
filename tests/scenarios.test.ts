import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../src/engine/constants';
import { runScenarios, SCENARIO_PRESETS, stepAvailability } from '../src/engine/scenarios';
import { ASSET_CLASSES } from '../src/engine/types';
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
