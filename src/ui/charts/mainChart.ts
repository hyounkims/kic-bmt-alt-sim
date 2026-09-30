// 메인 차트 (10.1, 10.3): NAV 연도별 막대 + 누적 Call·Distribution 계단형 선.
// 실현/추정 표현 (3.2): 기준일 이전 채움·실선, 이후 빗금·점선, 기준일 이후 배경 빗금.
// 출력 객체만 참조한다. 여기서는 좌표 변환·눈금 등 표시 계산만 한다.

import type { Meta, SeriesPoint, StepPoint } from '../../engine/types';
import { escapeHtml, money, PHASE_LABEL } from '../format';
import type { ScopedView } from '../scope';

export interface ChartOptions {
  /** SVG 내부 id 접두사 (한 페이지에 여러 차트를 둘 때 패턴 id 충돌 방지) */
  readonly idPrefix: string;
  /** x축 끝 연도 (기본: 보기 범위의 마지막 회수 연도). 8장 비교 차트는 시나리오 최대 endYear로 통일 */
  readonly xEndYear?: number;
  readonly width?: number;
  readonly height?: number;
  /** 기본 가정 누적선 (조정이 있을 때 회색 비교선, 10.1 v0.4) */
  readonly baseline?: readonly StepPoint[];
  /** y축 기준 최댓값. 여러 차트의 공통 축에 사용 (10.2) */
  readonly yMaxValue?: number;
  /** 소형 차트: 여백·라벨 축소 (10.2 인쇄) */
  readonly compact?: boolean;
  /** y축 숫자·단위 표시 (기본 true). 공통 축 소형 차트는 첫 열만 (10.2 v0.8) */
  readonly yLabels?: boolean;
  /** 기준일 선 옆 "실현/추정" 글자 (기본 true). 소형 차트는 첫 열만 (10.2 v0.8) */
  readonly asOfText?: boolean;
  /** 마지막 실현 연도 NAV 막대 위 값 라벨 (기본: 소형 차트가 아니면 true, 10.3 v0.8) */
  readonly valueLabel?: boolean;
}

const MARGIN = { top: 48, right: 112, bottom: 34, left: 60 };
const MARGIN_COMPACT = { top: 24, right: 84, bottom: 22, left: 44 };

/** 1·2·2.5·5 × 10^k 단위의 보기 좋은 눈금 */
/**
 * 보기 좋은 눈금 (10.3 v0.8): 1·2·2.5·5 × 10^k 단위 중 눈금 칸 수가 minSteps~maxSteps이고
 * 최댓값에 가장 가까운(위 여백이 가장 작은) 단위를 고른다. 예) 6,117 → 0~7,000 (1,000 단위)
 */
export function niceTicks(max: number, minSteps = 4, maxSteps = 7): number[] {
  if (!(max > 0)) return [0];
  const mag = 10 ** Math.floor(Math.log10(max));
  let best: { step: number; top: number } | null = null;
  for (const m of [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10]) {
    const step = m * mag;
    const n = Math.ceil(max / step - 1e-9);
    if (n < minSteps || n > maxSteps) continue;
    const top = n * step;
    if (!best || top < best.top || (top === best.top && step > best.step)) best = { step, top };
  }
  const step = best?.step ?? mag;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** 시각 t에 유효한 누적값: t 이하 마지막 점 (없으면 0) */
function valueAt(steps: readonly StepPoint[], t: number, key: 'cumCall' | 'cumDist'): number {
  let v = 0;
  for (const p of steps) {
    if (p.time > t) break;
    v = p[key];
  }
  return v;
}

/** x 범위 [x0, x1]에서 차트가 담아야 할 최댓값 (NAV·누적 Call·Distribution, 비교선 포함) */
export function chartMaxValue(view: ScopedView, x0: number, x1: number, baseline: readonly StepPoint[] = []): number {
  const endYear = x1 - 1;
  return Math.max(
    0,
    ...view.series.filter((p) => p.year >= x0 && p.year <= endYear).map((p) => p.nav),
    ...[...view.steps, ...baseline].filter((p) => p.time <= x1).map((p) => Math.max(p.cumCall, p.cumDist)),
    valueAt(view.steps, x0, 'cumCall'),
    valueAt(view.steps, x0, 'cumDist'),
  );
}

export function renderMainChart(view: ScopedView, meta: Meta, opts: ChartOptions): string {
  const M = opts.compact ? MARGIN_COMPACT : MARGIN;
  const W = opts.width ?? 960;
  const H = opts.height ?? 400;
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;
  const x0 = view.startYear;
  const endYear = opts.xEndYear ?? view.endYear;
  const x1 = endYear + 1;
  const tau = meta.asOfTime;
  const id = (s: string) => `${opts.idPrefix}-${s}`;

  const bars = view.series.filter((p) => p.year >= x0 && p.year <= endYear);
  const ticks = niceTicks(opts.yMaxValue ?? chartMaxValue(view, x0, x1, opts.baseline));
  const yMax = ticks[ticks.length - 1] ?? 1;

  const x = (t: number) => M.left + ((t - x0) / (x1 - x0)) * pw;
  const y = (v: number) => M.top + ph - (v / (yMax || 1)) * ph;
  const f = (n: number) => n.toFixed(1);

  const parts: string[] = [];

  // 패턴: 기준일 이후 배경 빗금, 추정 NAV 막대 빗금
  parts.push(`<defs>
    <pattern id="${id('hatch-bg')}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="8" class="hatch-bg-line" stroke-width="3"/>
    </pattern>
    <pattern id="${id('hatch-nav')}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" class="hatch-nav-bg"/>
      <line x1="0" y1="0" x2="0" y2="6" class="hatch-nav-line" stroke-width="2.5"/>
    </pattern>
  </defs>`);

  // 기준일 이후 영역 배경 빗금
  const tauClamped = Math.min(Math.max(tau, x0), x1);
  if (tau < x1) {
    parts.push(`<rect class="future-bg" x="${f(x(tauClamped))}" y="${M.top}" width="${f(x(x1) - x(tauClamped))}" height="${ph}" fill="url(#${id('hatch-bg')})"/>`);
  }

  // 가로 눈금선 + y축 라벨
  const showY = opts.yLabels !== false;
  for (const v of ticks) {
    parts.push(`<line class="grid" x1="${M.left}" x2="${M.left + pw}" y1="${f(y(v))}" y2="${f(y(v))}"/>`);
    if (showY) parts.push(`<text class="axis-label" x="${M.left - 8}" y="${f(y(v) + 4)}" text-anchor="end">${money(v).replace(/\.0$/, '')}</text>`);
  }
  if (showY) parts.push(`<text class="axis-unit" x="${M.left - 8}" y="${M.top - 14}" text-anchor="end">$mn</text>`);

  // 연도 경계(1월 1일)와 연도 라벨
  for (let yr = x0; yr <= endYear; yr++) {
    parts.push(`<line class="year-tick" x1="${f(x(yr))}" x2="${f(x(yr))}" y1="${M.top + ph}" y2="${M.top + ph + 5}"/>`);
    // 소형 차트는 격년 라벨 (겹침 방지)
    if (!opts.compact || (yr - x0) % 2 === 0) {
      parts.push(`<text class="axis-label" x="${f(x(yr + 0.5))}" y="${M.top + ph + (opts.compact ? 16 : 20)}" text-anchor="middle">${yr}</text>`);
    }
  }
  parts.push(`<line class="year-tick" x1="${f(x(x1))}" x2="${f(x(x1))}" y1="${M.top + ph}" y2="${M.top + ph + 5}"/>`);

  // NAV 막대: 연말 시각(y + 1) ≤ 기준일이면 채움(실현), 아니면 빗금(추정)
  const radius = 3;
  for (const p of bars) {
    if (p.nav <= 0) continue;
    const bx = x(p.year + 0.2);
    const bw = x(p.year + 0.8) - bx;
    const top = y(p.nav);
    const base = y(0);
    const r = Math.min(radius, bw / 2, base - top);
    const d = `M${f(bx)},${f(base)}V${f(top + r)}Q${f(bx)},${f(top)} ${f(bx + r)},${f(top)}H${f(bx + bw - r)}Q${f(bx + bw)},${f(top)} ${f(bx + bw)},${f(top + r)}V${f(base)}Z`;
    const realized = p.year + 1 <= tau;
    parts.push(
      realized
        ? `<path class="bar bar-real" data-year="${p.year}" d="${d}"/>`
        : `<path class="bar bar-est" data-year="${p.year}" d="${d}" fill="url(#${id('hatch-nav')})"/>`,
    );
  }
  parts.push(`<line class="baseline" x1="${M.left}" x2="${M.left + pw}" y1="${f(y(0))}" y2="${f(y(0))}"/>`);

  // 선택적 값 라벨: 마지막 실현 연도 막대 위 (10.3 v0.8)
  if (opts.valueLabel ?? !opts.compact) {
    const lastReal = [...bars].reverse().find((p) => p.nav > 0 && p.year + 1 <= tau);
    if (lastReal) {
      parts.push(`<text class="bar-value" x="${f(x(lastReal.year + 0.5))}" y="${f(y(lastReal.nav) - 7)}" text-anchor="middle">${Math.round(lastReal.nav).toLocaleString('en-US')}</text>`);
    }
  }

  // 계단형 누적선: 기준일 이전 실선, 이후 점선
  const stepPath = (key: 'cumCall' | 'cumDist', a: number, b: number, steps: readonly StepPoint[] = view.steps): string => {
    let d = `M${f(x(a))},${f(y(valueAt(steps, a, key)))}`;
    for (const p of steps) {
      if (p.time <= a || p.time > b) continue;
      d += `H${f(x(p.time))}V${f(y(p[key]))}`;
    }
    return `${d}H${f(x(b))}`;
  };
  if (opts.baseline) {
    for (const key of ['cumCall', 'cumDist'] as const) {
      parts.push(`<path class="line line-base line-base-${key === 'cumCall' ? 'call' : 'dist'}" d="${stepPath(key, x0, x1, opts.baseline)}"/>`);
    }
  }
  for (const key of ['cumCall', 'cumDist'] as const) {
    const cls = key === 'cumCall' ? 'line-call' : 'line-dist';
    if (tau > x0) parts.push(`<path class="line ${cls}" d="${stepPath(key, x0, Math.min(tau, x1))}"/>`);
    if (tau < x1) parts.push(`<path class="line ${cls} line-est" d="${stepPath(key, Math.max(tau, x0), x1)}"/>`);
  }

  // 기준일 선
  if (tau >= x0 && tau <= x1) {
    const tx = x(tau);
    parts.push(`<line class="asof-line" x1="${f(tx)}" x2="${f(tx)}" y1="${opts.compact ? M.top - 18 : M.top - 24}" y2="${M.top + ph}"/>`);
    if (opts.asOfText !== false) parts.push(`<text class="asof-label" x="${f(tx - 4)}" y="${M.top - 6}" text-anchor="end">◀ 실현</text>`);
    if (opts.asOfText !== false) parts.push(`<text class="asof-label" x="${f(tx + 4)}" y="${M.top - 6}">추정 ▶</text>`);
    if (!opts.compact) parts.push(`<text class="asof-date" x="${f(tx)}" y="${M.top - 30}" text-anchor="middle">기준일 ${escapeHtml(meta.asOf)}</text>`);
  }

  // 선 끝 직접 라벨 (값이 가까우면 겹치지 않게 벌림)
  const endCall = valueAt(view.steps, x1, 'cumCall');
  const endDist = valueAt(view.steps, x1, 'cumDist');
  let yc = y(endCall);
  let yd = y(endDist);
  const gap = opts.compact ? 22 : 28;
  if (Math.abs(yc - yd) < gap) {
    const mid = (yc + yd) / 2;
    const sign = yc <= yd ? -1 : 1;
    yc = mid + (sign * gap) / 2;
    yd = mid - (sign * gap) / 2;
  }
  const lx = M.left + pw + (opts.compact ? 6 : 10);
  const keyW = opts.compact ? 8 : 12;
  const endFmt = (v: number) => (opts.compact ? Math.round(v).toLocaleString('en-US') : money(v));
  parts.push(`<line class="line-call key" x1="${lx}" x2="${lx + keyW}" y1="${f(yc - 4)}" y2="${f(yc - 4)}"/>`);
  parts.push(`<text class="end-label" x="${lx + keyW + 4}" y="${f(yc)}">Call ${endFmt(endCall)}</text>`);
  parts.push(`<line class="line-dist key" x1="${lx}" x2="${lx + keyW}" y1="${f(yd - 4)}" y2="${f(yd - 4)}"/>`);
  parts.push(`<text class="end-label" x="${lx + keyW + 4}" y="${f(yd)}">Dist ${endFmt(endDist)}</text>`);

  // 호버 영역: 연도 밴드 전체 (막대보다 넓은 히트 영역)
  parts.push(`<rect class="hover-band" x="0" y="${M.top}" width="0" height="${ph}" visibility="hidden"/>`);
  for (let yr = x0; yr <= endYear; yr++) {
    parts.push(`<rect class="hit" data-year="${yr}" x="${f(x(yr))}" y="${M.top}" width="${f(x(yr + 1) - x(yr))}" height="${ph + M.bottom}"/>`);
  }

  const label = `${escapeHtml(view.title)}: ${x0}~${endYear} 연도별 NAV와 누적 Capital Call·Distribution`;
  return `<svg class="main-chart${opts.compact ? ' compact' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}" data-x0="${x0}" data-x1="${x1}">${parts.join('')}</svg>`;
}

/** 호버 툴팁: 연도 밴드에 올리면 그 연도의 값 표시 */
export function bindChartTooltip(container: HTMLElement, series: readonly SeriesPoint[], baseSeries?: readonly SeriesPoint[]): void {
  const svg = container.querySelector<SVGSVGElement>('svg.main-chart');
  const tip = container.querySelector<HTMLDivElement>('.chart-tooltip');
  const band = svg?.querySelector<SVGRectElement>('.hover-band');
  if (!svg || !tip || !band) return;
  const byYear = new Map(series.map((p) => [p.year as number, p]));
  const baseByYear = new Map((baseSeries ?? []).map((p) => [p.year as number, p]));

  const hide = () => {
    tip.hidden = true;
    band.setAttribute('visibility', 'hidden');
  };
  svg.addEventListener('mouseleave', hide);
  svg.addEventListener('mousemove', (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest('.hit') : null;
    const year = Number(target?.getAttribute('data-year'));
    const p = byYear.get(year);
    if (!target || !p) return hide();
    band.setAttribute('x', target.getAttribute('x') ?? '0');
    band.setAttribute('width', target.getAttribute('width') ?? '0');
    band.setAttribute('visibility', 'visible');
    tip.innerHTML = `
      <div class="tt-head">${p.year} <span class="phase phase-${p.phase}">${PHASE_LABEL[p.phase]}</span></div>
      <table>
        <tr><th><i class="sw sw-nav"></i>연말 NAV</th><td>${money(p.nav)}</td></tr>
        <tr><th><i class="sw sw-call"></i>누적 Capital Call</th><td>${money(p.cumCall)}</td></tr>
        <tr><th><i class="sw sw-dist"></i>누적 Distribution</th><td>${money(p.cumDist)}</td></tr>
        <tr class="sub"><th>당해 투자 Call</th><td>${money(p.callInvest)}</td></tr>
        <tr class="sub"><th>당해 관리보수</th><td>${money(p.callFee)}</td></tr>
        <tr class="sub"><th>당해 Distribution</th><td>${money(p.dist)}</td></tr>
        ${(() => {
          const b = baseByYear.get(year);
          return b
            ? `<tr class="base"><th>기본 가정 연말 NAV</th><td>${money(b.nav)}</td></tr>
               <tr class="base"><th>기본 가정 누적 Call</th><td>${money(b.cumCall)}</td></tr>
               <tr class="base"><th>기본 가정 누적 Distribution</th><td>${money(b.cumDist)}</td></tr>`
            : '';
        })()}
      </table>`;
    tip.hidden = false;
    const box = container.getBoundingClientRect();
    const px = ev.clientX - box.left;
    const left = px + 16 + tip.offsetWidth > box.width ? px - 16 - tip.offsetWidth : px + 16;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, ev.clientY - box.top - 20)}px`;
  });
}
