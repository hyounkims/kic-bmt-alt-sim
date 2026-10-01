// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { compute, initialState, mountApp, renderDashboard } from '../src/ui/app';
import { baseInput, mockPortfolio } from './fixtures';
import { runScenarios, summarizeScenarios } from '../src/engine/scenarios';

// M3 화면 구조 스모크 테스트 (실제 simulate 출력으로 렌더링)
function mount(asOf = '2026-09-30') {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  mountApp(root, mockPortfolio(), initialState({ kind: 'total' }, asOf));
  // 화면 영역만 검사 (인쇄 영역은 print.smoke.test.ts)
  const screen = root.querySelector<HTMLElement>('.screen-root');
  if (!screen) throw new Error('screen-root 없음');
  return screen;
}

function selectScope(root: HTMLElement, value: string) {
  const sel = root.querySelector<HTMLSelectElement>('#scope-select');
  if (!sel) throw new Error('scope-select 없음');
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('기본 대시보드 (전체, 기준일 2026-09-30)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = mount();
  });

  it('KPI 카드 5개', () => {
    expect(root.querySelectorAll('.kpi-card')).toHaveLength(5);
    // v0.7: 기준일 NAV와 연말 NAV 구분
    expect([...root.querySelectorAll('.kpi-label')].map((l) => l.textContent)).toContain('기준일 NAV');
    expect(root.querySelector('.year-table thead')?.textContent).toContain('연말 NAV');
    // v0.7: 화면 사용 가이드
    expect(root.querySelector('details[data-panel="guide"] summary')?.textContent).toContain('사용 가이드');
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
    expect(root.querySelector('.asof-date')?.textContent).toBe('기준 2026 Q3 말');
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
    const callCard = [...root.querySelectorAll('.kpi-card')].find((c) => c.querySelector('.kpi-label')?.textContent === '누적 Capital Call');
    // 2026 Q3까지: 투자 66 × 4 + 보수 2020~23 연 6 + 2024~26 연 3 = 264 + 24 + 9 = 297 (v0.9 약정 내 보수)
    expect(callCard?.querySelector('.kpi-value')?.textContent).toBe('297.0'); // 투자 300 + 보수 2020~23 연 6(24) + 2024~26 연 3(9)
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
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const real = [...root.querySelectorAll('.bar-real')].map((b) => Number(b.getAttribute('data-year')));
    expect(real[real.length - 1]).toBe(2029);
    expect(root.querySelector('.kpi-caption')?.textContent).toContain('진행 연도 2030');
  });
});

describe('오류 표시', () => {
  it('errors가 있으면 오류 패널만 렌더링', () => {
    const state = initialState({ kind: 'total' }, '2026-02-30');
    const div = document.createElement('div');
    div.innerHTML = renderDashboard(compute(mockPortfolio(), state), state);
    expect(div.querySelector('.error-panel')).not.toBeNull();
    expect(div.querySelector('.main-chart')).toBeNull();
    expect(div.textContent).toContain('AS_OF');
  });
});

// M4 민감도 (DESIGN.md 3.3, 10.1 v0.4)
function click(root: HTMLElement, selector: string) {
  const b = root.querySelector<HTMLButtonElement>(selector);
  if (!b) throw new Error(`${selector} 없음`);
  b.click();
}
const shiftBtn = (cls: string, kind: string, shift: number) => `button[data-class="${cls}"][data-kind="${kind}"][data-shift="${shift}"]`;
const cellText = (root: HTMLElement, tranche: string, cls: string) => root.querySelector(`tr[data-tranche="${tranche}"] td.${cls}`)?.textContent ?? '';

describe('민감도 조정 (M4)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = mount();
  });

  it('자산군 4개 × IRR·MoIC 5단계, 기본은 0 선택', () => {
    expect(root.querySelectorAll('.sens-row')).toHaveLength(4);
    expect(root.querySelectorAll('.seg-btn')).toHaveLength(40);
    expect(root.querySelectorAll('.seg-btn.selected')).toHaveLength(8);
    expect(root.querySelector('.line-base')).toBeNull();
  });

  it('3.3-C: RE·PD MoIC −40%만 비활성, 사유 표시', () => {
    const disabled = [...root.querySelectorAll<HTMLButtonElement>('.seg-btn:disabled')].map((b) => `${b.dataset.class} ${b.dataset.kind} ${b.dataset.shift}`);
    expect(disabled).toEqual(['RE moic -0.4', 'PD moic -0.4']);
    expect(root.querySelector(shiftBtn('RE', 'moic', -0.4))?.getAttribute('title')).toContain('CCC V: 조정 후 MoIC 0.96x');
  });

  it('11.1 회수 시각 이동: PE IRR −3%p → AAA VII 2020 집행분 t* 4.19 → 4.96, 회수 시각 2024.19 → 2024.96', () => {
    click(root, shiftBtn('PE', 'irr', -0.03));
    expect(cellText(root, 'AAA_VII:2020', 'tstar')).toBe('4.96 (4.19)');
    expect(cellText(root, 'AAA_VII:2020', 'exit-time')).toBe('2024 Q4 (2024 Q1)');
    expect(cellText(root, 'XXX:2024', 'tstar')).toBe('3.83 (3.49)'); // XXX도 PE 조정 적용 (3.3-4)
    expect(root.querySelectorAll('.line-base')).toHaveLength(2);
    expect(root.querySelectorAll('.kpi-delta').length).toBeGreaterThan(0);
    expect(root.querySelector(shiftBtn('PE', 'irr', -0.03))?.classList.contains('selected')).toBe(true);
  });

  it('XXX 분리(3.3-4): PE IRR −3%p에도 XXX t* 3.49 유지', () => {
    const cb = root.querySelector<HTMLInputElement>('input[data-setting="applyToDirect"]');
    if (!cb) throw new Error('applyToDirect 없음');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    click(root, shiftBtn('PE', 'irr', -0.03));
    expect(cellText(root, 'XXX:2024', 'tstar')).toBe('3.49');
    expect(cellText(root, 'AAA_VII:2020', 'tstar')).toBe('4.96 (4.19)');
  });

  it('시나리오 표: 5행, MoIC +20% 전 자산군 적용 → x축 2033까지, 초기화로 복귀', () => {
    expect(root.querySelectorAll('.scenario-table tbody tr')).toHaveLength(5);
    click(root, 'button[data-preset="moicUp"]');
    expect(root.querySelectorAll('.seg-btn.selected[data-kind="moic"][data-shift="0.2"]')).toHaveLength(4);
    expect(root.querySelectorAll('.hit')).toHaveLength(17); // 2017~2033
    expect(root.querySelector('.scenario-table tr.applied td')?.textContent).toBe('MoIC +20%');
    click(root, '#reset-shifts');
    expect(root.querySelectorAll('.seg-btn.selected[data-shift="0"]')).toHaveLength(8);
    expect(root.querySelector('.line-base')).toBeNull();
  });

  it('해석 변경으로 하한 위반 시 0으로 되돌리고 알림', () => {
    const sel = () => root.querySelector<HTMLSelectElement>('select[data-setting="moicShiftMode"]');
    const setMode = (v: string) => {
      const s = sel();
      if (!s) throw new Error('moicShiftMode 없음');
      s.value = v;
      s.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setMode('absolute'); // RE 1.6 − 0.40 = 1.20x 허용
    click(root, shiftBtn('RE', 'moic', -0.4));
    expect(root.querySelector(shiftBtn('RE', 'moic', -0.4))?.classList.contains('selected')).toBe(true);
    setMode('relative'); // RE 1.6 × 0.6 = 0.96x 위반 → 0
    expect(root.querySelector(shiftBtn('RE', 'moic', 0))?.classList.contains('selected')).toBe(true);
    expect(root.querySelector('.notice')?.textContent).toContain('RE MoIC −40%');
  });

  it('다시 그려도 펼친 해석 설정 패널 유지, 시나리오 라벨은 해석 설정을 따름', () => {
    const settings = root.querySelector<HTMLDetailsElement>('details[data-panel="settings"]');
    if (!settings) throw new Error('settings 없음');
    settings.open = true;
    const s = root.querySelector<HTMLSelectElement>('select[data-setting="irrShiftMode"]');
    if (!s) throw new Error('irrShiftMode 없음');
    s.value = 'relative';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelector<HTMLDetailsElement>('details[data-panel="settings"]')?.open).toBe(true);
    const labels = [...root.querySelectorAll('.scenario-table tbody tr td:first-child')].map((td) => td.textContent);
    expect(labels).toEqual(['기본', 'IRR −3%', 'IRR +3%', 'MoIC −20%', 'MoIC +20%']);
  });

  it('M8: 2단 배치·대표 수치·탭 전환, 재계산 후 활성 탭 유지', () => {
    expect(root.querySelector('.layout .sidebar .sens-panel')).not.toBeNull();
    expect(root.querySelector('.layout .main .hero .kpi-hero .kpi-label')?.textContent).toBe('기준일 NAV');
    const panel = (k: string) => root.querySelector<HTMLElement>(`[data-tab-panel="${k}"]`);
    expect(panel('scenarios')?.hidden).toBe(false);
    expect(panel('tranches')?.hidden).toBe(true);
    click(root, 'button[data-tab="tranches"]');
    expect(panel('tranches')?.hidden).toBe(false);
    expect(panel('scenarios')?.hidden).toBe(true);
    // 민감도를 바꿔 다시 그려도 탭 유지
    click(root, shiftBtn('PE', 'irr', -0.03));
    expect(panel('tranches')?.hidden).toBe(false);
    expect(root.querySelector('button[data-tab="tranches"]')?.classList.contains('active')).toBe(true);
  });

  it('M8: 시나리오 탭에 기본 대비 차이 (전체 IRR −3%p 마지막 회수 +0.78년)', () => {
    const row = [...root.querySelectorAll('.scenario-table tbody tr')][1];
    const deltas = [...(row?.querySelectorAll('td.delta') ?? [])].map((td) => td.textContent);
    // 값 자체(0.785 ≈ 12장 4.97 − 4.19)는 scenarios.test.ts에서 검증. 여기서는 화면 표시 = 엔진 결과 서식화
    const engine = summarizeScenarios(runScenarios(baseInput()), { kind: 'total' })[1]?.vsBase?.lastExitQuarters ?? Number.NaN;
    expect(engine).toBe(3);
    expect(deltas[0]).toBe('+3분기');
    expect([...root.querySelectorAll('.scenario-table tbody tr')][0]?.querySelector('td.delta')?.textContent).toBe('—');
  });
});
