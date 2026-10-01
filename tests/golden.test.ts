import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine/simulate';
import { timeToMoic, trancheYearEndNav } from '../src/engine/tranches';
import { asYear, qIndexOf } from '../src/engine/time';
import type { SeriesPoint, SimOutput } from '../src/engine/types';
import { baseInput, expectDisplay, expectExact, uniformScenario } from './fixtures';

// DESIGN.md 11.1 정답 케이스 v0.9 (고정 입력, 기준일 2026-09-30 = 기준 분기 2026 Q3)
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

const Q = qIndexOf;

describe('11.1 정답 케이스 (v0.9)', () => {
  it('기본 입력은 오류 없음, 기준 분기 2026 Q3', () => {
    expect(base.errors).toEqual([]);
    expect(base.meta.asOfQuarter).toBe(Q(2026, 3));
    expect(base.meta.asOfTime).toBe(2026.75);
  });

  describe('AAA VII (기본)', () => {
    const tr = tranchesOf(base, 'AAA_VII');
    const series = fundSeries(base, 'AAA_VII');
    const last = series[series.length - 1];

    it('관리보수 2020~2023 연 6, 2024~2027 연 3 → 36 (약정 안)', () => {
      const fees = base.events.filter((e) => e.fundId === 'AAA_VII' && e.type === 'fee');
      expect(fees.map((e) => e.year)).toEqual([2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027]);
      fees.forEach((e) => expectExact(e.amount, e.year < 2024 ? 6 : 3, `${e.year} 관리보수`));
      expectExact(series.reduce((s, p) => s + p.callFee, 0), 36, '관리보수 합계');
    });

    it('집행분 금액 (300 − 36) / 4 = 66', () => {
      expect(tr.map((t) => t.investYear)).toEqual([2020, 2021, 2022, 2023]);
      tr.forEach((t) => expectExact(t.amount, 66, `${t.investYear} 집행분`));
    });

    it('2020 집행분 연말 NAV 2020~2023 = 77.88 / 91.90 / 108.44 / 127.96', () => {
      const t2020 = tr[0];
      expect(t2020?.investYear).toBe(2020);
      if (!t2020) return;
      [77.88, 91.9, 108.44, 127.96].forEach((v, i) => expectDisplay(trancheYearEndNav(t2020, asYear(2020 + i)), v, `${2020 + i} 연말 NAV`));
      expectExact(trancheYearEndNav(t2020, asYear(2024)), 0, '2024(회수 연도) 연말 NAV');
      expectDisplay(at(series, 2020).nav, 77.88, '펀드 2020 연말 NAV');
    });

    it('집행분 회수 분기 2024 Q1 / 2025 Q1 / 2026 Q1 / 2027 Q1 (분기말 인식)', () => {
      expect(tr.map((t) => t.exitQuarter)).toEqual([Q(2024, 1), Q(2025, 1), Q(2026, 1), Q(2027, 1)]);
      expect(tr.map((t) => t.exitTime)).toEqual([2024.25, 2025.25, 2026.25, 2027.25]);
      expect(tr.map((t) => t.exitYear)).toEqual([2024, 2025, 2026, 2027]);
    });

    it('집행분 순회수 118.8 (132 − 13.2)', () => {
      for (const t of tr) {
        expectExact(t.exitGross, 132, '회수 총액');
        expectExact(t.carry, 13.2, '성과보수');
        expectExact(t.exitNet, 118.8, '순회수');
      }
    });

    it('예상 최종 Net MoIC 1.58x (475.2 / 300) / Net IRR 11.81% (7.8, 독립 계산)', () => {
      const perf = base.performance.byFund['AAA_VII'];
      expectExact(perf?.netMoic, 475.2 / 300, 'Net MoIC');
      expectDisplay(perf?.netMoic, 1.58, 'Net MoIC 표시값');
      // 표시값 11.81% → 소수 0.1181 ± 0.0001 (CLAUDE.md 표시값 허용 오차를 % 단위로)
      expect(Math.abs((perf?.netIrr ?? Number.NaN) - 0.1181)).toBeLessThanOrEqual(0.0001);
    });

    it('누적 Distribution 475.2, 누적 Capital Call 300 (= 약정)', () => {
      expectExact(last?.cumDist, 475.2, '최종 누적 Distribution');
      expectExact(last?.cumCall, 300, '최종 누적 Capital Call');
    });
  });

  describe('XXX (기본)', () => {
    const tr = tranchesOf(base, 'XXX');
    const series = fundSeries(base, 'XXX');

    it('투자 2024년 400 (보수 없음)', () => {
      expect(tr).toHaveLength(1);
      expect(tr[0]?.investYear).toBe(2024);
      expectExact(tr[0]?.amount, 400, '집행 금액');
      expectExact(at(series, 2024).callInvest, 400, '2024 투자 Call');
      expect(base.events.filter((e) => e.fundId === 'XXX' && e.type === 'fee')).toEqual([]);
    });

    it('t* 3.49 / 회수 2027 Q2', () => {
      expectDisplay(tr[0]?.tStar, 3.49, 't*');
      expect(tr[0]?.exitQuarter).toBe(Q(2027, 2));
      expect(tr[0]?.exitYear).toBe(2027);
    });

    it('연말 NAV 2024~2026 = 520.0 / 676.0 / 878.8', () => {
      [520, 676, 878.8].forEach((v, i) => expectDisplay(at(series, 2024 + i).nav, v, `${2024 + i} 연말 NAV`));
      expectExact(at(series, 2027).nav, 0, '2027 연말 NAV');
    });

    it('예상 최종 Net IRR 29.93% (2.5^(1/3.5) − 1) / Net MoIC 2.50x', () => {
      const perf = base.performance.byFund['XXX'];
      expect(Math.abs((perf?.netIrr ?? Number.NaN) - (Math.pow(2.5, 1 / 3.5) - 1))).toBeLessThan(1e-9);
      expect(Math.abs((perf?.netIrr ?? Number.NaN) - 0.2993)).toBeLessThanOrEqual(0.0001);
      expectExact(perf?.netMoic, 2.5, 'Net MoIC');
    });

    it('회수 1,000', () => {
      expectExact(tr[0]?.exitGross, 1000, '회수 총액');
      expectExact(tr[0]?.carry, 0, '성과보수');
      expectExact(tr[0]?.exitNet, 1000, '순회수');
    });
  });

  describe('DDD VI 2016년 말 누적', () => {
    const series = fundSeries(base, 'DDD_VI');
    const upTo2016 = series.filter((p) => p.year <= 2016);

    it('총보수 32 (2015~2020 연 4 + 2021~2024 연 2) → 집행분 28', () => {
      expectExact(series.reduce((s, p) => s + p.callFee, 0), 32, '총보수');
      tranchesOf(base, 'DDD_VI').forEach((t) => expectExact(t.amount, 28, `${t.investYear} 집행분`));
    });

    it('누적 투자 Call 56.00', () => {
      expectDisplay(upTo2016.reduce((s, p) => s + p.callInvest, 0), 56, '누적 투자 Call');
    });

    it('누적 관리보수 8.00', () => {
      expectDisplay(upTo2016.reduce((s, p) => s + p.callFee, 0), 8.0, '누적 관리보수');
    });

    it('NAV 68.31', () => {
      expectDisplay(at(upTo2016, 2016).nav, 68.31, '2016 연말 NAV');
    });
  });

  describe('포트폴리오', () => {
    it('기본 endYear 2032 (2032 Q1)', () => {
      expect(base.meta.endYear).toBe(2032);
      expect(Math.max(...base.tranches.map((t) => t.exitQuarter))).toBe(Q(2032, 1));
    });

    it('5개 시나리오(8장) 최대 endYear 2033', () => {
      const variants = [uniformScenario(0, 0), uniformScenario(-0.03, 0), uniformScenario(0.03, 0), uniformScenario(0, -0.2), uniformScenario(0, 0.2)];
      const outs = variants.map((scenario) => simulate(baseInput({ scenario })));
      outs.forEach((o) => expect(o.errors).toEqual([]));
      expect(Math.max(...outs.map((o) => o.meta.endYear))).toBe(2033);
    });

    it('최종 누적 Capital Call 3,000 (= 약정 합계)', () => {
      expectExact(base.series.total.at(-1)?.cumCall, 3000, '최종 누적 Call');
    });
  });

  describe('회수 이동 (3.1-7 검증)', () => {
    const pe = (d: number) => ({ ...uniformScenario(0, 0), irrShift: { PE: d, RE: 0, Infra: 0, PD: 0 } });

    it('PE IRR −3%p: AAA VII 2020 집행분 t* 4.19 → 4.96, 회수 2024 Q1 → 2024 Q4 (같은 해)', () => {
      const shifted = simulate(baseInput({ scenario: pe(-0.03) }));
      const b = tranchesOf(base, 'AAA_VII')[0];
      const s = tranchesOf(shifted, 'AAA_VII')[0];
      expectDisplay(b?.tStar, 4.19, '기본 t*');
      expectDisplay(s?.tStar, 4.96, '변경 t*');
      expect(b?.exitQuarter).toBe(Q(2024, 1));
      expect(s?.exitQuarter).toBe(Q(2024, 4));
      expect(s?.exitYear).toBe(b?.exitYear);
    });

    it('XXX IRR +3%p: t* 3.21, 2027 Q1 / −3%p: t* 3.83, 2027 Q4', () => {
      const up = tranchesOf(simulate(baseInput({ scenario: pe(0.03) })), 'XXX')[0];
      const down = tranchesOf(simulate(baseInput({ scenario: pe(-0.03) })), 'XXX')[0];
      expectDisplay(up?.tStar, 3.21, 'XXX IRR +3%p t*');
      expectDisplay(down?.tStar, 3.83, 'XXX IRR −3%p t*');
      expect(up?.exitQuarter).toBe(Q(2027, 1));
      expect(down?.exitQuarter).toBe(Q(2027, 4));
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
