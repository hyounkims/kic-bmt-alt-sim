import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine/simulate';
import { timeToMoic, trancheYearEndNav } from '../src/engine/tranches';
import { asYear } from '../src/engine/time';
import type { SeriesPoint, SimOutput } from '../src/engine/types';
import { baseInput, expectDisplay, expectExact, uniformScenario } from './fixtures';

// DESIGN.md 11.1 정답 케이스 (고정 입력, 기준일 2026-09-30, 전 구간 모드)
// 기대값은 DESIGN.md 수치를 그대로 옮긴 것이다. 엔진 결과에 맞춰 고치지 않는다 (CLAUDE.md 절대 규칙 4).

const base = simulate(baseInput());

function fundSeries(out: SimOutput, fundId: string): readonly SeriesPoint[] {
  const s = out.series.byFund[fundId];
  if (!s) throw new Error(`series.byFund.${fundId} 없음`);
  return s;
}

function at(series: readonly SeriesPoint[], year: number): SeriesPoint {
  const p = series.find((s) => s.year === year);
  if (!p) throw new Error(`${year}년 없음`);
  return p;
}

function tranchesOf(out: SimOutput, fundId: string) {
  return out.tranches.filter((t) => t.fundId === fundId).sort((a, b) => a.investYear - b.investYear);
}

describe('11.1 정답 케이스', () => {
  it('기본 입력은 오류 없음', () => {
    expect(base.errors).toEqual([]);
  });

  describe('AAA VII (기본)', () => {
    const tr = tranchesOf(base, 'AAA_VII');
    const series = fundSeries(base, 'AAA_VII');
    const last = series[series.length - 1];

    it('2020 집행분 연말 NAV 2020~2023 = 88.50 / 104.43 / 123.23 / 145.41', () => {
      const t2020 = tr[0];
      expect(t2020?.investYear).toBe(2020);
      if (!t2020) return;
      [88.5, 104.43, 123.23, 145.41].forEach((v, i) => expectDisplay(trancheYearEndNav(t2020, asYear(2020 + i)), v, `${2020 + i} 연말 NAV`));
      expectExact(trancheYearEndNav(t2020, asYear(2024)), 0, '2024(회수 연도) 연말 NAV');
      // 2020년에는 집행분이 하나뿐이므로 펀드 연말 NAV와도 같아야 한다
      expectDisplay(at(series, 2020).nav, 88.5, '펀드 2020 연말 NAV');
    });

    it('집행분 회수 시각 2024.19 / 2025.19 / 2026.19 / 2027.19, 회수 연도 2024~2027', () => {
      expect(tr.map((t) => t.investYear)).toEqual([2020, 2021, 2022, 2023]);
      [2024.19, 2025.19, 2026.19, 2027.19].forEach((v, i) => expectDisplay(tr[i]?.exitTime, v, `집행분 ${i} 회수 시각`));
      expect(tr.map((t) => t.exitYear)).toEqual([2024, 2025, 2026, 2027]);
    });

    it('집행분 순회수 135 (150 − 15)', () => {
      for (const t of tr) {
        expectExact(t.exitGross, 150, '회수 총액');
        expectExact(t.carry, 15, '성과보수');
        expectExact(t.exitNet, 135, '순회수');
      }
    });

    it('누적 Distribution 540', () => {
      expectExact(last?.cumDist, 540, '최종 누적 Distribution');
    });

    it('관리보수 2020~2023 연 6, 2024~2027 연 3 → 36', () => {
      const fees = base.events.filter((e) => e.fundId === 'AAA_VII' && e.type === 'fee');
      expect(fees.map((e) => e.time)).toEqual([2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027]);
      fees.forEach((e) => expectExact(e.amount, e.time < 2024 ? 6 : 3, `${e.time} 관리보수`));
      expectExact(series.reduce((s, p) => s + p.callFee, 0), 36, '관리보수 합계');
    });

    it('누적 Capital Call 336', () => {
      expectExact(last?.cumCall, 336, '최종 누적 Capital Call');
    });
  });

  describe('XXX (기본)', () => {
    const tr = tranchesOf(base, 'XXX');
    const series = fundSeries(base, 'XXX');

    it('투자 2024년 400', () => {
      expect(tr).toHaveLength(1);
      expect(tr[0]?.investYear).toBe(2024);
      expectExact(tr[0]?.amount, 400, '집행 금액');
      expectExact(at(series, 2024).callInvest, 400, '2024 투자 Call');
    });

    it('t* / 회수 시각 / 회수 연도 = 3.49 / 2027.49 / 2027', () => {
      expectDisplay(tr[0]?.tStar, 3.49, 't*');
      expectDisplay(tr[0]?.exitTime, 2027.49, '회수 시각');
      expect(tr[0]?.exitYear).toBe(2027);
    });

    it('연말 NAV 2024~2026 = 520.0 / 676.0 / 878.8', () => {
      [520, 676, 878.8].forEach((v, i) => expectDisplay(at(series, 2024 + i).nav, v, `${2024 + i} 연말 NAV`));
      expectExact(at(series, 2027).nav, 0, '2027 연말 NAV');
    });

    it('회수 1,000 (보수 0)', () => {
      expectExact(tr[0]?.exitGross, 1000, '회수 총액');
      expectExact(tr[0]?.carry, 0, '성과보수');
      expectExact(tr[0]?.exitNet, 1000, '순회수');
      expect(base.events.filter((e) => e.fundId === 'XXX' && e.type === 'fee')).toEqual([]);
    });
  });

  describe('DDD VI 2016년 말 누적', () => {
    const upTo2016 = fundSeries(base, 'DDD_VI').filter((p) => p.year <= 2016);

    it('누적 투자 Call 66.67', () => {
      expectDisplay(upTo2016.reduce((s, p) => s + p.callInvest, 0), 66.67, '누적 투자 Call');
    });

    it('누적 관리보수 8.00', () => {
      expectDisplay(upTo2016.reduce((s, p) => s + p.callFee, 0), 8.0, '누적 관리보수');
    });

    it('NAV 81.32', () => {
      expectDisplay(at(upTo2016, 2016).nav, 81.32, '2016 연말 NAV');
    });
  });

  describe('포트폴리오 종료 연도', () => {
    it('기본 endYear 2032', () => {
      expect(base.meta.endYear).toBe(2032);
    });

    it('5개 시나리오(8장) 최대 endYear 2033', () => {
      const variants = [uniformScenario(0, 0), uniformScenario(-0.03, 0), uniformScenario(0.03, 0), uniformScenario(0, -0.2), uniformScenario(0, 0.2)];
      const outs = variants.map((scenario) => simulate(baseInput({ scenario })));
      outs.forEach((o) => expect(o.errors).toEqual([]));
      expect(Math.max(...outs.map((o) => o.meta.endYear))).toBe(2033);
    });
  });

  describe('회수 시각 이동 (3.1-7 검증)', () => {
    it('PE IRR −3%p: t* 4.19 → 4.96, 회수 연도 동일·회수 시각 이동', () => {
      const shifted = simulate(baseInput({ scenario: { ...uniformScenario(0, 0), irrShift: { PE: -0.03, RE: 0, Infra: 0, PD: 0 } } }));
      const b = tranchesOf(base, 'AAA_VII')[0];
      const s = tranchesOf(shifted, 'AAA_VII')[0];
      expectDisplay(b?.tStar, 4.19, '기본 t*');
      expectDisplay(s?.tStar, 4.96, '변경 t*');
      expect(s?.exitYear).toBe(b?.exitYear);
      expect(s?.exitTime).toBeGreaterThan(b?.exitTime ?? Number.POSITIVE_INFINITY);
    });

    it('XXX IRR +3%p: 3.49 → 3.21, −3%p: 3.49 → 3.83', () => {
      const up = simulate(baseInput({ scenario: { ...uniformScenario(0, 0), irrShift: { PE: 0.03, RE: 0, Infra: 0, PD: 0 } } }));
      const down = simulate(baseInput({ scenario: { ...uniformScenario(0, 0), irrShift: { PE: -0.03, RE: 0, Infra: 0, PD: 0 } } }));
      expectDisplay(tranchesOf(up, 'XXX')[0]?.tStar, 3.21, 'XXX IRR +3%p t*');
      expectDisplay(tranchesOf(down, 'XXX')[0]?.tStar, 3.83, 'XXX IRR −3%p t*');
    });
  });
});

// DESIGN.md 12장 회수 기간 표: t* (⌊t*⌋)
describe('12장 회수 기간 표', () => {
  const table: Record<string, { irr: number; moic: number; expected: [number, number][] }> = {
    PE: { irr: 0.18, moic: 2.0, expected: [[4.19, 4], [4.96, 4], [3.64, 3], [2.84, 2], [5.29, 5]] },
    XXX: { irr: 0.3, moic: 2.5, expected: [[3.49, 3], [3.83, 3], [3.21, 3], [2.64, 2], [4.19, 4]] },
    RE: { irr: 0.12, moic: 1.6, expected: [[4.15, 4], [5.45, 5], [3.36, 3], [2.18, 2], [5.76, 5]] },
    Infra: { irr: 0.14, moic: 1.8, expected: [[4.49, 4], [5.63, 5], [3.74, 3], [2.78, 2], [5.88, 5]] },
    PD: { irr: 0.1, moic: 1.4, expected: [[3.53, 3], [4.97, 4], [2.75, 2], [1.19, 1], [5.44, 5]] },
  };
  // 열: 기본 / IRR −3%p / IRR +3%p / MoIC −20% / MoIC +20%
  const columns: [string, number, number][] = [
    ['기본', 0, 0],
    ['IRR −3%p', -0.03, 0],
    ['IRR +3%p', 0.03, 0],
    ['MoIC −20%', 0, -0.2],
    ['MoIC +20%', 0, 0.2],
  ];

  for (const [name, row] of Object.entries(table)) {
    it(name, () => {
      columns.forEach(([label, dr, dm], i) => {
        const [tStar, floor] = row.expected[i] ?? [Number.NaN, Number.NaN];
        const actual = timeToMoic(row.irr + dr, row.moic * (1 + dm));
        expectDisplay(actual, tStar, `${name} ${label} t*`);
        expect(Math.floor(actual), `${name} ${label} ⌊t*⌋`).toBe(floor);
      });
    });
  }
});
