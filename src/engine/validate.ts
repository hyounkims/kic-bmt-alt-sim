// 런타임 입력 검증 (DESIGN.md 6장). 실패 시 계산하지 않고 오류를 반환한다.
//   parsePortfolio     : unknown(JSON) → Portfolio 형태·타입 검사
//   validateInput      : 범위·의미 검사 (simulate가 매번 호출)
//   checkMockIntegrity : 펀드 12개·약정 3,000 (앱 진입점에서 호출, 6장 v0.3)

import {
  ADJUSTED_IRR_MIN,
  ADJUSTED_MOIC_MIN_EXCLUSIVE,
  BOUND_EPSILON,
  MOCK_FUND_COUNT,
  MOCK_TOTAL_COMMITMENT,
} from './constants';
import { adjustAssumptions, type Assumptions } from './tranches';
import { isValidIsoDate, type Year } from './time';
import { ASSET_CLASSES, type AssetClass, type Fees, type Fund, type FundType, type Portfolio, type SimError, type SimInput } from './types';

type Obj = Readonly<Record<string, unknown>>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isAssetClass(v: unknown): v is AssetClass {
  return typeof v === 'string' && (ASSET_CLASSES as readonly string[]).includes(v);
}

function isFundType(v: unknown): v is FundType {
  return v === 'fund' || v === 'direct';
}

const err = (code: string, message: string, path?: string): SimError =>
  path === undefined ? { code, message } : { code, message, path };

/** 6장 "필수 필드 존재 및 타입" */
export function parsePortfolio(raw: unknown): { portfolio: Portfolio | null; errors: SimError[] } {
  const errors: SimError[] = [];
  if (!isObj(raw)) {
    return { portfolio: null, errors: [err('TYPE', 'portfolio는 객체여야 함', 'portfolio')] };
  }
  const rawFunds = raw['funds'];
  if (!Array.isArray(rawFunds)) errors.push(err('TYPE', 'funds는 배열이어야 함', 'portfolio.funds'));

  const funds: Fund[] = [];
  (Array.isArray(rawFunds) ? rawFunds : []).forEach((f: unknown, i: number) => {
    const p = `portfolio.funds[${i}]`;
    if (!isObj(f)) {
      errors.push(err('TYPE', '펀드는 객체여야 함', p));
      return;
    }
    const { id, assetClass, name, type, commitment, vintage, investPeriod, gIRR, gMOIC } = f;
    const before = errors.length;
    if (typeof id !== 'string' || id === '') errors.push(err('TYPE', 'id는 빈 값이 아닌 문자열', `${p}.id`));
    if (!isAssetClass(assetClass)) errors.push(err('TYPE', `assetClass는 ${ASSET_CLASSES.join('|')}`, `${p}.assetClass`));
    if (typeof name !== 'string') errors.push(err('TYPE', 'name은 문자열', `${p}.name`));
    if (!isFundType(type)) errors.push(err('TYPE', 'type은 fund|direct', `${p}.type`));
    for (const [key, v] of Object.entries({ commitment, investPeriod, gIRR, gMOIC })) {
      if (!isFiniteNumber(v)) errors.push(err('TYPE', `${key}는 숫자`, `${p}.${key}`));
    }
    if (!isFiniteNumber(vintage) || !Number.isInteger(vintage)) errors.push(err('TYPE', 'vintage는 정수 연도', `${p}.vintage`));
    if (errors.length > before) return;
    funds.push({
      id: id as string,
      assetClass: assetClass as AssetClass,
      name: name as string,
      type: type as FundType,
      commitment: commitment as number,
      vintage: vintage as Year,
      investPeriod: investPeriod as number,
      gIRR: gIRR as number,
      gMOIC: gMOIC as number,
    });
  });

  const rawFees = raw['fees'];
  let fees: Fees | null = null;
  if (!isObj(rawFees)) {
    errors.push(err('TYPE', 'fees는 객체여야 함', 'portfolio.fees'));
  } else {
    const { mgmtInvest, mgmtPost, carry } = rawFees;
    if (isFiniteNumber(mgmtInvest) && isFiniteNumber(mgmtPost) && isFiniteNumber(carry)) {
      fees = { mgmtInvest, mgmtPost, carry };
    } else {
      errors.push(err('TYPE', 'fees.mgmtInvest·mgmtPost·carry는 숫자', 'portfolio.fees'));
    }
  }

  if (errors.length > 0 || fees === null) return { portfolio: null, errors };
  return { portfolio: { funds, fees }, errors };
}

/** 6장 mock 무결성: 펀드 12개, 약정 합계 3,000 */
export function checkMockIntegrity(portfolio: Portfolio): SimError[] {
  const errors: SimError[] = [];
  if (portfolio.funds.length !== MOCK_FUND_COUNT) {
    errors.push(err('MOCK_INTEGRITY', `펀드 수 ${portfolio.funds.length} ≠ ${MOCK_FUND_COUNT}`, 'portfolio.funds'));
  }
  const total = portfolio.funds.reduce((s, f) => s + f.commitment, 0);
  if (Math.abs(total - MOCK_TOTAL_COMMITMENT) > 1e-9) {
    errors.push(err('MOCK_INTEGRITY', `약정 합계 ${total} ≠ ${MOCK_TOTAL_COMMITMENT}`, 'portfolio.funds'));
  }
  return errors;
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

/** 3.3-C 조정 후 하한 검사 (IRR′ ≥ 1%, MoIC′ > 1.0x). 단계 비활성화 판정에도 사용 */
export function checkAdjustedBounds(fund: Fund, a: Assumptions, path = 'portfolio.funds'): SimError[] {
  const errors: SimError[] = [];
  if (!(a.irr >= ADJUSTED_IRR_MIN - BOUND_EPSILON)) {
    errors.push(err('BOUND_IRR', `${fund.name}: 조정 후 IRR ${pct(a.irr)} < ${pct(ADJUSTED_IRR_MIN)}`, `${path}.gIRR`));
  }
  if (!(a.moic > ADJUSTED_MOIC_MIN_EXCLUSIVE + BOUND_EPSILON)) {
    errors.push(err('BOUND_MOIC', `${fund.name}: 조정 후 MoIC ${a.moic.toFixed(2)}x ≤ ${ADJUSTED_MOIC_MIN_EXCLUSIVE.toFixed(1)}x`, `${path}.gMOIC`));
  }
  return errors;
}

/** 6장 범위·의미 검사. simulate가 계산 직전에 매번 호출한다 */
export function validateInput(input: SimInput): SimError[] {
  const { portfolio, scenario, options } = input;
  const errors: SimError[] = [];

  if (!isValidIsoDate(options.asOf)) errors.push(err('AS_OF', `기준일이 유효한 날짜(YYYY-MM-DD)가 아님: ${options.asOf}`, 'options.asOf'));
  if (options.displayStart < options.calcStart) errors.push(err('RANGE', 'displayStart는 calcStart 이상', 'options.displayStart'));
  if (options.sensitivityMode === 'forward') {
    errors.push(err('NOT_IMPLEMENTED', '실무 모드(7.7)는 M6에서 구현 예정', 'options.sensitivityMode'));
  }

  const { mgmtInvest, mgmtPost, carry } = portfolio.fees;
  if (mgmtInvest < 0 || mgmtPost < 0) errors.push(err('RANGE', '관리보수율은 0 이상', 'portfolio.fees'));
  if (carry < 0 || carry >= 1) errors.push(err('RANGE', '성과보수율은 0 이상 1 미만', 'portfolio.fees.carry'));

  for (const c of ASSET_CLASSES) {
    if (!isFiniteNumber(scenario.irrShift[c]) || !isFiniteNumber(scenario.moicShift[c])) {
      errors.push(err('TYPE', `${c} 조정값은 숫자`, `scenario.${c}`));
    }
  }

  const ids = new Set<string>();
  portfolio.funds.forEach((f, i) => {
    const p = `portfolio.funds[${i}]`;
    if (ids.has(f.id)) errors.push(err('DUPLICATE_ID', `펀드 id 중복: ${f.id}`, `${p}.id`));
    ids.add(f.id);
    if (!(f.commitment > 0)) errors.push(err('RANGE', `${f.name}: 약정액은 0 초과`, `${p}.commitment`));
    if (!Number.isInteger(f.investPeriod) || f.investPeriod < 1) {
      errors.push(err('RANGE', `${f.name}: investPeriod는 1 이상 정수`, `${p}.investPeriod`));
    }
    if (f.type === 'direct' && f.investPeriod !== 1) {
      errors.push(err('RANGE', `${f.name}: direct는 investPeriod 1`, `${p}.investPeriod`));
    }
    if (f.vintage < options.calcStart) {
      errors.push(err('RANGE', `${f.name}: vintage ${f.vintage} < calcStart ${options.calcStart}`, `${p}.vintage`));
    }

    // 3.3-C 조정 후 하한
    errors.push(...checkAdjustedBounds(f, adjustAssumptions(f, scenario, options), p));
  });

  return errors;
}
