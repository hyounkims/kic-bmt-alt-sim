// 시나리오 실행 (DESIGN.md 8장)과 조정 단계 사용 가능 여부 (3.3-7, 3.3-C)

import { byClassOf, IRR_STEPS, MOIC_STEPS } from './constants';
import { simulate } from './simulate';
import { adjustAssumptions } from './tranches';
import type { Year } from './time';
import type { AssetClass, Options, Portfolio, Scenario, SimInput, SimOutput } from './types';
import { checkAdjustedBounds } from './validate';

export type ScenarioKey = 'base' | 'irrDown' | 'irrUp' | 'moicDown' | 'moicUp';

export interface ScenarioPreset {
  readonly key: ScenarioKey;
  readonly label: string;
  /** 전 자산군 동시 적용 값 (3.3-A) */
  readonly irrShift: number;
  readonly moicShift: number;
}

/** 8장 인쇄용 5개 시나리오 */
export const SCENARIO_PRESETS: readonly ScenarioPreset[] = [
  { key: 'base', label: '기본', irrShift: 0, moicShift: 0 },
  { key: 'irrDown', label: 'IRR −3%p', irrShift: -0.03, moicShift: 0 },
  { key: 'irrUp', label: 'IRR +3%p', irrShift: 0.03, moicShift: 0 },
  { key: 'moicDown', label: 'MoIC −20%', irrShift: 0, moicShift: -0.2 },
  { key: 'moicUp', label: 'MoIC +20%', irrShift: 0, moicShift: 0.2 },
];

export function presetScenario(p: ScenarioPreset): Scenario {
  return { irrShift: byClassOf(p.irrShift), moicShift: byClassOf(p.moicShift) };
}

export interface ScenarioRun {
  readonly preset: ScenarioPreset;
  readonly output: SimOutput;
}

export interface ScenarioRuns {
  readonly runs: readonly ScenarioRun[];
  /** 비교 차트 x축 끝: 오류 없는 시나리오의 endYear 최댓값 (8장) */
  readonly maxEndYear: Year;
}

/** 8장 runScenarios: 같은 포트폴리오·옵션에 프리셋 시나리오를 각각 적용 */
export function runScenarios(input: SimInput, variants: readonly ScenarioPreset[] = SCENARIO_PRESETS): ScenarioRuns {
  const runs = variants.map((preset) => ({ preset, output: simulate({ ...input, scenario: presetScenario(preset) }) }));
  const ok = runs.filter((r) => r.output.errors.length === 0).map((r) => r.output.meta.endYear);
  return { runs, maxEndYear: Math.max(input.options.calcStart, ...ok) as Year };
}

export type ShiftKind = 'irr' | 'moic';

export interface StepAvailability {
  readonly shift: number;
  readonly allowed: boolean;
  /** 비활성 사유 (3.3-C) */
  readonly reason?: string;
}

/**
 * 3.3-C 단계 사용 가능 여부: 자산군 하나의 IRR 또는 MoIC 단계를 적용했을 때
 * 해당 자산군 펀드가 하한을 지키는지. IRR·MoIC 하한은 서로 독립이므로 동시 조정에도 그대로 유효
 */
export function stepAvailability(
  portfolio: Portfolio,
  options: Options,
  assetClass: AssetClass,
  kind: ShiftKind,
  steps: readonly number[] = kind === 'irr' ? IRR_STEPS : MOIC_STEPS,
): StepAvailability[] {
  const funds = portfolio.funds.filter((f) => f.assetClass === assetClass);
  return steps.map((shift) => {
    const scenario: Scenario = {
      irrShift: { ...byClassOf(0), [assetClass]: kind === 'irr' ? shift : 0 },
      moicShift: { ...byClassOf(0), [assetClass]: kind === 'moic' ? shift : 0 },
    };
    const code = kind === 'irr' ? 'BOUND_IRR' : 'BOUND_MOIC';
    const errors = funds.flatMap((f) => checkAdjustedBounds(f, adjustAssumptions(f, scenario, options))).filter((e) => e.code === code);
    return errors.length === 0 ? { shift, allowed: true } : { shift, allowed: false, reason: errors.map((e) => e.message).join(', ') };
  });
}
