import { describe, expect, it } from 'vitest';
import mock from '../src/data/portfolio.mock.json';
import designMd from '../docs/DESIGN.md?raw';

// mock 무결성 (DESIGN.md 1.7, 6장). 원문 데이터는 수정 금지 (CLAUDE.md 절대 규칙 1).

interface AppendixRow {
  assetClass: string;
  name: string;
  commitment: number;
  vintage: number;
  investPeriod: number | 'immediate';
  gIRR: number;
  gMOIC: number;
}

/** 부록 A "5. 대체 투자 포트폴리오 샘플" 원문 표를 파싱한다. */
function parseAppendixTable(md: string): AppendixRow[] {
  const start = md.indexOf('**5. 대체 투자 포트폴리오 샘플');
  const end = md.indexOf('**6. 기술적 구현내용');
  if (start < 0 || end < 0) throw new Error('부록 A 표를 찾을 수 없음');
  const rows: AppendixRow[] = [];
  for (const line of md.slice(start, end).split(/\r?\n/)) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const [assetClass, name, commitment, vintage, period, irr, moic] = cells;
    if (cells.length !== 7 || !assetClass || !name || !commitment || !vintage || !period || !irr || !moic) continue;
    if (!/^\d{4}$/.test(vintage)) continue; // 헤더·구분선·합계 행 제외
    rows.push({
      assetClass,
      name,
      commitment: Number(commitment.replace(/,/g, '')),
      vintage: Number(vintage),
      investPeriod: period === '즉시' ? 'immediate' : Number(period.replace('년', '')),
      gIRR: Number(irr.replace('%', '')) / 100,
      gMOIC: Number(moic.replace('x', '')),
    });
  }
  return rows;
}

describe('portfolio.mock.json 무결성', () => {
  it('펀드 12개, 약정 합계 3,000', () => {
    expect(mock.funds).toHaveLength(12);
    const total = mock.funds.reduce((sum, f) => sum + f.commitment, 0);
    expect(total).toBe(3000);
  });

  it('펀드 id 중복 없음', () => {
    const ids = mock.funds.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('보수율: 관리보수 2%/1%, 성과보수 20% (원문 가정 5)', () => {
    expect(mock.fees).toEqual({ mgmtInvest: 0.02, mgmtPost: 0.01, carry: 0.2 });
  });

  it('부록 A 원문 표와 한 줄씩 일치', () => {
    const appendix = parseAppendixTable(designMd);
    expect(appendix).toHaveLength(12);
    appendix.forEach((row, i) => {
      const fund = mock.funds[i];
      expect(fund, `${i + 1}행 ${row.name}`).toBeDefined();
      if (!fund) return;
      expect(fund.name).toBe(row.name);
      expect(fund.assetClass).toBe(row.assetClass);
      expect(fund.commitment).toBe(row.commitment);
      expect(fund.vintage).toBe(row.vintage);
      expect(fund.gIRR).toBeCloseTo(row.gIRR, 12);
      expect(fund.gMOIC).toBeCloseTo(row.gMOIC, 12);
      if (row.investPeriod === 'immediate') {
        // 원문 가정 6: 유일한 직접투자, 해당 연도 1월 1일 전액 집행
        expect(fund.type).toBe('direct');
        expect(fund.investPeriod).toBe(1);
      } else {
        expect(fund.type).toBe('fund');
        expect(fund.investPeriod).toBe(row.investPeriod);
      }
    });
  });

  it('직접투자는 XXX 하나뿐 (원문 가정 6)', () => {
    expect(mock.funds.filter((f) => f.type === 'direct').map((f) => f.name)).toEqual(['XXX']);
  });
});
