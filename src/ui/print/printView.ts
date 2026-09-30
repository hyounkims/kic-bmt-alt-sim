// 인쇄 뷰 (DESIGN.md 10.2, v0.5): A4 가로 2페이지, 페이지당 2행 × 3열 소형 차트 + 시나리오 요약 표.
// 화면 상태와 독립: 기준일 2026-09-30 고정, 실무 모드, 해석 기본값, 8장 5개 시나리오(전 자산군 동시).

import { DEFAULT_OPTIONS, PRINT_AS_OF, ZERO_SCENARIO } from '../../engine/constants';
import { runScenarios, type ScenarioKey, type ScenarioRuns } from '../../engine/scenarios';
import type { Portfolio, SensitivityMode, SimInput } from '../../engine/types';
import { chartMaxValue, renderMainChart } from '../charts/mainChart';
import { escapeHtml, money, yearTime } from '../format';
import { selectScope, type Scope, type ScopedView } from '../scope';

/** 인쇄 전용 입력 (10.2 v0.5·v0.6): 기준일 고정, 해석 기본값, 페이지별 민감도 모드 */
export function printInput(portfolio: Portfolio, sensitivityMode: SensitivityMode): SimInput {
  return { portfolio, scenario: ZERO_SCENARIO, options: { ...DEFAULT_OPTIONS, asOf: PRINT_AS_OF, sensitivityMode } };
}

/** 2행 × 3열: 행 IRR / MoIC, 열 하향 / 기본 / 상향 */
const GRID: readonly { readonly row: string; readonly cells: readonly [ScenarioKey, string][] }[] = [
  { row: 'IRR', cells: [['irrDown', 'IRR −3%p'], ['base', '기본'], ['irrUp', 'IRR +3%p']] },
  { row: 'MoIC', cells: [['moicDown', 'MoIC −20%'], ['base', '기본'], ['moicUp', 'MoIC +20%']] },
];

interface PageSpec {
  readonly no: number;
  readonly scope: Scope;
  readonly heading: string;
  readonly mode: SensitivityMode;
  readonly modeNote: string;
}

const PAGES: readonly PageSpec[] = [
  {
    no: 1,
    scope: { kind: 'total' },
    heading: '대체 포트폴리오 전체',
    mode: 'forward',
    modeNote: '실무 모드: 기준일 이전 실현 구간은 모든 시나리오 동일, 이후만 재계산',
  },
  {
    no: 2,
    scope: { kind: 'fund', id: 'AAA_VII' },
    heading: 'PE 포트폴리오 AAA VII',
    mode: 'full',
    modeNote: '전 구간 재계산: 회수기간 변동을 보이기 위해 기준일 이전도 가정에 따라 재계산 (집행분 4개 중 3개가 기준일 전 회수)',
  },
];

function legend(): string {
  return `<div class="legend print-legend">
    <span><i class="sw sw-nav"></i>연말 NAV (실현)</span>
    <span><i class="sw sw-nav-est"></i>연말 NAV (추정, 빗금)</span>
    <span><i class="ln ln-call ln-print-call"></i>누적 Capital Call (굵은 선)</span>
    <span><i class="ln ln-dist"></i>누적 Distribution (가는 선)</span>
    <span><i class="ln ln-est"></i>점선 = 기준일 이후 추정</span>
  </div>`;
}

function summaryTable(runs: ScenarioRuns, scope: Scope): string {
  const rows = runs.runs
    .map(({ preset, output }) => {
      const v = output.errors.length === 0 ? selectScope(output, scope) : null;
      const last = v?.series.filter((p) => p.year <= v.endYear).at(-1);
      return v && last
        ? `<tr><td>${escapeHtml(preset.label)}</td><td>${v.endYear}</td><td class="last-exit">${yearTime(v.lastExitTime)}</td><td>${money(last.cumCall)}</td><td>${money(last.cumDist)}</td></tr>`
        : `<tr><td>${escapeHtml(preset.label)}</td><td colspan="4">${escapeHtml(output.errors.map((e) => e.message).join(', '))}</td></tr>`;
    })
    .join('');
  return `<table class="data-table print-summary">
    <thead><tr><th>시나리오</th><th>종료 연도</th><th>마지막 회수 시각</th><th>최종 누적 Call</th><th>최종 누적 Distribution</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function page(spec: PageSpec, portfolio: Portfolio): string {
  const runs = runScenarios(printInput(portfolio, spec.mode));
  const byKey = new Map(runs.runs.map((r) => [r.preset.key, r.output]));
  const views = new Map<ScenarioKey, ScopedView>();
  for (const [key, out] of byKey) {
    const v = out.errors.length === 0 ? selectScope(out, spec.scope) : null;
    if (v) views.set(key, v);
  }
  const anyView = views.get('base');
  if (!anyView) return `<section class="print-page"><p>인쇄 데이터 오류</p></section>`;
  const x0 = anyView.startYear;
  const xEndYear = runs.maxEndYear;
  // 페이지 공통 y축 (10.2)
  const yMaxValue = Math.max(...[...views.values()].map((v) => chartMaxValue(v, x0, xEndYear + 1)));

  const grid = GRID.map(
    ({ row, cells }) => `<div class="print-row">
      <div class="print-row-label">${row}</div>
      ${cells
        .map(([key, label]) => {
          const out = byKey.get(key);
          const v = views.get(key);
          if (!out || !v) return `<figure class="print-cell"><figcaption>${escapeHtml(label)}</figcaption><p>계산 오류</p></figure>`;
          const chart = renderMainChart(v, out.meta, { idPrefix: `p${spec.no}-${row}-${key}`, xEndYear, yMaxValue, compact: true, width: 400, height: 250 });
          return `<figure class="print-cell${key === 'base' ? ' is-base' : ''}" data-scenario="${key}">
            <figcaption><strong>${escapeHtml(label)}</strong><span>마지막 회수 ${yearTime(v.lastExitTime)}</span></figcaption>
            ${chart}
          </figure>`;
        })
        .join('')}
    </div>`,
  ).join('');

  return `<section class="print-page" data-page="${spec.no}" data-mode="${spec.mode}">
    <header class="print-head">
      <div>
        <h1>${spec.no}. ${escapeHtml(spec.heading)} <span>— IRR·MoIC 민감도 (${x0}년 ~ ${xEndYear}년)</span></h1>
        <p>기준일 ${PRINT_AS_OF} (2026년 9월까지 실현, 이후 추정) · <strong>${escapeHtml(spec.modeNote)}</strong> · 전 자산군 동시 적용 · IRR %p 가감, MoIC 상대 변동 · 단위 $mn</p>
      </div>
      <div class="print-page-no">${spec.no} / ${PAGES.length}</div>
    </header>
    ${legend()}
    <div class="print-grid">${grid}</div>
    <div class="print-bottom">
      ${summaryTable(runs, spec.scope)}
      <div class="print-notes">
        <strong>가정 요약</strong>
        <ul>
          <li>매년 1월 1일 약정·균등 집행, gIRR로 가치 상승, MoIC 달성 시각에 회수 (t* = ln MoIC / ln(1 + IRR))</li>
          <li>관리보수 약정액 기준 집행기간 2% · 이후 1% (별도 Call), 성과보수 회수 시 (회수액 − 원금) × 20%, XXX 직접투자는 보수 없음</li>
          <li>NAV는 연말 Gross 평가가치 막대, 누적 Call·Distribution은 실제 발생 시각의 계단형 선 · 누적은 2015년부터</li>
          <li>${spec.mode === 'forward' ? '실무 모드: 기준일 가치에서 조정 IRR로 성장해 조정 MoIC 도달 시 회수, 이미 초과하면 기준일 직후 회수' : '전 구간 재계산: 모든 집행분을 조정 IRR·MoIC로 투자 시점부터 다시 계산'}</li>
          <li>조정 하한 IRR′ ≥ 1%, MoIC′ &gt; 1.0x</li>
        </ul>
      </div>
    </div>
  </section>`;
}

/** 인쇄용 2페이지 HTML. 화면에서는 숨기고 @media print에서만 보인다 */
export function renderPrintView(portfolio: Portfolio): string {
  return `<div class="print-root" aria-hidden="true">${PAGES.map((p) => page(p, portfolio)).join('')}</div>`;
}
