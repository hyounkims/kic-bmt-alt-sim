// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mountApp, initialState } from '../src/ui/app';
import { renderPrintView } from '../src/ui/print/printView';
import { mockPortfolio } from './fixtures';

// M5 인쇄 뷰 (DESIGN.md 10.2 v0.5)
function printRoot(): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = renderPrintView(mockPortfolio());
  const root = div.querySelector<HTMLElement>('.print-root');
  if (!root) throw new Error('print-root 없음');
  return root;
}

const yearLabels = (page: Element, cell = 0) =>
  [...(page.querySelectorAll('.print-cell')[cell]?.querySelectorAll('.year-tick') ?? [])].length;

describe('인쇄 뷰', () => {
  const root = printRoot();
  const pages = [...root.querySelectorAll('.print-page')];

  it('2페이지, 페이지당 소형 차트 6개(2행 × 3열), 요약 표 5행', () => {
    expect(pages).toHaveLength(2);
    for (const p of pages) {
      expect(p.querySelectorAll('.print-row')).toHaveLength(2);
      expect(p.querySelectorAll('.print-cell svg.main-chart.compact')).toHaveLength(6);
      expect(p.querySelectorAll('.print-summary tbody tr')).toHaveLength(5);
    }
    expect(pages[0]?.querySelector('h1')?.textContent).toContain('대체 포트폴리오 전체');
    expect(pages[1]?.querySelector('h1')?.textContent).toContain('AAA VII');
  });

  it('x축: 1페이지 2017~2033, 2페이지 2020~2033 (최대 endYear, v0.4 확정)', () => {
    const svg1 = pages[0]?.querySelector('svg.main-chart');
    const svg2 = pages[1]?.querySelector('svg.main-chart');
    expect([svg1?.getAttribute('data-x0'), svg1?.getAttribute('data-x1')]).toEqual(['2017', '2034']);
    expect([svg2?.getAttribute('data-x0'), svg2?.getAttribute('data-x1')]).toEqual(['2020', '2034']);
    expect(yearLabels(pages[0]!)).toBe(18); // 2017~2033 연도 경계 + 끝
  });

  it('페이지 안 6개 차트의 y축 눈금이 같음 (공통 축)', () => {
    for (const p of pages) {
      const axes = [...p.querySelectorAll('.print-cell svg')].map((svg) =>
        [...svg.querySelectorAll('.axis-label')].map((t) => t.textContent).filter((t) => t && !/^20\d\d$/.test(t)).join(','),
      );
      expect(new Set(axes).size).toBe(1);
    }
  });

  it('기준일 2026-09-30 고정: 2025까지 채움, 2026부터 빗금 (모든 차트)', () => {
    for (const cell of root.querySelectorAll('.print-cell')) {
      const real = [...cell.querySelectorAll('.bar-real')].map((b) => Number(b.getAttribute('data-year')));
      const est = [...cell.querySelectorAll('.bar-est')].map((b) => Number(b.getAttribute('data-year')));
      expect(Math.max(...real)).toBeLessThanOrEqual(2025);
      expect(Math.min(...est)).toBeGreaterThanOrEqual(2026);
    }
  });

  it('1페이지 실무 모드: 실현 막대·실현 실선이 5개 시나리오 모두 기본과 같음 (MoIC −20% 기준일 직후 회수 포함, v0.6)', () => {
    const p = pages[0]!;
    expect(p.getAttribute('data-mode')).toBe('forward');
    const realized = (key: string) => {
      const cell = p.querySelector(`.print-cell[data-scenario="${key}"]`);
      const bars = [...(cell?.querySelectorAll('.bar-real') ?? [])].map((b) => b.getAttribute('d'));
      const lines = [...(cell?.querySelectorAll('.line:not(.line-est):not(.key)') ?? [])].map((l) => l.getAttribute('d'));
      return [...bars, ...lines].join('|');
    };
    const base = realized('base');
    expect(base.length).toBeGreaterThan(0);
    for (const key of ['irrDown', 'irrUp', 'moicDown', 'moicUp']) expect(realized(key), key).toBe(base);
  });

  it('2페이지 전 구간 모드 명기, 마지막 회수 시각으로 IRR 회수기간 변동 표시 (12장 PE t*)', () => {
    const p = pages[1]!;
    expect(p.getAttribute('data-mode')).toBe('full');
    expect(p.querySelector('.print-head p')?.textContent).toContain('전 구간 재계산');
    const lastExit = [...p.querySelectorAll('.print-summary td.last-exit')].map((td) => td.textContent);
    // 기본 2023 + 4.19, IRR −3%p 2023 + 4.96, IRR +3%p 2023 + 3.64
    expect(lastExit.slice(0, 3)).toEqual(['2027.19', '2027.96', '2026.64']);
  });

  it('1페이지 요약 표에도 마지막 회수 시각 열', () => {
    expect(pages[0]?.querySelectorAll('.print-summary td.last-exit')).toHaveLength(5);
    expect(pages[0]?.querySelector('.print-summary thead')?.textContent).not.toContain('TVPI');
  });

  it('패턴 id가 차트마다 고유', () => {
    const ids = [...root.querySelectorAll('pattern')].map((pt) => pt.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('인쇄 뷰는 화면 상태와 독립', () => {
  it('화면 기준일을 바꿔도 인쇄 기준일은 2026-09-30', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    mountApp(root, mockPortfolio(), initialState({ kind: 'total' }, '2030-06-30'));
    expect(root.querySelector('.print-root .print-head p')?.textContent).toContain('기준일 2026-09-30');
    expect(root.querySelector('.screen-root .kpi-caption')?.textContent).toContain('2030-06-30');
  });
});
