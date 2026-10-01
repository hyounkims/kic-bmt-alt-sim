// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine/simulate';
import { niceTicks, renderMainChart } from '../src/ui/charts/mainChart';
import { selectScope } from '../src/ui/scope';
import { baseInput } from './fixtures';

// DESIGN.md 10.3 v0.8: 눈금 규칙, 선택적 값 라벨, 소형 차트 옵션
describe('niceTicks', () => {
  it('최댓값에 가장 가까운 1·2·2.5·5 단위, 눈금 칸 4~7개', () => {
    expect(niceTicks(6117).at(-1)).toBe(7000);
    expect(niceTicks(5184).at(-1)).toBe(6000);
    expect(niceTicks(540).at(-1)).toBe(600);
    expect(niceTicks(81.32).at(-1)).toBe(100);
    expect(niceTicks(0)).toEqual([0]);
    for (const m of [1, 7.3, 99, 101, 999, 1001, 2345, 6117, 9999, 12345]) {
      const t = niceTicks(m);
      expect(t.length - 1, `${m}`).toBeGreaterThanOrEqual(4);
      expect(t.length - 1, `${m}`).toBeLessThanOrEqual(7);
      expect(t.at(-1)!, `${m}`).toBeGreaterThanOrEqual(m);
    }
  });
});

describe('선택적 값 라벨·소형 옵션', () => {
  const out = simulate(baseInput());
  const view = selectScope(out, { kind: 'total' })!;
  const svg = (opts: Parameters<typeof renderMainChart>[2]) => {
    const d = document.createElement('div');
    d.innerHTML = renderMainChart(view, out.meta, opts);
    return d;
  };

  it('화면 차트: 마지막 실현 연도(2025) 막대 위에만 값 라벨 = 그해 연말 NAV', () => {
    const labels = [...svg({ idPrefix: 't' }).querySelectorAll('.bar-value')].map((t) => t.textContent);
    const nav2025 = out.series.total.find((p) => p.year === 2025)?.nav ?? Number.NaN;
    expect(labels).toEqual([Math.round(nav2025).toLocaleString('en-US')]);
  });

  it('소형 차트: 기본은 값 라벨 없음, yLabels·asOfText false면 y축 숫자·실현/추정 글자 없음', () => {
    const d = svg({ idPrefix: 't2', compact: true, yLabels: false, asOfText: false });
    expect(d.querySelectorAll('.bar-value')).toHaveLength(0);
    expect(d.querySelector('.axis-unit')).toBeNull();
    expect(d.querySelectorAll('.asof-label')).toHaveLength(0);
    expect(d.querySelector('.asof-line')).not.toBeNull();
    expect([...d.querySelectorAll('.axis-label')].every((t) => /^20\d\d$/.test(t.textContent ?? ''))).toBe(true);
  });
});
