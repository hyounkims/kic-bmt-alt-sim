// 대시보드 (DESIGN.md 10.1). 상태 → 입력 → 엔진(simulate·runScenarios·stepAvailability) → 출력 렌더링.
// 계산은 엔진이 하고, 여기서는 출력 객체를 고르고 서식화만 한다.

import { byClassOf, DEFAULT_OPTIONS, ZERO_SCENARIO } from '../engine/constants';
import { presetScenario, runScenarios, SCENARIO_PRESETS, stepAvailability, type ScenarioRuns } from '../engine/scenarios';
import { simulate } from '../engine/simulate';
import { isValidIsoDate } from '../engine/time';
import { ASSET_CLASSES, type AssetClass, type KpiPoint, type Options, type Portfolio, type Scenario, type SimError, type SimInput, type SimOutput, type Tranche } from '../engine/types';
import { bindChartTooltip, renderMainChart } from './charts/mainChart';
import { renderSensitivity, sameShift, stepLabel, type Availability, type Settings } from './controls/sensitivity';
import { escapeHtml, money, multiple, pct, PHASE_LABEL, yearTime } from './format';
import { CLASS_LABEL, parseScopeKey, scopeKey, selectScope, type Scope, type ScopedView } from './scope';

export interface ViewState {
  scope: Scope;
  asOf: string;
  scenario: Scenario;
  settings: Settings;
  /** 해석 변경으로 단계가 초기화된 경우 알림 (10.1 v0.4) */
  notice?: string;
}

export function initialState(scope: Scope, asOf: string): ViewState {
  const { irrShiftMode, moicShiftMode, applyToDirect, navBasis } = DEFAULT_OPTIONS;
  return { scope, asOf, scenario: ZERO_SCENARIO, settings: { irrShiftMode, moicShiftMode, applyToDirect, navBasis } };
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
  return `<div class="controls">
    <label class="control">
      <span>보기 범위</span>
      <select id="scope-select">${opt({ kind: 'total' }, '대체 포트폴리오 전체')}<optgroup label="자산군">${classOpts}</optgroup>${fundOpts}</select>
    </label>
    <label class="control">
      <span>기준일</span>
      <input id="asof-input" type="date" value="${escapeHtml(state.asOf)}" required />
    </label>
    <p class="control-note">기준일 이전 = 실현(채움·실선), 이후 = 추정(빗금·점선). 인쇄본 기준일은 2026-09-30 고정.</p>
  </div>`;
}

const signedMoney = (v: number) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;
const signedMultiple = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}x`;

function renderKpi(view: ScopedView, out: SimOutput, baseKpi: KpiPoint | null, navLabel: string): string {
  const k = view.kpi;
  const delta = (cur: number, base: number | undefined, fmt: (v: number) => string, fmtDelta: (v: number) => string) =>
    base === undefined || Math.abs(cur - base) < 5e-4 ? '' : `<div class="kpi-delta">기본 ${fmt(base)} · <strong>${fmtDelta(cur - base)}</strong></div>`;
  const card = (label: string, value: string, note: string, d: string) =>
    `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${d}<div class="kpi-note">${note}</div></div>`;
  const b = baseKpi ?? undefined;
  return `<section class="kpi-row" aria-label="기준일 KPI">
    ${card('누적 Capital Call', money(k.cumCall), '$mn · 투자 + 관리보수', delta(k.cumCall, b?.cumCall, money, signedMoney))}
    ${card('누적 Distribution', money(k.cumDist), '$mn · 순회수 (성과보수 차감)', delta(k.cumDist, b?.cumDist, money, signedMoney))}
    ${card('NAV', money(k.nav), `$mn · 기준일 평가가치 (${navLabel})`, delta(k.nav, b?.nav, money, signedMoney))}
    ${card('DPI', multiple(k.dpi), 'Distribution ÷ Call', delta(k.dpi, b?.dpi, multiple, signedMultiple))}
    ${card('TVPI', multiple(k.tvpi), '(Distribution + NAV) ÷ Call', delta(k.tvpi, b?.tvpi, multiple, signedMultiple))}
    <p class="kpi-caption">기준일 ${escapeHtml(out.meta.asOf)} (연 소수 시각 ${yearTime(out.meta.asOfTime)}) 시점 · 진행 연도 ${out.meta.asOfYear}${baseKpi ? ' · 회색 글씨는 기본 가정 대비' : ''}</p>
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
  return `<section class="panel">
    <h2>연도별 현금흐름 <span class="muted">($mn)</span></h2>
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
      const done = t.exitTime <= out.meta.asOfTime;
      return `<tr class="${done ? 'exited' : ''}" data-tranche="${t.fundId}:${t.investYear}">
        <td>${escapeHtml(names.get(t.fundId) ?? t.fundId)}</td><td>${t.investYear}</td><td>${money(t.amount)}</td>
        <td>${withBase(t.irr, bt?.irr, pct)}</td><td>${withBase(t.moic, bt?.moic, multiple)}</td>
        <td class="tstar">${withBase(t.tStar, bt?.tStar, (v) => v.toFixed(2))}</td>
        <td class="exit-time">${withBase(t.exitTime, bt?.exitTime, yearTime)}</td><td>${withBase(t.exitYear, bt?.exitYear, String)}</td>
        <td>${money(t.exitGross)}</td><td>${money(t.carry)}</td><td>${money(t.exitNet)}</td>
        <td>${done ? '회수 완료' : '보유'}</td>
      </tr>`;
    })
    .join('');
  return `<section class="panel">
    <h2>집행분 상세 <span class="muted">($mn${base ? ' · 괄호는 기본 가정' : ''})</span></h2>
    <div class="table-wrap"><table class="data-table tranche-table">
      <thead><tr><th>펀드</th><th>투자 연도</th><th>집행액</th><th>IRR</th><th>MoIC</th><th>t* (년)</th><th>회수 시각</th><th>회수 연도</th><th>회수 총액</th><th>성과보수</th><th>순회수</th><th>기준일 상태</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

/** 8장 5개 시나리오 요약 (전 자산군 동시 적용, 3.3-A). 현재 보기 범위 기준 */
function renderScenarioTable(c: Computed, state: ViewState): string {
  // 라벨은 현재 해석 설정 기준 (예: IRR 상대 변동이면 "IRR −3%")
  const label = (irr: number, moic: number) =>
    irr === 0 && moic === 0 ? '기본' : irr !== 0 ? `IRR ${stepLabel('irr', irr, state.settings)}` : `MoIC ${stepLabel('moic', moic, state.settings)}`;
  const rows = c.scenarios.runs
    .map(({ preset, output }) => {
      const v = output.errors.length === 0 ? selectScope(output, state.scope) : null;
      const last = v?.series.filter((p) => p.year <= v.endYear).at(-1);
      const applied = ASSET_CLASSES.every((cl) => sameShift(state.scenario.irrShift[cl], preset.irrShift) && sameShift(state.scenario.moicShift[cl], preset.moicShift));
      const cells = v && last
        ? `<td>${v.endYear}</td><td>${money(last.cumCall)}</td><td>${money(last.cumDist)}</td><td>${multiple(v.kpi.tvpi)}</td>`
        : `<td colspan="4" class="muted">${escapeHtml(output.errors.map((e) => e.message).join(', ') || '범위 없음')}</td>`;
      return `<tr class="${applied ? 'applied' : ''}">
        <td>${escapeHtml(label(preset.irrShift, preset.moicShift))}</td>${cells}
        <td><button type="button" class="text-btn" data-preset="${preset.key}"${applied ? ' disabled' : ''}>${applied ? '적용 중' : '전 자산군 적용'}</button></td>
      </tr>`;
    })
    .join('');
  return `<section class="panel">
    <h2>5개 시나리오 비교 <span class="muted">전 자산군 동시 적용 (8장, 3.3-A) · 인쇄본과 같은 구성 · 최대 종료 연도 ${c.scenarios.maxEndYear}</span></h2>
    <div class="table-wrap"><table class="data-table scenario-table">
      <thead><tr><th>시나리오</th><th>종료 연도</th><th>최종 누적 Call</th><th>최종 누적 Distribution</th><th>기준일 TVPI</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

function renderAssumptions(): string {
  const items: [string, string][] = [
    ['계산 단위', '연 단위. 약정·집행·관리보수는 매년 1월 1일 발생 (원문 가정 1·2)'],
    ['집행', '약정금을 집행기간 동안 매년 균등 집행. XXX(직접투자)는 2024년 1월 1일 전액 집행 (가정 2·6)'],
    ['가치 상승', '집행분 가치 = 집행액 × (1 + gIRR)^(경과 연수) (가정 3)'],
    ['회수', 't* = ln(MoIC) / ln(1 + IRR). 회수 시각 = 투자 연도 + t*, 회수 연도 = ⌊회수 시각⌋, 회수 총액 = 집행액 × MoIC (가정 4)'],
    ['관리보수', '약정액 기준, 집행기간 2%, 이후 1%. Vintage부터 해당 펀드 마지막 회수 연도까지. 약정액과 별도 Capital Call (가정 5, 3.4)'],
    ['성과보수', '회수 시점에 (회수 총액 − 원금) × 20%. 허들·캐치업 없음. 직접투자는 보수 없음 (가정 5)'],
    ['Distribution', '회수 총액 − 성과보수'],
    ['NAV', 'Gross: 미회수 집행분 평가가치 합. Net 옵션: 미실현 이익 × 20% 차감, 직접투자 제외 (3.5)'],
    ['누적 기준', '2015년(DDD VI 약정)부터 누적, 표시는 2017년부터 (가정 9, 3.1-5·6)'],
    ['시간축', 'NAV는 연말 값 막대, 누적 Call·Distribution은 실제 발생 시각의 계단형 선 (3.1-7)'],
    ['실현/추정', '기준일 이전 실현(채움·실선), 이후 추정(빗금·점선). 인쇄본은 2026-09-30 고정 (원문 "2026년 9월", 3.2)'],
    ['민감도', 'IRR ±3%p 가감, MoIC ±20% 상대 변동 (설정에서 해석 전환). 3%p·20% 단위 −2~+2단계. IRR·MoIC 동시 조정 가능 (3.3)'],
    ['XXX 연동', 'PE 조정을 XXX(직접투자)에도 같은 폭 적용, 설정에서 분리 가능 (3.3-4)'],
    ['조정 하한', 'IRR′ ≥ 1%, MoIC′ > 1.0x. 위반 단계는 비활성화 — 손실 케이스의 성과보수 규칙이 원문에 없음 (3.3-C)'],
    ['시나리오 비교', '인쇄용 5개 시나리오는 전 자산군 동시 적용 (8장, 3.3-A)'],
  ];
  return `<details class="panel assumptions" data-panel="assumptions">
    <summary><h2>가정 명세</h2><span class="muted">원문 가정과 해석 결정 (DESIGN.md 3장)</span></summary>
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
  return `
    ${renderControls(out, state)}
    ${sensitivity}
    ${renderKpi(view, out, baseView?.kpi ?? null, state.settings.navBasis === 'gross' ? 'Gross' : 'Net')}
    <section class="panel chart-panel">
      <h2>${escapeHtml(view.title)} <span class="muted">${view.startYear}~${xEndYear} · NAV / 누적 Capital Call / 누적 Distribution${baseView ? ' · 회색 = 기본 가정' : ''}</span></h2>
      ${renderLegend(baseView !== null)}
      <div class="chart-wrap">${renderMainChart(view, out.meta, chartOpts)}<div class="chart-tooltip" hidden></div></div>
    </section>
    ${renderScenarioTable(c, state)}
    ${renderYearTable(view, out)}
    ${renderTrancheTable(view, out, base)}
    ${renderAssumptions()}`;
}

/** 대시보드 마운트: 입력이 바뀔 때마다 엔진을 다시 실행해 전체를 그린다 (엔진 계산은 수 ms) */
export function mountApp(root: HTMLElement, portfolio: Portfolio, initial: ViewState): void {
  let state: ViewState = { ...initial };
  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `<h1>대체투자 현금흐름 시뮬레이션</h1>
    <p>KIC 대체자산 포트폴리오 12개 펀드 · 약정 $3,000mn · 2017년부터 완전 회수까지 NAV, 누적 Capital Call·Distribution</p>`;
  const body = document.createElement('div');
  root.replaceChildren(header, body);

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
