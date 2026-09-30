// 시나리오 실행 (DESIGN.md 8장)과 조정 단계 사용 가능 여부 (3.3-7, 3.3-C)

import { byClassOf, IRR_STEPS, MOIC_STEPS } from './constants';
import { simulate } from './simulate';
import { adjustAssumptions } from './tranches';
import type { Year, YearTime } from './time';
import type { AssetClass, Options, Portfolio, Scenario, ScopeRef, SimInput, SimOutput } from './types';
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

/** 시나리오 요약 한 행 (8장 v0.8) */
export interface ScenarioSummaryRow {
  readonly preset: ScenarioPreset;
  /** 계산 오류 시 메시지, 정상이면 빈 배열 */
  readonly errors: readonly string[];
  /** 범위 내 마지막 회수 연도 */
  readonly endYear: Year;
  readonly lastExitTime: YearTime;
  readonly finalCumCall: number;
  readonly finalCumDist: number;
  /** 기준일 TVPI */
  readonly tvpi: number;
  /** 기본 시나리오 대비 차이 (기본 행이거나 기본 결과가 없으면 null) */
  readonly vsBase: {
    readonly endYear: number;
    readonly lastExitTime: number;
    readonly finalCumCall: number;
    readonly finalCumDist: number;
  } | null;
}

interface ScopeFigures {
  endYear: Year;
  lastExitTime: YearTime;
  finalCumCall: number;
  finalCumDist: number;
  tvpi: number;
}

function figuresOf(out: SimOutput, scope: ScopeRef): ScopeFigures | null {
  if (out.errors.length > 0) return null;
  const pick = <T>(s: { total: T; byClass: Readonly<Record<AssetClass, T>>; byFund: Readonly<Record<string, T>> }): T | undefined =>
    scope.kind === 'total' ? s.total : scope.kind === 'class' ? s.byClass[scope.id] : s.byFund[scope.id];
  const series = pick(out.series);
  const kpi = pick(out.kpi);
  const lastExitTime = pick(out.lastExit);
  if (!series || !kpi || lastExitTime === undefined) return null;
  const funds = scope.kind === 'total' ? out.funds : out.funds.filter((f) => (scope.kind === 'class' ? f.assetClass === scope.id : f.id === scope.id));
  if (funds.length === 0) return null;
  const last = series[series.length - 1];
  return {
    endYear: (scope.kind === 'total' ? out.meta.endYear : Math.max(...funds.map((f) => f.lastExitYear))) as Year,
    lastExitTime,
    finalCumCall: last?.cumCall ?? 0,
    finalCumDist: last?.cumDist ?? 0,
    tvpi: kpi.tvpi,
  };
}

/** 8장 v0.8: 보기 범위별 시나리오 요약과 기본 대비 차이. 화면 시나리오 탭과 인쇄 요약 표가 공유 */
export function summarizeScenarios(runs: ScenarioRuns, scope: ScopeRef): ScenarioSummaryRow[] {
  const base = runs.runs.find((r) => r.preset.key === 'base');
  const baseFig = base ? figuresOf(base.output, scope) : null;
  return runs.runs.map(({ preset, output }) => {
    const fig = figuresOf(output, scope);
    const errors = output.errors.length > 0 ? output.errors.map((e) => e.message) : fig ? [] : ['범위 없음'];
    const f = fig ?? { endYear: 0 as Year, lastExitTime: 0 as YearTime, finalCumCall: 0, finalCumDist: 0, tvpi: 0 };
    return {
      preset,
      errors,
      ...f,
      vsBase:
        fig && baseFig && preset.key !== 'base'
          ? {
              endYear: fig.endYear - baseFig.endYear,
              lastExitTime: fig.lastExitTime - baseFig.lastExitTime,
              finalCumCall: fig.finalCumCall - baseFig.finalCumCall,
              finalCumDist: fig.finalCumDist - baseFig.finalCumDist,
            }
          : null,
    };
  });
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
