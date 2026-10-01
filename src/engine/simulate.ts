// simulate(input) → output (DESIGN.md 7장). 순수 함수: 입력을 변경하지 않는다.

import { kpiOf, seriesOf, sortEvents, stepsOf, trancheEvents, type AggregateContext, type FundCalc } from './aggregate';
import { feeEvents } from './fees';
import { performanceOf } from './performance';
import { adjustAssumptions, buildTranches } from './tranches';
import { asOfQuarterOf, qEndTime, qYear, startOf, type QIndex, type Year, type YearTime } from './time';
import {
  ASSET_CLASSES,
  type AssetClass,
  type ByClass,
  type FundInfo,
  type KpiPoint,
  type Performance,
  type Scoped,
  type SimError,
  type SimInput,
  type SimOutput,
} from './types';
import { validateInput } from './validate';

function scoped<T>(fcs: readonly FundCalc[], f: (group: readonly FundCalc[]) => T): Scoped<T> {
  const byClass = {} as ByClass<T>;
  for (const c of ASSET_CLASSES) byClass[c] = f(fcs.filter((fc) => fc.fund.assetClass === c));
  const byFund: Record<string, T> = {};
  for (const fc of fcs) byFund[fc.fund.id] = f([fc]);
  return { total: f(fcs), byClass, byFund };
}

const ZERO_KPI: KpiPoint = { cumCall: 0, cumDist: 0, nav: 0, dpi: 0, tvpi: 0 };
const EMPTY_PERF: Performance = { netIrr: null, netMoic: 0, totalCall: 0, totalDist: 0, lastExitQuarter: null, lastReachDate: null };

function emptyByClass<T>(value: () => T): ByClass<T> {
  return Object.fromEntries(ASSET_CLASSES.map((c: AssetClass) => [c, value()])) as ByClass<T>;
}

/** 오류 시 출력: 나머지 필드는 빈 값 (9장 v0.3) */
function errorOutput(input: SimInput, errors: readonly SimError[]): SimOutput {
  const { calcStart, displayStart, asOf } = input.options;
  return {
    meta: { asOf, asOfTime: startOf(calcStart), asOfQuarter: (4 * calcStart) as QIndex, asOfYear: calcStart, calcStart, displayStart, endYear: calcStart },
    funds: [],
    tranches: [],
    events: [],
    series: { total: [], byClass: emptyByClass(() => []), byFund: {} },
    steps: { total: [], byClass: emptyByClass(() => []), byFund: {} },
    kpi: { total: ZERO_KPI, byClass: emptyByClass(() => ZERO_KPI), byFund: {} },
    lastExit: { total: startOf(calcStart), byClass: emptyByClass(() => startOf(calcStart)), byFund: {} },
    performance: { total: EMPTY_PERF, byClass: emptyByClass(() => EMPTY_PERF), byFund: {} },
    errors,
  };
}

export function simulate(input: SimInput): SimOutput {
  const errors = validateInput(input);
  if (errors.length > 0) return errorOutput(input, errors);

  const { portfolio, scenario, options } = input;
  const { fees } = portfolio;

  // 기준 분기: 기준일 이전 마지막 분기말 (7.6 v0.9)
  const asOfQuarter = asOfQuarterOf(options.asOf);
  const asOfTime = qEndTime(asOfQuarter);

  // 7.1~7.4 펀드별 계산 (가정 조정 → 집행분 → 관리보수)
  const fundCalcs: FundCalc[] = [];
  const funds: FundInfo[] = [];
  for (const fund of portfolio.funds) {
    const a = adjustAssumptions(fund, scenario, options);
    const { tranches, feeSchedule } = buildTranches(fund, a, fees);
    const events = [...trancheEvents(tranches), ...feeEvents(fund, feeSchedule)];
    fundCalcs.push({ fund, tranches, events });
    funds.push({
      id: fund.id,
      name: fund.name,
      assetClass: fund.assetClass,
      type: fund.type,
      commitment: fund.commitment,
      vintage: fund.vintage,
      investPeriod: fund.investPeriod,
      gIRR: fund.gIRR,
      gMOIC: fund.gMOIC,
      irr: a.irr,
      moic: a.moic,
      lastExitYear: Math.max(...tranches.map((t) => t.exitYear)) as Year,
    });
  }

  // 종료 연도: 마지막 회수 연도 (관리보수 종료 연도와 같음)
  const endYear = Math.max(options.calcStart, ...funds.map((f) => f.lastExitYear)) as Year;
  const ctx: AggregateContext = {
    calcStart: options.calcStart,
    endYear,
    asOfTime,
    asOfQuarter,
    asOfYear: qYear(asOfQuarter),
    fees,
    navBasis: options.navBasis,
  };

  return {
    meta: {
      asOf: options.asOf,
      asOfTime,
      asOfQuarter,
      asOfYear: ctx.asOfYear,
      calcStart: options.calcStart,
      displayStart: options.displayStart,
      endYear,
    },
    funds,
    tranches: fundCalcs.flatMap((fc) => fc.tranches),
    events: sortEvents(fundCalcs.flatMap((fc) => fc.events)),
    series: scoped(fundCalcs, (g) => seriesOf(g, ctx)),
    steps: scoped(fundCalcs, (g) => stepsOf(g, ctx)),
    kpi: scoped(fundCalcs, (g) => kpiOf(g, ctx)),
    lastExit: scoped(fundCalcs, (g) => Math.max(options.calcStart, ...g.flatMap((fc) => fc.tranches.map((t) => t.exitTime))) as YearTime),
    performance: scoped(fundCalcs, (g) => performanceOf(g)),
    errors: [],
  };
}
