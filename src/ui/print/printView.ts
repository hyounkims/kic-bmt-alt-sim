// 인쇄 뷰 (DESIGN.md 10.2, v0.8): A4 가로 2페이지, 페이지당 2행 × 3열 소형 차트 + 시나리오 요약 표.
// 기준일만 화면을 따르고(기본 2026-09-30, v0.9.4), 그 밖에는 화면 상태와 독립: 해석 기본값, 8장 5개 시나리오(전 자산군 동시).

import { DEFAULT_AS_OF, DEFAULT_OPTIONS, ZERO_SCENARIO } from '../../engine/constants';
import { runScenarios, summarizeScenarios, type ScenarioKey, type ScenarioSummaryRow } from '../../engine/scenarios';
import type { Portfolio, SimInput } from '../../engine/types';
import { chartMaxValue, renderMainChart } from '../charts/mainChart';
import { escapeHtml, exitLabel, money, multiple, pct2, quarterLabel, signedQuarters } from '../format';
import { selectScope, type Scope, type ScopedView } from '../scope';

/** 인쇄 전용 입력 (10.2 v0.9.4): 기준일은 화면 기준일, 해석은 기본값 */
export function printInput(portfolio: Portfolio, asOf: string = DEFAULT_AS_OF): SimInput {
  return { portfolio, scenario: ZERO_SCENARIO, options: { ...DEFAULT_OPTIONS, asOf } };
}

/** 2행 × 3열: 행 IRR / MoIC, 열 하향 / 기본 / 상향 */
const COLUMNS = ['하향', '기본', '상향'] as const;
const GRID: readonly { readonly row: string; readonly cells: readonly [ScenarioKey, string][] }[] = [
  { row: 'IRR', cells: [['irrDown', 'IRR −3%p'], ['base', '기본'], ['irrUp', 'IRR +3%p']] },
  { row: 'MoIC', cells: [['moicDown', 'MoIC −20%'], ['base', '기본'], ['moicUp', 'MoIC +20%']] },
];

interface PageSpec {
  readonly no: number;
  readonly scope: Scope;
  readonly heading: string;
}

const PAGES: readonly PageSpec[] = [
  { no: 1, scope: { kind: 'total' }, heading: '대체 포트폴리오 전체' },
  { no: 2, scope: { kind: 'fund', id: 'AAA_VII' }, heading: 'PE 포트폴리오 AAA VII' },
];

const signed = (v: number, digits: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

function legend(): string {
  return `<div class="legend print-legend">
    <span><i class="sw sw-nav"></i>연말 NAV (실현)</span>
    <span><i class="sw sw-nav-est"></i>연말 NAV (추정, 빗금)</span>
    <span><i class="ln ln-call ln-print-call"></i>누적 Capital Call (굵은 선)</span>
    <span><i class="ln ln-dist"></i>누적 Distribution (가는 선)</span>
    <span><i class="ln ln-est"></i>점선 = 기준일 이후 추정</span>
  </div>`;
}

/** 요약 표: 앞 5열은 화면 시나리오 탭과 같은 순서 (수치 일치 테스트), 이후 기본 대비 차이 */
function summaryTable(rows: readonly ScenarioSummaryRow[]): string {
  const body = rows
    .map((r) =>
      r.errors.length === 0
        ? `<tr class="${r.preset.key === 'base' ? 'is-base' : ''}"><td>${escapeHtml(r.preset.label)}</td><td>${r.endYear}</td><td class="last-exit">${exitLabel(r.lastExitQuarter, r.lastReachDate)}</td><td>${money(r.finalCumCall)}</td><td>${money(r.finalCumDist)}</td>
             <td class="delta">${r.vsBase ? signedQuarters(r.vsBase.lastExitQuarters) : '—'}</td><td class="delta">${r.vsBase ? signed(r.vsBase.finalCumDist, 1) : '—'}</td>
             <td class="net">${pct2(r.netIrr)}</td><td class="net">${multiple(r.netMoic)}</td></tr>`
        : `<tr><td>${escapeHtml(r.preset.label)}</td><td colspan="8">${escapeHtml(r.errors.join(', '))}</td></tr>`,
    )
    .join('');
  return `<table class="data-table print-summary">
    <thead><tr><th>시나리오</th><th>종료 연도</th><th>마지막 회수 (회수일)</th><th>최종 누적 Call</th><th>최종 누적 Distribution</th><th>Δ 마지막 회수</th><th>Δ Distribution</th><th>예상 Net IRR</th><th>예상 Net MoIC</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function page(spec: PageSpec, portfolio: Portfolio, asOf: string): string {
  const runs = runScenarios(printInput(portfolio, asOf));
  const summary = new Map(summarizeScenarios(runs, spec.scope).map((r) => [r.preset.key, r]));
  const byKey = new Map(runs.runs.map((r) => [r.preset.key, r.output]));
  const views = new Map<ScenarioKey, ScopedView>();
  for (const [key, out] of byKey) {
    const v = out.errors.length === 0 ? selectScope(out, spec.scope) : null;
    if (v) views.set(key, v);
  }
  const anyView = views.get('base');
  if (!anyView) return `<section class="print-page"><p>인쇄 데이터 오류</p></section>`;
  const baseMeta = byKey.get('base')?.meta;
  const x0 = anyView.startYear;
  // x축 끝 = 이 페이지 대상의 5개 시나리오 중 최대 종료 연도 (원문 "완전 회수 시점까지", 10.2 v0.7)
  const xEndYear = Math.max(...[...views.values()].map((v) => v.endYear));
  // 페이지 공통 y축 (10.2)
  const yMaxValue = Math.max(...[...views.values()].map((v) => chartMaxValue(v, x0, xEndYear + 1)));

  const grid = GRID.map(
    ({ row, cells }) => `<div class="print-row">
      <div class="print-row-label">${row}</div>
      ${cells
        .map(([key, label], col) => {
          const out = byKey.get(key);
          const v = views.get(key);
          const s = summary.get(key);
          if (!out || !v || !s) return `<figure class="print-cell"><figcaption>${escapeHtml(label)}</figcaption><p>계산 오류</p></figure>`;
          // 공통 축: y축 숫자·실현/추정 글자는 첫 열만 (10.2 v0.8)
          const first = col === 0;
          const chart = renderMainChart(v, out.meta, {
            idPrefix: `p${spec.no}-${row}-${key}`,
            xEndYear,
            yMaxValue,
            compact: true,
            yLabels: first,
            asOfText: first,
            width: 400,
            height: 262,
          });
          const delta = s.vsBase ? ` <em>(${signedQuarters(s.vsBase.lastExitQuarters)})</em>` : '';
          return `<figure class="print-cell${key === 'base' ? ' is-base' : ''}" data-scenario="${key}">
            <figcaption><strong>${escapeHtml(label)}</strong><span>마지막 회수 ${quarterLabel(s.lastExitQuarter)}${delta}</span></figcaption>
            ${chart}
          </figure>`;
        })
        .join('')}
    </div>`,
  ).join('');

  return `<section class="print-page" data-page="${spec.no}">
    <header class="print-head">
      <div>
        <div class="print-eyebrow">Sensitivity Test · IRR / MoIC</div>
        <h1>${spec.no}. ${escapeHtml(spec.heading)} <span>${x0}년 ~ ${xEndYear}년</span></h1>
        <p>기준일 ${escapeHtml(asOf)} (${baseMeta ? `${quarterLabel(baseMeta.asOfQuarter)} 말까지 실현, ` : ''}이후 추정 · 분기 보고 기준) · 민감도는 투자 시점부터 조정 가정으로 재계산 · 전 자산군 동시 적용</p>
        <p>IRR ±3%p 가감 · MoIC ±20% 상대 변동 · 단위 $mn · 굵은 테두리 = 기본 가정 · 괄호 = 기본 대비 마지막 회수 분기 차이</p>
      </div>
      <div class="print-page-no">${spec.no} / ${PAGES.length}</div>
    </header>
    ${legend()}
    <div class="print-colheads"><span></span>${COLUMNS.map((c) => `<span>${c}</span>`).join('')}</div>
    <div class="print-grid">${grid}</div>
    <div class="print-bottom">
      ${summaryTable([...summary.values()])}
      <div class="print-notes">
        <strong>가정 요약</strong>
        <ul>
          <li>매년 1/1 균등 투자, gIRR로 성장, MoIC 도달일 회수(분기 단위 보고)</li>
          <li>관리보수 2%·1%는 약정 안: 투자금 = 약정 − 총보수, 누적 Call = 약정</li>
          <li>성과보수 (회수액 − 원금) × 20%, XXX 보수 없음, Net = 보수 차감 후</li>
          <li>민감도는 투자 시점부터 재계산한 가상 시나리오</li>
        </ul>
      </div>
    </div>
  </section>`;
}

/** 인쇄용 2페이지 HTML. 화면에서는 숨기고 @media print에서만 보인다 */
export function renderPrintView(portfolio: Portfolio, asOf: string = DEFAULT_AS_OF): string {
  return `<div class="print-root" aria-hidden="true" data-as-of="${escapeHtml(asOf)}">${PAGES.map((p) => page(p, portfolio, asOf)).join('')}</div>`;
}
