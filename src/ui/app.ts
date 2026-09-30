// 기본 대시보드 (M3, DESIGN.md 10.1). 상태 → 입력 → simulate → 출력 렌더링.
// 계산은 엔진이 하고, 여기서는 출력 객체를 고르고 서식화만 한다.

import { DEFAULT_OPTIONS, ZERO_SCENARIO } from '../engine/constants';
import { simulate } from '../engine/simulate';
import { isValidIsoDate } from '../engine/time';
import { ASSET_CLASSES, type Portfolio, type SimError, type SimOutput } from '../engine/types';
import { bindChartTooltip, renderMainChart } from './charts/mainChart';
import { escapeHtml, money, multiple, pct, PHASE_LABEL, yearTime } from './format';
import { CLASS_LABEL, parseScopeKey, scopeKey, selectScope, type Scope, type ScopedView } from './scope';

export interface ViewState {
  scope: Scope;
  asOf: string;
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

function renderKpi(view: ScopedView, out: SimOutput): string {
  const k = view.kpi;
  const card = (label: string, value: string, note: string) =>
    `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-note">${note}</div></div>`;
  return `<section class="kpi-row" aria-label="기준일 KPI">
    ${card('누적 Capital Call', money(k.cumCall), '$mn · 투자 + 관리보수')}
    ${card('누적 Distribution', money(k.cumDist), '$mn · 순회수 (성과보수 차감)')}
    ${card('NAV', money(k.nav), '$mn · 기준일 평가가치')}
    ${card('DPI', multiple(k.dpi), 'Distribution ÷ Call')}
    ${card('TVPI', multiple(k.tvpi), '(Distribution + NAV) ÷ Call')}
    <p class="kpi-caption">기준일 ${escapeHtml(out.meta.asOf)} (연 소수 시각 ${yearTime(out.meta.asOfTime)}) 시점 · 진행 연도 ${out.meta.asOfYear}</p>
  </section>`;
}

function renderLegend(): string {
  return `<div class="legend" aria-hidden="true">
    <span><i class="sw sw-nav"></i>연말 NAV (실현)</span>
    <span><i class="sw sw-nav-est"></i>연말 NAV (추정)</span>
    <span><i class="ln ln-call"></i>누적 Capital Call</span>
    <span><i class="ln ln-dist"></i>누적 Distribution</span>
    <span><i class="ln ln-est"></i>점선 = 기준일 이후 추정</span>
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

function renderTrancheTable(view: ScopedView, out: SimOutput): string {
  const names = new Map(out.funds.map((f) => [f.id, f.name]));
  const rows = [...view.tranches]
    .sort((a, b) => (names.get(a.fundId) ?? '').localeCompare(names.get(b.fundId) ?? '') || a.investYear - b.investYear)
    .map((t) => {
      const done = t.exitTime <= out.meta.asOfTime;
      return `<tr class="${done ? 'exited' : ''}">
        <td>${escapeHtml(names.get(t.fundId) ?? t.fundId)}</td><td>${t.investYear}</td><td>${money(t.amount)}</td>
        <td>${pct(t.irr)}</td><td>${multiple(t.moic)}</td><td>${t.tStar.toFixed(2)}</td>
        <td>${yearTime(t.exitTime)}</td><td>${t.exitYear}</td>
        <td>${money(t.exitGross)}</td><td>${money(t.carry)}</td><td>${money(t.exitNet)}</td>
        <td>${done ? '회수 완료' : '보유'}</td>
      </tr>`;
    })
    .join('');
  return `<section class="panel">
    <h2>집행분 상세 <span class="muted">($mn)</span></h2>
    <div class="table-wrap"><table class="data-table tranche-table">
      <thead><tr><th>펀드</th><th>투자 연도</th><th>집행액</th><th>IRR</th><th>MoIC</th><th>t* (년)</th><th>회수 시각</th><th>회수 연도</th><th>회수 총액</th><th>성과보수</th><th>순회수</th><th>기준일 상태</th></tr></thead>
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
    ['NAV', 'Gross: 미회수 집행분 평가가치 합 (3.5)'],
    ['누적 기준', '2015년(DDD VI 약정)부터 누적, 표시는 2017년부터 (가정 9, 3.1-5·6)'],
    ['시간축', 'NAV는 연말 값 막대, 누적 Call·Distribution은 실제 발생 시각의 계단형 선 (3.1-7)'],
    ['실현/추정', '기준일 이전 실현(채움·실선), 이후 추정(빗금·점선). 인쇄본은 2026-09-30 고정 (원문 "2026년 9월", 3.2)'],
  ];
  return `<details class="panel assumptions">
    <summary><h2>가정 명세</h2><span class="muted">원문 가정과 해석 결정 (DESIGN.md 3장)</span></summary>
    <dl>${items.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
  </details>`;
}

export function renderDashboard(out: SimOutput, state: ViewState): string {
  if (out.errors.length > 0) return renderErrors(out.errors);
  const view = selectScope(out, state.scope);
  if (!view) return renderErrors([{ code: 'SCOPE', message: `보기 범위를 찾을 수 없음: ${scopeKey(state.scope)}` }]);
  return `
    ${renderControls(out, state)}
    ${renderKpi(view, out)}
    <section class="panel chart-panel">
      <h2>${escapeHtml(view.title)} <span class="muted">${view.startYear}~${view.endYear} · NAV / 누적 Capital Call / 누적 Distribution</span></h2>
      ${renderLegend()}
      <div class="chart-wrap">${renderMainChart(view, out.meta, { idPrefix: 'main' })}<div class="chart-tooltip" hidden></div></div>
    </section>
    ${renderYearTable(view, out)}
    ${renderTrancheTable(view, out)}
    ${renderAssumptions()}`;
}

/** 대시보드 마운트: 입력이 바뀔 때마다 simulate를 다시 실행해 전체를 그린다 (엔진 계산은 수 ms) */
export function mountApp(root: HTMLElement, portfolio: Portfolio, initial: ViewState): void {
  const state: ViewState = { ...initial };
  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `<h1>대체투자 현금흐름 시뮬레이션</h1>
    <p>KIC 대체자산 포트폴리오 12개 펀드 · 약정 $3,000mn · 2017년부터 완전 회수까지 NAV, 누적 Capital Call·Distribution</p>`;
  const body = document.createElement('div');
  root.replaceChildren(header, body);

  const render = () => {
    const out = simulate({ portfolio, scenario: ZERO_SCENARIO, options: { ...DEFAULT_OPTIONS, asOf: state.asOf } });
    body.innerHTML = renderDashboard(out, state);
    const view = out.errors.length === 0 ? selectScope(out, state.scope) : null;
    const chart = body.querySelector<HTMLElement>('.chart-wrap');
    if (chart && view) bindChartTooltip(chart, view.series);

    body.querySelector<HTMLSelectElement>('#scope-select')?.addEventListener('change', (e) => {
      state.scope = parseScopeKey((e.target as HTMLSelectElement).value);
      history.replaceState(null, '', `#${scopeKey(state.scope)}`);
      render();
    });
    body.querySelector<HTMLInputElement>('#asof-input')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLInputElement).value;
      if (isValidIsoDate(v)) {
        state.asOf = v;
        render();
      }
    });
  };
  render();
}
