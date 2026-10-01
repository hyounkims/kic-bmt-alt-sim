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

  it('x축: 1페이지 2017~2033, 2페이지 2020~2028 (각 대상의 시나리오 최대 종료 연도, v0.7)', () => {
    const svg1 = pages[0]?.querySelector('svg.main-chart');
    const svg2 = pages[1]?.querySelector('svg.main-chart');
    expect([svg1?.getAttribute('data-x0'), svg1?.getAttribute('data-x1')]).toEqual(['2017', '2034']);
    expect([svg2?.getAttribute('data-x0'), svg2?.getAttribute('data-x1')]).toEqual(['2020', '2029']);
    expect(yearLabels(pages[0]!)).toBe(18); // 2017~2033 연도 경계 + 끝
  });

  it('공통 y축: 첫 열만 y축 숫자·실현/추정 글자, 나머지 열은 숨김, 열 머리 하향·기본·상향 (v0.8)', () => {
    for (const p of pages) {
      expect([...p.querySelectorAll('.print-colheads span')].map((s) => s.textContent)).toEqual(['', '하향', '기본', '상향']);
      for (const row of p.querySelectorAll('.print-row')) {
        const cells = [...row.querySelectorAll('.print-cell svg')];
        const yLabels = (svg: Element) => [...svg.querySelectorAll('.axis-label')].map((t) => t.textContent).filter((t) => t && !/^20\d\d$/.test(t));
        expect(yLabels(cells[0]!).length).toBeGreaterThan(0);
        expect(yLabels(cells[1]!)).toEqual([]);
        expect(yLabels(cells[2]!)).toEqual([]);
        expect(cells[0]!.querySelectorAll('.asof-label').length).toBeGreaterThan(0);
        expect(cells[2]!.querySelectorAll('.asof-label')).toHaveLength(0);
        expect(cells[2]!.querySelector('.asof-line')).not.toBeNull();
      }
    }
  });

  it('캡션·요약 표에 기본 대비 차이, 기본 행 강조 (v0.8)', () => {
    const p2 = pages[1]!;
    // AAA VII IRR +3%p: 2027 Q1 → 2026 Q3 (2023 + 3.64, 12장) = −2분기
    expect(p2.querySelector('.print-cell[data-scenario="irrUp"] figcaption')?.textContent).toContain('2026 Q3 (−2분기)');
    expect(p2.querySelector('.print-summary tr.is-base td')?.textContent).toBe('기본');
    // MoIC −20%: 보수 30 → 집행분 67.5, 순회수 99.9 × 4 = 399.6, 기본 475.2 대비 −75.6 (손 계산)
    expect(p2.querySelectorAll('.print-summary tbody tr')[3]?.querySelectorAll('td.delta')[1]?.textContent).toBe('−75.6');
  });

  it('기본 기준일 2026-09-30: 2025까지 채움, 2026부터 빗금 (모든 차트)', () => {
    for (const cell of root.querySelectorAll('.print-cell')) {
      const real = [...cell.querySelectorAll('.bar-real')].map((b) => Number(b.getAttribute('data-year')));
      const est = [...cell.querySelectorAll('.bar-est')].map((b) => Number(b.getAttribute('data-year')));
      expect(Math.max(...real)).toBeLessThanOrEqual(2025);
      expect(Math.min(...est)).toBeGreaterThanOrEqual(2026);
    }
  });

  it('가정 요약에 민감도 해석 명기 (v0.7)', () => {
    for (const p of pages) {
      expect(p.querySelector('.print-head p')?.textContent).toContain('민감도는 투자 시점부터 조정 가정으로 재계산');
      expect(p.querySelector('.print-notes')?.textContent).toContain('가상 시나리오');
    }
  });

  it('2페이지 마지막 회수 분기로 IRR 회수기간 변동 표시 (12장 PE t*, v0.9 분기)', () => {
    const p = pages[1]!;
    const lastExit = [...p.querySelectorAll('.print-summary td.last-exit')].map((td) => td.textContent);
    // 기본 2023 + 4.19 → 2027 Q1 (3/10), IRR −3%p 2023 + 4.96 → 2027 Q4 (12/17), IRR +3%p 2023 + 3.64 → 2026 Q3 (8/21)
    // 회수일은 7.3 v0.9.2 규칙으로 독립 계산: 1/1 + ⌊소수부 × 365⌋일
    expect(lastExit.slice(0, 3)).toEqual(['2027 Q1 (3/10)', '2027 Q4 (12/17)', '2026 Q3 (8/21)']);
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

describe('인쇄 기준일 = 화면 기준일, 나머지는 독립 (10.2 v0.9.4)', () => {
  const head = (root: HTMLElement) => root.querySelector('.print-root .print-head p')?.textContent ?? '';
  it('기본 2026-09-30 → 2026 Q3 말까지 실현', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    mountApp(root, mockPortfolio(), initialState({ kind: 'total' }, '2026-09-30'));
    expect(head(root)).toContain('기준일 2026-09-30 (2026 Q3 말까지 실현');
  });
  it('화면 기준일을 바꾸면 인쇄도 그 기준일로 다시 그림 (인쇄 뷰는 하나만)', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    mountApp(root, mockPortfolio(), initialState({ kind: 'total' }, '2026-09-30'));
    const input = root.querySelector<HTMLInputElement>('#asof-input');
    if (!input) throw new Error('기준일 입력 없음');
    input.value = '2030-06-30';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(head(root)).toContain('기준일 2030-06-30 (2030 Q2 말까지 실현');
    expect(root.querySelector('.screen-root .kpi-caption')?.textContent).toContain('2030-06-30');
    expect(root.querySelectorAll('.print-root')).toHaveLength(1);
    // 2030 Q2 말 기준: 2029년 막대까지 채움(실현), 2030년은 빗금
    const p1 = root.querySelector('.print-page[data-page="1"] .print-cell.is-base');
    expect(p1?.querySelector('.bar-real[data-year="2029"]')).not.toBeNull();
    expect(p1?.querySelector('.bar-est[data-year="2030"]')).not.toBeNull();
  });
  it('민감도 조정·보기 범위는 인쇄에 반영하지 않음', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    mountApp(root, mockPortfolio(), initialState({ kind: 'fund', id: 'XXX' }, '2026-09-30'));
    const before = root.querySelector('.print-root')?.innerHTML;
    root.querySelector<HTMLButtonElement>('button[data-class="PE"][data-kind="irr"][data-shift="-0.03"]')?.click();
    expect(root.querySelector('.print-root')?.innerHTML).toBe(before);
    expect(root.querySelector('.print-page[data-page="1"] h1')?.textContent).toContain('대체 포트폴리오 전체');
  });
});

describe('화면 시나리오 표와 인쇄 요약 표 일치 (v0.7)', () => {
  it('기본 해석·전 구간 상태에서 화면 5개 시나리오 수치 = 인쇄 1페이지 요약 수치', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    mountApp(root, mockPortfolio(), initialState({ kind: 'total' }, '2026-09-30'));
    const rows = (sel: string) =>
      [...root.querySelectorAll(`${sel} tbody tr`)].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()).slice(0, 5).join('|'));
    const screen = rows('.screen-root .scenario-table');
    expect(screen).toHaveLength(5);
    expect(screen).toEqual(rows('.print-page[data-page="1"] .print-summary'));
  });
});
