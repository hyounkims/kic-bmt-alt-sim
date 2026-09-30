// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { mountApp, renderDashboard } from '../src/ui/app';
import { simulate } from '../src/engine/simulate';
import { baseInput, mockPortfolio } from './fixtures';

// M3 화면 구조 스모크 테스트 (실제 simulate 출력으로 렌더링)
function mount(asOf = '2026-09-30') {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  mountApp(root, mockPortfolio(), { scope: { kind: 'total' }, asOf });
  return root;
}

function selectScope(root: HTMLElement, value: string) {
  const sel = root.querySelector<HTMLSelectElement>('#scope-select');
  if (!sel) throw new Error('scope-select 없음');
  sel.value = value;
  sel.dispatchEvent(new Event('change'));
}

describe('기본 대시보드 (전체, 기준일 2026-09-30)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = mount();
  });

  it('KPI 카드 5개', () => {
    expect(root.querySelectorAll('.kpi-card')).toHaveLength(5);
    expect(root.querySelector('.kpi-caption')?.textContent).toContain('진행 연도 2026');
  });

  it('NAV 막대: 2017~2031 15개 (2032 연말 NAV 0), 2025까지 채움·2026부터 빗금', () => {
    const real = [...root.querySelectorAll('.bar-real')].map((b) => Number(b.getAttribute('data-year')));
    const est = [...root.querySelectorAll('.bar-est')].map((b) => Number(b.getAttribute('data-year')));
    expect(real).toEqual([2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
    expect(est).toEqual([2026, 2027, 2028, 2029, 2030, 2031]);
  });

  it('빗금 패턴·기준일 선·실선/점선 누적선 존재', () => {
    expect(root.querySelector('pattern[id="main-hatch-bg"]')).not.toBeNull();
    expect(root.querySelector('pattern[id="main-hatch-nav"]')).not.toBeNull();
    expect(root.querySelector('.future-bg')).not.toBeNull();
    expect(root.querySelector('.asof-date')?.textContent).toBe('기준일 2026-09-30');
    expect(root.querySelectorAll('.line-call.line:not(.line-est)')).toHaveLength(1);
    expect(root.querySelectorAll('.line-call.line-est')).toHaveLength(1);
    expect(root.querySelectorAll('.line-dist.line-est')).toHaveLength(1);
  });

  it('x축 2017~2032, 호버 영역 연도당 1개', () => {
    const labels = [...root.querySelectorAll('.axis-label')].map((t) => t.textContent);
    expect(labels).toContain('2017');
    expect(labels).toContain('2032');
    expect(labels).not.toContain('2016');
    expect(root.querySelectorAll('.hit')).toHaveLength(16);
  });

  it('연도별 표 16행, 2026행은 진행', () => {
    const rows = root.querySelectorAll('.year-table tbody tr');
    expect(rows).toHaveLength(16);
    expect(root.querySelector('.year-table tr.phase-row-current td')?.textContent).toBe('2026');
  });

  it('집행분 표: 전체 51개 집행분 (4+4+4+4+1+5+5+6+6+6+3+3)', () => {
    expect(root.querySelectorAll('.tranche-table tbody tr')).toHaveLength(51);
  });

  it('보기 범위 전환: AAA VII는 약정 2020년부터 완전 회수 2027년까지, 집행분 4개', () => {
    selectScope(root, 'fund:AAA_VII');
    expect(root.querySelector('.chart-panel h2')?.textContent).toContain('AAA VII');
    const years = [...root.querySelectorAll('.year-table tbody tr td:first-child')].map((t) => t.textContent);
    expect(years[0]).toBe('2020');
    expect(years[years.length - 1]).toBe('2027');
    expect(root.querySelectorAll('.hit')).toHaveLength(8);
    expect(root.querySelectorAll('.tranche-table tbody tr')).toHaveLength(4);
    expect(root.querySelector('.kpi-card .kpi-value')?.textContent).toBe('333.0'); // 투자 300 + 보수 2020~23 연 6(24) + 2024~26 연 3(9)
  });

  it('보기 범위 전환: 자산군 PD', () => {
    selectScope(root, 'class:PD');
    expect(root.querySelector('.chart-panel h2')?.textContent).toContain('사모채권 PD');
    expect(root.querySelectorAll('.tranche-table tbody tr')).toHaveLength(6);
  });

  it('기준일 변경: 2030-06-30이면 2029까지 채움', () => {
    const input = root.querySelector<HTMLInputElement>('#asof-input');
    if (!input) throw new Error('asof-input 없음');
    input.value = '2030-06-30';
    input.dispatchEvent(new Event('change'));
    const real = [...root.querySelectorAll('.bar-real')].map((b) => Number(b.getAttribute('data-year')));
    expect(real[real.length - 1]).toBe(2029);
    expect(root.querySelector('.kpi-caption')?.textContent).toContain('진행 연도 2030');
  });
});

describe('오류 표시', () => {
  it('errors가 있으면 오류 패널만 렌더링', () => {
    const out = simulate(baseInput({ options: { asOf: '2026-02-30' } }));
    const div = document.createElement('div');
    div.innerHTML = renderDashboard(out, { scope: { kind: 'total' }, asOf: '2026-02-30' });
    expect(div.querySelector('.error-panel')).not.toBeNull();
    expect(div.querySelector('.main-chart')).toBeNull();
    expect(div.textContent).toContain('AS_OF');
  });
});
