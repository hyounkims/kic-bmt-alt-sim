import { describe, expect, it } from 'vitest';
import mock from '../src/data/portfolio.mock.json';
import { simulate } from '../src/engine/simulate';
import { asYear } from '../src/engine/time';
import { checkMockIntegrity, parsePortfolio, validateInput } from '../src/engine/validate';
import { baseInput, mockPortfolio, uniformScenario } from './fixtures';

// DESIGN.md 6장 런타임 입력 검증
describe('parsePortfolio', () => {
  it('mock은 오류 없이 파싱', () => {
    const { portfolio, errors } = parsePortfolio(mock);
    expect(errors).toEqual([]);
    expect(portfolio?.funds).toHaveLength(12);
  });

  it('필수 필드 누락·타입 오류는 위치와 함께 보고', () => {
    const broken = { ...mock, funds: [{ ...mock.funds[0], vintage: '2017' }, ...mock.funds.slice(1)] };
    const { portfolio, errors } = parsePortfolio(broken);
    expect(portfolio).toBeNull();
    expect(errors.map((e) => e.path)).toContain('portfolio.funds[0].vintage');
    expect(parsePortfolio(null).errors).toHaveLength(1);
    expect(parsePortfolio({ funds: [] }).errors.map((e) => e.path)).toContain('portfolio.fees');
  });
});

describe('checkMockIntegrity', () => {
  it('mock은 펀드 12개·약정 3,000 충족', () => {
    expect(checkMockIntegrity(mockPortfolio())).toEqual([]);
  });

  it('펀드 누락 시 보고', () => {
    const p = mockPortfolio();
    const errors = checkMockIntegrity({ ...p, funds: p.funds.slice(1) });
    expect(errors.map((e) => e.code)).toEqual(['MOCK_INTEGRITY', 'MOCK_INTEGRITY']);
  });
});

describe('validateInput', () => {
  it('기본 입력은 오류 없음', () => {
    expect(validateInput(baseInput())).toEqual([]);
  });

  it('기준일이 유효하지 않으면 오류, simulate는 계산하지 않음', () => {
    const input = baseInput({ options: { asOf: '2026-02-30' } });
    expect(validateInput(input).map((e) => e.code)).toEqual(['AS_OF']);
    const out = simulate(input);
    expect(out.errors.map((e) => e.code)).toEqual(['AS_OF']);
    expect(out.tranches).toEqual([]);
    expect(out.series.total).toEqual([]);
  });

  it('3.3-C: MoIC −40%는 RE·PD에서 하한(> 1.0x) 위반', () => {
    const errors = validateInput(baseInput({ scenario: uniformScenario(0, -0.4) }));
    expect(errors.every((e) => e.code === 'BOUND_MOIC')).toBe(true);
    const names = errors.map((e) => e.message.split(':')[0]);
    expect(names).toEqual(['CCC V', 'CCC VI', 'FFF VI', 'FFF VII']);
  });

  it('3.3-C: IRR −6%p는 전 자산군 하한(≥ 1%) 충족', () => {
    expect(validateInput(baseInput({ scenario: uniformScenario(-0.06, 0) }))).toEqual([]);
  });

  it('vintage < calcStart, direct의 investPeriod ≠ 1, id 중복은 오류', () => {
    const p = mockPortfolio();
    const funds = p.funds.map((f) => (f.id === 'XXX' ? { ...f, investPeriod: 2 } : f));
    const dup = [...funds, funds[0]!];
    const errors = validateInput({ ...baseInput({ options: { calcStart: asYear(2016) } }), portfolio: { ...p, funds: dup } });
    const codes = errors.map((e) => e.code);
    expect(codes).toContain('DUPLICATE_ID');
    expect(errors.some((e) => e.message.includes('direct는 investPeriod 1'))).toBe(true);
    expect(errors.some((e) => e.message.includes('DDD VI: vintage 2015 < calcStart 2016'))).toBe(true);
  });

  it('실무 모드는 M6 전까지 명시적 오류', () => {
    expect(validateInput(baseInput({ options: { sensitivityMode: 'forward' } })).map((e) => e.code)).toEqual(['NOT_IMPLEMENTED']);
  });
});
