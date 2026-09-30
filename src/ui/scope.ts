// 보기 범위 (10.1): 전체 / 자산군 / 펀드. 출력 객체에서 해당 범위 데이터를 고른다 (계산 없음).

import type { AssetClass, FundInfo, KpiPoint, SeriesPoint, SimOutput, StepPoint, Tranche } from '../engine/types';

export type Scope = { kind: 'total' } | { kind: 'class'; id: AssetClass } | { kind: 'fund'; id: string };

export const CLASS_LABEL: Record<AssetClass, string> = {
  PE: '사모주식 PE',
  RE: '부동산 RE',
  Infra: '인프라 Infra',
  PD: '사모채권 PD',
};

export function scopeKey(s: Scope): string {
  return s.kind === 'total' ? 'total' : `${s.kind}:${s.id}`;
}

export function parseScopeKey(key: string): Scope {
  const [kind, id] = key.split(':');
  if (kind === 'class' && (id === 'PE' || id === 'RE' || id === 'Infra' || id === 'PD')) return { kind, id };
  if (kind === 'fund' && id) return { kind, id };
  return { kind: 'total' };
}

export interface ScopedView {
  readonly title: string;
  readonly series: readonly SeriesPoint[];
  readonly steps: readonly StepPoint[];
  readonly kpi: KpiPoint;
  readonly funds: readonly FundInfo[];
  readonly tranches: readonly Tranche[];
  /** 차트·표 시작 연도: 펀드는 약정 시점부터 (10.2 2페이지와 같은 원칙), 그 외 displayStart */
  readonly startYear: number;
  /** 차트·표 끝 연도: 범위 내 마지막 회수 연도 (원문 "완전 회수 시점까지") */
  readonly endYear: number;
  /** 범위 내 마지막 회수 시각 (엔진 lastExit, 9장 v0.6) */
  readonly lastExitTime: number;
}

export function selectScope(out: SimOutput, scope: Scope): ScopedView | null {
  const start = out.meta.displayStart;
  if (scope.kind === 'total') {
    return { title: '대체 포트폴리오 전체', series: out.series.total, steps: out.steps.total, kpi: out.kpi.total, funds: out.funds, tranches: out.tranches, startYear: start, endYear: out.meta.endYear, lastExitTime: out.lastExit.total };
  }
  if (scope.kind === 'class') {
    const funds = out.funds.filter((f) => f.assetClass === scope.id);
    const ids = new Set(funds.map((f) => f.id));
    return {
      title: CLASS_LABEL[scope.id],
      series: out.series.byClass[scope.id],
      steps: out.steps.byClass[scope.id],
      kpi: out.kpi.byClass[scope.id],
      funds,
      tranches: out.tranches.filter((t) => ids.has(t.fundId)),
      startYear: start,
      endYear: Math.max(start, ...funds.map((f) => f.lastExitYear)),
      lastExitTime: out.lastExit.byClass[scope.id],
    };
  }
  const fund = out.funds.find((f) => f.id === scope.id);
  const series = out.series.byFund[scope.id];
  const steps = out.steps.byFund[scope.id];
  const kpi = out.kpi.byFund[scope.id];
  const lastExitTime = out.lastExit.byFund[scope.id];
  if (!fund || !series || !steps || !kpi || lastExitTime === undefined) return null;
  return {
    title: `${fund.name} (${fund.assetClass}${fund.type === 'direct' ? ' · 직접투자' : ''})`,
    series,
    steps,
    kpi,
    funds: [fund],
    tranches: out.tranches.filter((t) => t.fundId === scope.id),
    startYear: Math.max(start, fund.vintage),
    endYear: fund.lastExitYear,
    lastExitTime,
  };
}
