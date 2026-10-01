// 대시보드 (DESIGN.md 10.1). 상태 → 입력 → 엔진(simulate·runScenarios·stepAvailability) → 출력 렌더링.
// 계산은 엔진이 하고, 여기서는 출력 객체를 고르고 서식화만 한다.

import { byClassOf, DEFAULT_OPTIONS, ZERO_SCENARIO } from '../engine/constants';
import { presetScenario, runScenarios, SCENARIO_PRESETS, stepAvailability, summarizeScenarios, type ScenarioRuns } from '../engine/scenarios';
import { simulate } from '../engine/simulate';
import { isValidIsoDate } from '../engine/time';
import type { QIndex } from '../engine/time';
import { ASSET_CLASSES, type AssetClass, type KpiPoint, type Options, type Performance, type Portfolio, type Scenario, type SimError, type SimInput, type SimOutput, type Tranche } from '../engine/types';
import { bindChartTooltip, renderMainChart } from './charts/mainChart';
import { renderSensitivity, sameShift, stepLabel, type Availability, type Settings } from './controls/sensitivity';
import { escapeHtml, money, multiple, pct, pct2, PHASE_LABEL, quarterLabel, signedQuarters } from './format';
import { renderPrintView } from './print/printView';
import { CLASS_LABEL, parseScopeKey, scopeKey, selectScope, type Scope, type ScopedView } from './scope';

/** 결과 표 탭 (10.1 v0.8) */
export type TabKey = 'scenarios' | 'performance' | 'years' | 'tranches' | 'assumptions';
const TABS: readonly [TabKey, string][] = [
  ['scenarios', '시나리오 비교'],
  ['performance', '펀드별 성과'],
  ['years', '연도별 현금흐름'],
  ['tranches', '집행분 상세'],
  ['assumptions', '가정 명세'],
];

export interface ViewState {
  scope: Scope;
  asOf: string;
  scenario: Scenario;
  settings: Settings;
  /** 활성 탭: 재계산 후에도 유지 */
  tab: TabKey;
  /** 해석 변경으로 단계가 초기화된 경우 알림 (10.1 v0.4) */
  notice?: string;
}

export function initialState(scope: Scope, asOf: string): ViewState {
  const { irrShiftMode, moicShiftMode, applyToDirect, navBasis } = DEFAULT_OPTIONS;
  return { scope, asOf, scenario: ZERO_SCENARIO, settings: { irrShiftMode, moicShiftMode, applyToDirect, navBasis }, tab: 'scenarios' };
}

/** 한 번의 렌더링에 필요한 엔진 결과 */
export interface Computed {
  readonly out: SimOutput;
  /** 기본 가정 결과. 조정이 없으면 null */
  readonly base: SimOutput | null;
  readonly scenarios: ScenarioRuns;
  readonly availability: Availability;
}

export function isZeroScenario(s: Scenario): boolean {
  return ASSET_CLASSES.every((c) => s.irrShift[c] === 0 && s.moicShift[c] === 0);
}

function optionsOf(state: ViewState): Options {
  return { ...DEFAULT_OPTIONS, ...state.settings, asOf: state.asOf };
}

function availabilityOf(portfolio: Portfolio, options: Options): Availability {
  const a = {} as Availability;
  for (const c of ASSET_CLASSES) a[c] = { irr: stepAvailability(portfolio, options, c, 'irr'), moic: stepAvailability(portfolio, options, c, 'moic') };
  return a;
}

export function compute(portfolio: Portfolio, state: ViewState): Computed {
  const options = optionsOf(state);
  const input: SimInput = { portfolio, scenario: state.scenario, options };
  return {
    out: simulate(input),
    base: isZeroScenario(state.scenario) ? null : simulate({ ...input, scenario: ZERO_SCENARIO }),
    scenarios: runScenarios(input),
    availability: availabilityOf(portfolio, options),
  };
}

/** 해석 변경 후 하한을 위반하게 된 선택 단계를 0으로 되돌린다 (10.1 v0.4) */
export function clampScenario(scenario: Scenario, availability: Availability, settings: Settings): { scenario: Scenario; notice?: string } {
  const irrShift = { ...scenario.irrShift };
  const moicShift = { ...scenario.moicShift };
  const reset: string[] = [];
  for (const c of ASSET_CLASSES) {
    const irr = availability[c].irr.find((s) => sameShift(s.shift, irrShift[c]));
    if (irr && !irr.allowed) {
      reset.push(`${c} IRR ${stepLabel('irr', irr.shift, settings)}`);
      irrShift[c] = 0;
    }
    const moic = availability[c].moic.find((s) => sameShift(s.shift, moicShift[c]));
    if (moic && !moic.allowed) {
      reset.push(`${c} MoIC ${stepLabel('moic', moic.shift, settings)}`);
      moicShift[c] = 0;
    }
  }
  const next = { irrShift, moicShift };
  return reset.length ? { scenario: next, notice: `해석 변경으로 하한(3.3-C)을 위반해 0으로 되돌림: ${reset.join(', ')}` } : { scenario: next };
}

export function renderErrors(errors: readonly SimError[], heading = '입력 검증 오류 — 계산하지 않았습니다'): string {
  return `<section class="panel error-panel" role="alert">
    <h2>${escapeHtml(heading)}</h2>
    <ul>${errors.map((e) => `<li><code>${escapeHtml(e.code)}</code> ${escapeHtml(e.message)}${e.path ? ` <span class="muted">(${escapeHtml(e.path)})</span>` : ''}</li>`).join('')}</ul>
  </section>`;
}

function renderControls(out: SimOutput, state: ViewState): string {
  const opt = (s: Scope, label: string) => {
    const key = scopeKey(s);
    return `<option value="${key}"${key === scopeKey(state.scope) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  };
  const classOpts = ASSET_CLASSES.map((c) => opt({ kind: 'class', id: c }, CLASS_LABEL[c])).join('');
  const fundOpts = ASSET_CLASSES.map(
    (c) => `<optgroup label="펀드 · ${c}">${out.funds.filter((f) => f.assetClass === c).map((f) => opt({ kind: 'fund', id: f.id }, `${f.name}${f.type === 'direct' ? ' (직접투자)' : ''}`)).join('')}</optgroup>`,
  ).join('');
  return `<section class="side-section controls" aria-label="보기">
    <div class="eyebrow">View</div>
    <h2>보기</h2>
    <label class="control">
      <span>보기 범위</span>
      <select id="scope-select">${opt({ kind: 'total' }, '대체 포트폴리오 전체')}<optgroup label="자산군">${classOpts}</optgroup>${fundOpts}</select>
    </label>
    <label class="control">
      <span>기준일</span>
      <input id="asof-input" type="date" value="${escapeHtml(state.asOf)}" required />
    </label>
    <p class="control-note">→ <strong>${quarterLabel(out.meta.asOfQuarter)} 말</strong>까지 실현(채움·실선), 이후 추정(빗금·점선). 운용사 분기 보고 기준</p>
  </section>`;
}

const signedMoney = (v: number) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;
const signedPctPoint = (v: number) => `${v >= 0 ? '+' : '−'}${(Math.abs(v) * 100).toFixed(2)}%p`;

/** 예상 최종 Net IRR·MoIC 카드 (7.8 v0.9): 기준일이 아니라 완전 회수 시점 기준 */
function perfCard(p: Performance, base: Performance | null): string {
  const d = base && base.netIrr !== null && p.netIrr !== null && Math.abs(p.netIrr - base.netIrr) > 5e-6
    ? `<div class="kpi-delta">기본 ${pct2(base.netIrr)} · <strong>${signedPctPoint(p.netIrr - base.netIrr)}</strong></div>`
    : '';
  const exit = p.lastExitQuarter === null ? '' : ` · ${quarterLabel(p.lastExitQuarter)} 회수 완료`;
  return `<div class="kpi-card kpi-perf"><div class="kpi-label">예상 최종 Net IRR</div><div class="kpi-value">${pct2(p.netIrr)}</div>${d}<div class="kpi-note">Net MoIC ${multiple(p.netMoic)}${exit}</div></div>`;
}

/** 펀드별 성과 탭 (7.8 v0.9): 전체·자산군·펀드의 예상 최종 Net IRR·MoIC */
function renderPerformanceTable(out: SimOutput, base: SimOutput | null, state: ViewState): string {
  const cur = scopeKey(state.scope);
  const withBase = (v: number | null, b: number | null | undefined, fmt: (x: number | null) => string) =>
    base && b !== undefined && v !== null && b !== null && Math.abs(v - b) > 5e-6 ? `${fmt(v)} <span class="was">(${fmt(b)})</span>` : fmt(v);
  const row = (key: string, label: string, p: Performance, bp: Performance | undefined, commitment: number, gross: string, cls: string) => `
    <tr class="${cls}${key === cur ? ' current-scope' : ''}">
      <td>${label}</td><td>${money(commitment)}</td><td>${money(p.totalCall)}</td><td>${money(p.totalDist)}</td>
      <td>${p.lastExitQuarter === null ? '—' : quarterLabel(p.lastExitQuarter)}</td>${gross}
      <td class="net">${withBase(p.netIrr, bp?.netIrr, pct2)}</td><td class="net">${withBase(p.netMoic, bp?.netMoic, (x) => multiple(x ?? 0))}</td>
    </tr>`;
  const noGross = '<td>—</td><td>—</td>';
  const total = out.funds.reduce((s, f) => s + f.commitment, 0);
  const rows: string[] = [row('total', '<strong>대체 포트폴리오 전체</strong>', out.performance.total, base?.performance.total, total, noGross, 'perf-total')];
  for (const c of ASSET_CLASSES) {
    const funds = out.funds.filter((f) => f.assetClass === c);
    if (funds.length === 0) continue;
    rows.push(row(`class:${c}`, `<strong>${escapeHtml(CLASS_LABEL[c])}</strong>`, out.performance.byClass[c], base?.performance.byClass[c], funds.reduce((s, f) => s + f.commitment, 0), noGross, 'perf-class'));
    for (const f of funds) {
      const p = out.performance.byFund[f.id];
      if (!p) continue;
      rows.push(row(`fund:${f.id}`, `<span class="perf-fund">${escapeHtml(f.name)}${f.type === 'direct' ? ' (직접투자)' : ''}</span>`, p, base?.performance.byFund[f.id], f.commitment, `<td>${pct(f.irr)}</td><td>${multiple(f.moic)}</td>`, 'perf-fund-row'));
    }
  }
  return `<section class="tab-content">
    <p class="table-note">완전 회수 시점 기준 예상 성과 · Net = 관리보수·성과보수 차감 후 LP 기준 · Gross = 적용 가정 · 단위 $mn${base ? ' · 괄호는 기본 가정' : ''}</p>
    <div class="table-wrap"><table class="data-table perf-table">
      <thead><tr><th>구분</th><th>약정</th><th>총 Call</th><th>총 Distribution</th><th>최종 회수</th><th>Gross IRR</th><th>Gross MoIC</th><th>예상 Net IRR</th><th>예상 Net MoIC</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>
  </section>`;
}
const signedMultiple = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}x`;

function renderKpi(view: ScopedView, out: SimOutput, baseKpi: KpiPoint | null, navLabel: string, basePerf: Performance | null): string {
  const k = view.kpi;
  const delta = (cur: number, base: number | undefined, fmt: (v: number) => string, fmtDelta: (v: number) => string) =>
    base === undefined || Math.abs(cur - base) < 5e-4 ? '' : `<div class="kpi-delta">기본 ${fmt(base)} · <strong>${fmtDelta(cur - base)}</strong></div>`;
  const card = (label: string, value: string, note: string, d: string) =>
    `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${d}<div class="kpi-note">${note}</div></div>`;
  const b = baseKpi ?? undefined;
  // 대표 수치 (10.1 v0.8): 기준일 NAV를 크게, 나머지는 작게
  return `<section class="hero" aria-label="기준일 KPI">
    <div class="kpi-card kpi-hero">
      <div class="kpi-label">기준일 NAV</div>
      <div class="hero-figure"><span class="kpi-value">${money(k.nav)}</span><span class="hero-unit">$mn</span></div>
      ${delta(k.nav, b?.nav, money, signedMoney)}
      <div class="kpi-note">기준일 평가가치 (${navLabel}) · 연말 NAV와 다름</div>
    </div>
    <div class="kpi-stats">
      ${card('누적 Capital Call', money(k.cumCall), '$mn · 투자 + 관리보수', delta(k.cumCall, b?.cumCall, money, signedMoney))}
      ${card('누적 Distribution', money(k.cumDist), '$mn · 순회수', delta(k.cumDist, b?.cumDist, money, signedMoney))}
      ${card('DPI', multiple(k.dpi), 'Distribution ÷ Call', delta(k.dpi, b?.dpi, multiple, signedMultiple))}
      ${card('TVPI', multiple(k.tvpi), '(Dist + NAV) ÷ Call', delta(k.tvpi, b?.tvpi, multiple, signedMultiple))}
      ${perfCard(view.performance, basePerf)}
    </div>
    <p class="kpi-caption">기준일 ${escapeHtml(out.meta.asOf)} · 실현 기준 ${quarterLabel(out.meta.asOfQuarter)} 말 · 진행 연도 ${out.meta.asOfYear}${baseKpi ? ' · 회색 글씨는 기본 가정 대비' : ''}</p>
  </section>`;
}

function renderLegend(hasBase: boolean): string {
  return `<div class="legend" aria-hidden="true">
    <span><i class="sw sw-nav"></i>연말 NAV (실현)</span>
    <span><i class="sw sw-nav-est"></i>연말 NAV (추정)</span>
    <span><i class="ln ln-call"></i>누적 Capital Call</span>
    <span><i class="ln ln-dist"></i>누적 Distribution</span>
    <span><i class="ln ln-est"></i>점선 = 기준일 이후 추정</span>
    ${hasBase ? '<span><i class="ln ln-base"></i>기본 가정 누적선</span>' : ''}
  </div>`;
}

function renderYearTable(view: ScopedView, out: SimOutput): string {
  const rows = view.series
    .filter((p) => p.year >= view.startYear && p.year <= view.endYear)
    .map(
      (p) => `<tr class="phase-row-${p.phase}">
        <td>${p.year}</td><td><span class="phase phase-${p.phase}">${PHASE_LABEL[p.phase]}</span></td>
        <td>${money(p.callInvest)}</td><td>${money(p.callFee)}</td><td>${money(p.dist)}</td>
        <td>${money(p.nav)}</td><td>${money(p.cumCall)}</td><td>${money(p.cumDist)}</td>
      </tr>`,
    )
    .join('');
  const note = view.startYear > out.meta.calcStart ? `<p class="table-note">누적값은 ${out.meta.calcStart}년(최초 약정)부터 누적 (3.1-6).</p>` : '';
  return `<section class="tab-content">
    <p class="table-note">단위 $mn</p>
    ${note}
    <div class="table-wrap"><table class="data-table year-table">
      <thead><tr><th>연도</th><th>구분</th><th>투자 Call</th><th>관리보수</th><th>Distribution</th><th>연말 NAV</th><th>누적 Call</th><th>누적 Distribution</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

function renderTrancheTable(view: ScopedView, out: SimOutput, base: SimOutput | null): string {
  const names = new Map(out.funds.map((f) => [f.id, f.name]));
  const baseOf = new Map((base?.tranches ?? []).map((t) => [`${t.fundId}:${t.investYear}`, t]));
  const withBase = (cur: number, b: number | undefined, fmt: (v: number) => string) =>
    b === undefined || Math.abs(cur - b) < 1e-9 ? fmt(cur) : `${fmt(cur)} <span class="was">(${fmt(b)})</span>`;
  const rows = [...view.tranches]
    .sort((a, b) => (names.get(a.fundId) ?? '').localeCompare(names.get(b.fundId) ?? '') || a.investYear - b.investYear)
    .map((t) => {
      const bt: Tranche | undefined = baseOf.get(`${t.fundId}:${t.investYear}`);
      const done = t.exitQuarter <= out.meta.asOfQuarter;
      return `<tr class="${done ? 'exited' : ''}" data-tranche="${t.fundId}:${t.investYear}">
        <td>${escapeHtml(names.get(t.fundId) ?? t.fundId)}</td><td>${t.investYear}</td><td>${money(t.amount)}</td>
        <td>${withBase(t.irr, bt?.irr, pct)}</td><td>${withBase(t.moic, bt?.moic, multiple)}</td>
        <td class="tstar">${withBase(t.tStar, bt?.tStar, (v) => v.toFixed(2))}</td>
        <td class="exit-time">${withBase(t.exitQuarter, bt?.exitQuarter, (q) => quarterLabel(q as QIndex))}</td><td>${withBase(t.exitYear, bt?.exitYear, String)}</td>
        <td>${money(t.exitGross)}</td><td>${money(t.carry)}</td><td>${money(t.exitNet)}</td>
        <td>${done ? '회수 완료' : '보유'}</td>
      </tr>`;
    })
    .join('');
  return `<section class="tab-content">
    <p class="table-note">단위 $mn${base ? ' · 괄호는 기본 가정' : ''}</p>
    <div class="table-wrap"><table class="data-table tranche-table">
      <thead><tr><th>펀드</th><th>투자 연도</th><th>집행액</th><th>IRR</th><th>MoIC</th><th>t* (년)</th><th>회수 분기</th><th>회수 연도</th><th>회수 총액</th><th>성과보수</th><th>순회수</th><th>기준일 상태</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

/** 8장 5개 시나리오 요약 (전 자산군 동시 적용, 3.3-A). 현재 보기 범위 기준 */
function renderScenarioTable(c: Computed, state: ViewState): string {
  // 라벨은 현재 해석 설정 기준 (예: IRR 상대 변동이면 "IRR −3%")
  const label = (irr: number, moic: number) =>
    irr === 0 && moic === 0 ? '기본' : irr !== 0 ? `IRR ${stepLabel('irr', irr, state.settings)}` : `MoIC ${stepLabel('moic', moic, state.settings)}`;
  const rows = summarizeScenarios(c.scenarios, state.scope)
    .map((r) => {
      const { preset } = r;
      const applied = ASSET_CLASSES.every((cl) => sameShift(state.scenario.irrShift[cl], preset.irrShift) && sameShift(state.scenario.moicShift[cl], preset.moicShift));
      const cells = r.errors.length === 0
        ? `<td>${r.endYear}</td><td>${quarterLabel(r.lastExitQuarter)}</td><td>${money(r.finalCumCall)}</td><td>${money(r.finalCumDist)}</td>
           <td class="delta">${r.vsBase ? signedQuarters(r.vsBase.lastExitQuarters) : '—'}</td><td class="delta">${r.vsBase ? signedMoney(r.vsBase.finalCumDist) : '—'}</td>
           <td>${pct2(r.netIrr)}</td><td>${multiple(r.netMoic)}</td>
           <td>${multiple(r.tvpi)}</td>`
        : `<td colspan="9" class="muted">${escapeHtml(r.errors.join(', '))}</td>`;
      return `<tr class="${applied ? 'applied' : ''}${preset.key === 'base' ? ' is-base' : ''}">
        <td>${escapeHtml(label(preset.irrShift, preset.moicShift))}</td>${cells}
        <td><button type="button" class="text-btn" data-preset="${preset.key}"${applied ? ' disabled' : ''}>${applied ? '적용 중' : '전 자산군 적용'}</button></td>
      </tr>`;
    })
    .join('');
  return `<section class="tab-content">
    <p class="table-note">전 자산군 동시 적용 (8장, 3.3-A) · 해석 설정이 기본이면 인쇄본과 같은 수치 · 최대 종료 연도 ${c.scenarios.maxEndYear} · 단위 $mn</p>
    <div class="table-wrap"><table class="data-table scenario-table">
      <thead><tr><th>시나리오</th><th>종료 연도</th><th>마지막 회수 분기</th><th>최종 누적 Call</th><th>최종 누적 Distribution</th><th>Δ 마지막 회수</th><th>Δ Distribution</th><th>예상 Net IRR</th><th>예상 Net MoIC</th><th>기준일 TVPI</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

function renderAssumptions(): string {
  const items: [string, string][] = [
    ['계산 단위', '연 단위. 약정·집행·관리보수는 매년 1월 1일 발생 (원문 가정 1·2)'],
    ['집행', '약정금을 집행기간 동안 매년 균등 집행. XXX(직접투자)는 2024년 1월 1일 전액 집행 (가정 2·6)'],
    ['가치 상승', '집행분 가치 = 집행액 × (1 + gIRR)^(경과 연수) (가정 3)'],
    ['회수', 't* = ln(MoIC) / ln(1 + IRR). MoIC 도달 시각(투자 연도 + t*)이 속한 분기의 분기말에 회수 인식 — 운용사 분기 보고 기준. 회수 총액 = 집행액 × MoIC (가정 4, 3.1)'],
    ['관리보수', '약정액 기준, 집행기간 2%, 이후 1%. Vintage부터 해당 펀드 마지막 회수 연도까지 매년 1월 1일. 약정 안에서 충당: 투자금 = 약정 − 총보수를 집행기간 동안 균등 투자, 펀드 누적 Call = 약정 (가정 5, 3.4)'],
    ['성과보수', '회수 시점에 (회수 총액 − 원금) × 20%. 허들·캐치업 없음. 직접투자는 보수 없음 (가정 5)'],
    ['Distribution', '회수 총액 − 성과보수'],
    ['NAV', 'Gross: 미회수 집행분 평가가치 합. Net 옵션: 미실현 이익 × 20% 차감, 직접투자 제외 (3.5)'],
    ['누적 기준', '2015년(DDD VI 약정)부터 누적, 표시는 2017년부터 (가정 9, 3.1-5·6)'],
    ['시간축', 'NAV는 연말 값 막대, 누적 Call·Distribution은 실제 발생 시각의 계단형 선 (3.1-7)'],
    ['실현/추정', '기준 분기말까지 실현(채움·실선), 이후 추정(빗금·점선). 인쇄본은 2026-09-30 = 2026 Q3 말 고정 (원문 "2026년 9월", 3.2)'],
    ['민감도', 'IRR ±3%p 가감, MoIC ±20% 상대 변동 (설정에서 해석 전환). 3%p·20% 단위 −2~+2단계. IRR·MoIC 동시 조정 가능 (3.3)'],
    ['XXX 연동', 'PE 조정을 XXX(직접투자)에도 같은 폭 적용, 설정에서 분리 가능 (3.3-4)'],
    ['조정 하한', 'IRR′ ≥ 1%, MoIC′ > 1.0x. 위반 단계는 비활성화 — 손실 케이스의 성과보수 규칙이 원문에 없음 (3.3-C)'],
    ['민감도 해석', '모든 집행분을 조정 IRR·MoIC로 투자 시점부터 다시 계산한 가상 시나리오. 실현/추정은 기준일 기준 표시 구분 (3.3-6)'],
    ['시나리오 비교', '인쇄용 5개 시나리오는 전 자산군 동시 적용, 전 구간 재계산 (8장, 3.3-A)'],
  ];
  return `<section class="tab-content assumptions">
    <p class="table-note">원문 가정과 해석 결정</p>
    <dl>${items.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
  </section>`;
}

/** 화면 사용 가이드 (10.1 v0.7): 조작법·인쇄 설정 요약. 상세는 사용자 가이드 문서 */
function renderGuide(): string {
  const items: [string, string][] = [
    ['보기 범위', '전체 / 자산군 / 펀드를 선택. 주소 끝에 #fund:AAA_VII, #class:PE 를 붙여 바로 열 수도 있음'],
    ['기준일', '기준일 이전 마지막 분기말까지 실현(채움·실선), 이후 추정(빗금·점선). 기본값은 오늘'],
    ['민감도 조정', '자산군별 IRR(±3%p 단위)·MoIC(±20% 단위)를 누르면 즉시 반영. 빗금 버튼은 조정 하한(IRR′ ≥ 1%, MoIC′ > 1.0x) 위반으로 선택 불가. "기본 가정으로 초기화"로 되돌림'],
    ['비교', '조정하면 차트에 회색 기본 가정 누적선, KPI에 기본 대비 증감, 집행분 표에 괄호로 기본값 표시'],
    ['해석 설정', 'IRR %p/상대, MoIC 상대/절대, NAV Gross/Net, XXX 연동'],
    ['5개 시나리오', '전 자산군 동시 적용 결과 비교. "전 자산군 적용"으로 화면에 반영'],
    ['차트 툴팁', '연도 위에 마우스를 올리면 그해 NAV·누적값·당해 흐름 표시'],
    ['인쇄 / PDF', '오른쪽 위 버튼. 기준일 2026-09-30 고정 2페이지. 프린터·Microsoft Print to PDF는 레이아웃 "가로", 용지 "A4" 선택'],
  ];
  return `<details class="guide" data-panel="guide" id="guide">
    <summary><h2>사용 가이드</h2><span class="muted">조작법과 인쇄 설정</span></summary>
    <dl>${items.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
  </details>`;
}

export function renderDashboard(c: Computed, state: ViewState): string {
  const { out, base } = c;
  const sensitivity = renderSensitivity(state.scenario, state.settings, c.availability, out.funds, state.notice);
  if (out.errors.length > 0) return `${sensitivity}${renderErrors(out.errors)}`;
  const view = selectScope(out, state.scope);
  if (!view) return renderErrors([{ code: 'SCOPE', message: `보기 범위를 찾을 수 없음: ${scopeKey(state.scope)}` }]);
  const baseView = base && base.errors.length === 0 ? selectScope(base, state.scope) : null;
  const xEndYear = Math.max(view.endYear, baseView?.endYear ?? 0);
  const chartOpts = baseView ? { idPrefix: 'main', xEndYear, baseline: baseView.steps } : { idPrefix: 'main', xEndYear };
  const tabBody: Record<TabKey, string> = {
    scenarios: renderScenarioTable(c, state),
    performance: renderPerformanceTable(out, base, state),
    years: renderYearTable(view, out),
    tranches: renderTrancheTable(view, out, base),
    assumptions: renderAssumptions(),
  };
  // 2단 배치 (10.1 v0.8): 왼쪽 조작 사이드바, 오른쪽 결과
  return `<div class="layout">
    <aside class="sidebar">
      ${renderControls(out, state)}
      ${sensitivity}
    </aside>
    <main class="main">
      ${renderGuide()}
      ${renderKpi(view, out, baseView?.kpi ?? null, state.settings.navBasis === 'gross' ? 'Gross' : 'Net', baseView?.performance ?? null)}
      <section class="chart-panel">
        <div class="eyebrow">Cash Flow &amp; NAV</div>
        <h2>${escapeHtml(view.title)} <span class="muted">${view.startYear}~${xEndYear} · 연말 NAV / 누적 Capital Call / 누적 Distribution${baseView ? ' · 회색 = 기본 가정' : ''}</span></h2>
        ${renderLegend(baseView !== null)}
        <div class="chart-wrap">${renderMainChart(view, out.meta, chartOpts)}<div class="chart-tooltip" hidden></div></div>
      </section>
      <section class="results">
        <div class="tabs" role="tablist">${TABS.map(([k, label]) => `<button type="button" role="tab" class="tab${state.tab === k ? ' active' : ''}" data-tab="${k}" aria-selected="${state.tab === k}">${label}</button>`).join('')}</div>
        ${TABS.map(([k]) => `<div class="tab-panel" role="tabpanel" data-tab-panel="${k}"${state.tab === k ? '' : ' hidden'}>${tabBody[k]}</div>`).join('')}
      </section>
    </main>
  </div>`;
}

/** 대시보드 마운트: 입력이 바뀔 때마다 엔진을 다시 실행해 전체를 그린다 (엔진 계산은 수 ms) */
export function mountApp(root: HTMLElement, portfolio: Portfolio, initial: ViewState): void {
  let state: ViewState = { ...initial };
  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `<div class="header-text">
      <div class="eyebrow">Alternative Investment · Cash Flow Simulation</div>
      <h1>대체투자 현금흐름 시뮬레이션</h1>
      <p>KIC 대체자산 포트폴리오 12개 펀드 · 약정 $3,000mn · 2017년부터 완전 회수까지 NAV, 누적 Capital Call·Distribution</p>
    </div>
    <div class="header-actions">
      <button type="button" id="guide-btn" class="pill">사용 가이드</button>
      <button type="button" id="print-btn" class="pill pill-dark" title="A4 가로 2페이지 · 기준일 2026-09-30 고정">인쇄 / PDF 저장 ▶</button>
    </div>`;
  header.querySelector('#print-btn')?.addEventListener('click', () => window.print());
  header.querySelector('#guide-btn')?.addEventListener('click', () => {
    const g = body.querySelector<HTMLDetailsElement>('#guide');
    if (!g) return;
    g.open = !g.open;
    if (g.open) g.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const body = document.createElement('div');
  body.className = 'screen-root';
  // 인쇄 뷰는 화면 상태와 독립이므로 한 번만 만든다 (10.2 v0.5)
  const print = document.createElement('div');
  print.innerHTML = renderPrintView(portfolio);
  root.replaceChildren(header, body, ...print.childNodes);

  const render = () => {
    const c = compute(portfolio, state);
    // 다시 그려도 펼친 패널(해석 설정 등)은 유지
    const open = new Set([...body.querySelectorAll<HTMLDetailsElement>('details[data-panel]')].filter((d) => d.open).map((d) => d.dataset.panel));
    body.innerHTML = renderDashboard(c, state);
    for (const d of body.querySelectorAll<HTMLDetailsElement>('details[data-panel]')) if (open.has(d.dataset.panel)) d.open = true;
    const view = c.out.errors.length === 0 ? selectScope(c.out, state.scope) : null;
    const baseView = c.base && c.base.errors.length === 0 ? selectScope(c.base, state.scope) : null;
    const chart = body.querySelector<HTMLElement>('.chart-wrap');
    if (chart && view) bindChartTooltip(chart, view.series, baseView?.series);
  };

  const setShift = (cls: AssetClass, kind: 'irr' | 'moic', shift: number) => {
    const key = kind === 'irr' ? 'irrShift' : 'moicShift';
    state = { ...state, notice: undefined, scenario: { ...state.scenario, [key]: { ...state.scenario[key], [cls]: shift } } };
  };

  // 이벤트 위임: 다시 그려도 리스너는 한 번만
  body.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (!btn || btn.disabled) return;
    const { class: cls, kind, shift, preset } = btn.dataset;
    if (cls && (kind === 'irr' || kind === 'moic') && shift !== undefined && (ASSET_CLASSES as readonly string[]).includes(cls)) {
      setShift(cls as AssetClass, kind, Number(shift));
    } else if (preset) {
      const p = SCENARIO_PRESETS.find((x) => x.key === preset);
      if (!p) return;
      state = { ...state, notice: undefined, scenario: presetScenario(p) };
    } else if (btn.dataset.tab) {
      const t = TABS.find(([k]) => k === btn.dataset.tab)?.[0];
      if (!t) return;
      state = { ...state, tab: t };
    } else if (btn.id === 'reset-shifts') {
      state = { ...state, notice: undefined, scenario: { irrShift: byClassOf(0), moicShift: byClassOf(0) } };
    } else {
      return;
    }
    render();
  });

  body.addEventListener('change', (e) => {
    const el = e.target;
    if (el instanceof HTMLSelectElement && el.id === 'scope-select') {
      state = { ...state, scope: parseScopeKey(el.value) };
      history.replaceState(null, '', `#${scopeKey(state.scope)}`);
    } else if (el instanceof HTMLInputElement && el.id === 'asof-input') {
      if (!isValidIsoDate(el.value)) return;
      state = { ...state, asOf: el.value };
    } else if ((el instanceof HTMLSelectElement || el instanceof HTMLInputElement) && el.dataset.setting) {
      const s = { ...state.settings };
      const key = el.dataset.setting;
      if (key === 'irrShiftMode' && (el.value === 'pp' || el.value === 'relative')) s.irrShiftMode = el.value;
      else if (key === 'moicShiftMode' && (el.value === 'relative' || el.value === 'absolute')) s.moicShiftMode = el.value;
      else if (key === 'navBasis' && (el.value === 'gross' || el.value === 'net')) s.navBasis = el.value;
      else if (key === 'applyToDirect' && el instanceof HTMLInputElement) s.applyToDirect = el.checked;
      else return;
      const availability = availabilityOf(portfolio, optionsOf({ ...state, settings: s }));
      const clamped = clampScenario(state.scenario, availability, s);
      state = { ...state, settings: s, scenario: clamped.scenario, notice: clamped.notice };
    } else {
      return;
    }
    render();
  });

  render();
}
