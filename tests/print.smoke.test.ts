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

  it('실무 모드: 기준일 이전 실현 막대는 5개 시나리오 모두 기본과 같음', () => {
    for (const p of pages) {
      const realBars = (key: string) =>
        [...(p.querySelector(`.print-cell[data-scenario="${key}"]`)?.querySelectorAll('.bar-real') ?? [])].map((b) => b.getAttribute('d')).join('|');
      const base = realBars('base');
      expect(base.length).toBeGreaterThan(0);
      for (const key of ['irrDown', 'irrUp', 'moicDown', 'moicUp']) expect(realBars(key), key).toBe(base);
    }
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
