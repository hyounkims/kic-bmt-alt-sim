// 엔진 입출력 스키마 (DESIGN.md 5장 입력, 9장 출력).
// 단위: 금액 $mn, 비율 소수(18% → 0.18). 연도는 Year, 시각은 YearTime (time.ts).

import type { QIndex, Year, YearTime } from './time';

// ─── 공통 ───────────────────────────────────────────────

export type AssetClass = 'PE' | 'RE' | 'Infra' | 'PD';
export const ASSET_CLASSES: readonly AssetClass[] = ['PE', 'RE', 'Infra', 'PD'];

export type FundType = 'fund' | 'direct';

/** 자산군별 값 (scenario.irrShift 등) */
export type ByClass<T> = Record<AssetClass, T>;

// ─── 입력 (5장) ─────────────────────────────────────────

export interface Fund {
  readonly id: string;
  readonly assetClass: AssetClass;
  readonly name: string;
  readonly type: FundType;
  readonly commitment: number;
  readonly vintage: Year;
  /** 집행기간(년). direct는 1 */
  readonly investPeriod: number;
  readonly gIRR: number;
  readonly gMOIC: number;
}

export interface Fees {
  /** 집행기간 중 관리보수율 (약정액 대비) */
  readonly mgmtInvest: number;
  /** 집행기간 이후 관리보수율 */
  readonly mgmtPost: number;
  /** 성과보수율 */
  readonly carry: number;
}

export interface Portfolio {
  readonly funds: readonly Fund[];
  readonly fees: Fees;
}

export interface Scenario {
  /** irrShiftMode가 pp면 %p 소수(+3%p → 0.03), relative면 상대 비율 */
  readonly irrShift: Readonly<ByClass<number>>;
  /** moicShiftMode가 relative면 상대 비율(+20% → 0.20), absolute면 배수 가감 */
  readonly moicShift: Readonly<ByClass<number>>;
}

export type IrrShiftMode = 'pp' | 'relative';
export type MoicShiftMode = 'relative' | 'absolute';
export type NavBasis = 'gross' | 'net';

export interface Options {
  /** 기준일 ISO 날짜 (YYYY-MM-DD) */
  readonly asOf: string;
  readonly irrShiftMode: IrrShiftMode;
  readonly moicShiftMode: MoicShiftMode;
  /** PE 조정을 직접투자(XXX)에도 적용 (3.3-4) */
  readonly applyToDirect: boolean;
  readonly navBasis: NavBasis;
  readonly calcStart: Year;
  readonly displayStart: Year;
}

export interface SimInput {
  readonly portfolio: Portfolio;
  readonly scenario: Scenario;
  readonly options: Options;
}

// ─── 출력 (9장) ─────────────────────────────────────────

export interface Meta {
  readonly asOf: string;
  /** 기준 분기말 시각 (7.6 v0.9) */
  readonly asOfTime: YearTime;
  /** 기준 분기 (기준일 이전 마지막 분기말, 당일 포함) */
  readonly asOfQuarter: QIndex;
  readonly asOfYear: Year;
  readonly calcStart: Year;
  readonly displayStart: Year;
  readonly endYear: Year;
}

/** 펀드 표시 정보 (9장 v0.3 보강) */
export interface FundInfo {
  readonly id: string;
  readonly name: string;
  readonly assetClass: AssetClass;
  readonly type: FundType;
  readonly commitment: number;
  readonly vintage: Year;
  readonly investPeriod: number;
  /** 원 가정 */
  readonly gIRR: number;
  readonly gMOIC: number;
  /** 조정 후 적용값 (7.2) */
  readonly irr: number;
  readonly moic: number;
  /** 마지막 집행분 회수 연도 (관리보수 종료 연도, 7.4) */
  readonly lastExitYear: Year;
}

export interface Tranche {
  readonly fundId: string;
  readonly investYear: Year;
  /** 집행 금액 A */
  readonly amount: number;
  readonly irr: number;
  readonly moic: number;
  /** MoIC 도달 기간(년). 시각이 아니라 기간이므로 number */
  readonly tStar: number;
  /** MoIC 도달 시각 T = Y + t* (연속값, 7.3 v0.9) */
  readonly reachTime: YearTime;
  /** 회수 분기: T가 속한 분기 */
  readonly exitQuarter: QIndex;
  /** 실제 회수일 YYYY-MM-DD = T의 달력 날짜 (7.3 v0.9.2) */
  readonly reachDate: string;
  /** 회수 인식(보고) 시각 = 회수 분기말 */
  readonly exitTime: YearTime;
  /** 회수 분기의 연도 */
  readonly exitYear: Year;
  readonly exitGross: number;
  readonly carry: number;
  /** 회수금에서 차감한 집행기간 이후 관리보수 (7.4 v0.10) */
  readonly feeNetted: number;
  /** Distribution = 회수 총액 − 성과보수 − 보수 차감 */
  readonly exitNet: number;
}

export type CashEventType = 'call' | 'fee' | 'dist';

export interface CashEvent {
  readonly time: YearTime;
  /** 집계 연도 (7.5 v0.9: 시각의 정수부가 아니라 분기의 연도) */
  readonly year: Year;
  /** 분기 (qIndex). call·fee는 그해 Q1, dist는 회수 분기 */
  readonly quarter: QIndex;
  readonly type: CashEventType;
  readonly fundId: string;
  readonly amount: number;
}

export type Phase = 'past' | 'current' | 'future';

export interface SeriesPoint {
  readonly year: Year;
  readonly phase: Phase;
  readonly callInvest: number;
  /** 집행기간 관리보수 Call */
  readonly callFee: number;
  /** 보수 차감 후 Distribution */
  readonly dist: number;
  /** 그해 회수금에서 차감한 관리보수 (v0.10) */
  readonly feeNetted: number;
  /** 연말 NAV (navBasis 기준) */
  readonly nav: number;
  readonly cumCall: number;
  readonly cumDist: number;
}

/** 계단형 누적선 점 (9장 v0.3 보강). time 시각의 이벤트까지 반영한 누적값 */
export interface StepPoint {
  readonly time: YearTime;
  /** 실현/추정 분할용 분기 (7.6 v0.9) */
  readonly quarter: QIndex;
  readonly cumCall: number;
  readonly cumDist: number;
}

export interface KpiPoint {
  readonly cumCall: number;
  readonly cumDist: number;
  readonly nav: number;
  readonly dpi: number;
  readonly tvpi: number;
}

/** 보기 범위 (10.1): 전체 / 자산군 / 펀드 */
export type ScopeRef = { readonly kind: 'total' } | { readonly kind: 'class'; readonly id: AssetClass } | { readonly kind: 'fund'; readonly id: string };

/** 보기 범위별 묶음: 전체 / 자산군별 / 펀드별 */
export interface Scoped<T> {
  readonly total: T;
  readonly byClass: Readonly<ByClass<T>>;
  readonly byFund: Readonly<Record<string, T>>;
}

/** 예상 최종 성과 (7.8 v0.9): LP 순현금흐름 기준 */
export interface Performance {
  /** Net IRR (해가 없으면 null) */
  readonly netIrr: number | null;
  /** Net MoIC = 총 Distribution / 총 Call */
  readonly netMoic: number;
  readonly totalCall: number;
  readonly totalDist: number;
  /** 최종 회수 분기 (집행분이 없으면 null) */
  readonly lastExitQuarter: QIndex | null;
  /** 범위 내 마지막 회수일 (v0.9.2) */
  readonly lastReachDate: string | null;
}

export interface SimError {
  readonly code: string;
  readonly message: string;
  /** 오류 위치 (예: "portfolio.funds[3].vintage") */
  readonly path?: string;
}

export interface SimOutput {
  readonly meta: Meta;
  readonly funds: readonly FundInfo[];
  readonly tranches: readonly Tranche[];
  readonly events: readonly CashEvent[];
  readonly series: Scoped<readonly SeriesPoint[]>;
  readonly steps: Scoped<readonly StepPoint[]>;
  readonly kpi: Scoped<KpiPoint>;
  /** 범위별 마지막 회수 시각 (9장 v0.6) */
  readonly lastExit: Scoped<YearTime>;
  /** 범위별 예상 최종 성과 (7.8 v0.9) */
  readonly performance: Scoped<Performance>;
  readonly errors: readonly SimError[];
}
