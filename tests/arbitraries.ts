// fast-check 무작위 입력 생성기 (DESIGN.md 11.2·11.3). 3.3-C 하한을 지키는 유효 입력만 만든다.
import fc from 'fast-check';
import { byClassOf, DEFAULT_OPTIONS, IRR_STEPS, MOIC_STEPS } from '../src/engine/constants';
import { stepAvailability } from '../src/engine/scenarios';
import { asYear, type Year } from '../src/engine/time';
import { ASSET_CLASSES, type AssetClass, type ByClass, type Fees, type Fund, type Options, type Portfolio, type Scenario, type SimInput } from '../src/engine/types';

export const CALC_START = 2015;

const arbFundBody = fc.record({
  assetClass: fc.constantFrom<AssetClass>(...ASSET_CLASSES),
  direct: fc.integer({ min: 0, max: 9 }).map((n) => n < 2), // 직접투자는 약 20%
  commitment: fc.double({ min: 10, max: 1000, noNaN: true }),
  vintage: fc.integer({ min: CALC_START, max: 2030 }),
  investPeriod: fc.integer({ min: 1, max: 7 }),
  gIRR: fc.double({ min: 0.02, max: 0.35, noNaN: true }),
  gMOIC: fc.double({ min: 1.05, max: 3.0, noNaN: true }),
});

type FundBody = typeof arbFundBody extends fc.Arbitrary<infer T> ? T : never;

function toFund(b: FundBody, i: number, prefix: string): Fund {
  return {
    id: `${prefix}${i}`,
    name: `${prefix}${i}`,
    assetClass: b.assetClass,
    type: b.direct ? 'direct' : 'fund',
    commitment: b.commitment,
    vintage: asYear(b.vintage) as Year,
    investPeriod: b.direct ? 1 : b.investPeriod,
    gIRR: b.gIRR,
    gMOIC: b.gMOIC,
  };
}

export const arbFees: fc.Arbitrary<Fees> = fc.record({
  mgmtInvest: fc.double({ min: 0, max: 0.03, noNaN: true }),
  mgmtPost: fc.double({ min: 0, max: 0.02, noNaN: true }),
  carry: fc.double({ min: 0, max: 0.3, noNaN: true }),
});

export const arbFunds = (prefix = 'F', maxLength = 15): fc.Arbitrary<Fund[]> =>
  fc.array(arbFundBody, { minLength: 1, maxLength }).map((bs) => bs.map((b, i) => toFund(b, i, prefix)));

export const arbPortfolio: fc.Arbitrary<Portfolio> = fc.record({ funds: arbFunds(), fees: arbFees });

const arbAsOf = fc
  .date({ min: new Date(Date.UTC(2015, 0, 1)), max: new Date(Date.UTC(2040, 11, 31)), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

export const arbOptions = (): fc.Arbitrary<Options> =>
  fc.record({
    asOf: arbAsOf,
    irrShiftMode: fc.constantFrom<Options['irrShiftMode']>('pp', 'relative'),
    moicShiftMode: fc.constantFrom<Options['moicShiftMode']>('relative', 'absolute'),
    applyToDirect: fc.boolean(),
    navBasis: fc.constantFrom<Options['navBasis']>('gross', 'net'),
  }).map((o) => ({ ...DEFAULT_OPTIONS, ...o, calcStart: asYear(CALC_START) }));

const arbStepsByClass = (steps: readonly number[]) =>
  fc.tuple(...ASSET_CLASSES.map(() => fc.constantFrom(...steps))).map((vs) => {
    const r = byClassOf(0);
    ASSET_CLASSES.forEach((c, i) => (r[c] = vs[i] ?? 0));
    return r;
  });

export const arbRawScenario: fc.Arbitrary<Scenario> = fc.record({ irrShift: arbStepsByClass(IRR_STEPS), moicShift: arbStepsByClass(MOIC_STEPS) });

/** 3.3-C 하한을 어기는 단계는 0으로 (앱 UI와 같은 판정) */
export function clampToAllowed(portfolio: Portfolio, options: Options, s: Scenario): Scenario {
  const irrShift: ByClass<number> = { ...s.irrShift };
  const moicShift: ByClass<number> = { ...s.moicShift };
  for (const c of ASSET_CLASSES) {
    if (!stepAvailability(portfolio, options, c, 'irr', [irrShift[c]])[0]?.allowed) irrShift[c] = 0;
    if (!stepAvailability(portfolio, options, c, 'moic', [moicShift[c]])[0]?.allowed) moicShift[c] = 0;
  }
  return { irrShift, moicShift };
}

export const arbInput = (): fc.Arbitrary<SimInput> =>
  fc.tuple(arbPortfolio, arbOptions(), arbRawScenario).map(([portfolio, options, raw]) => ({
    portfolio,
    options,
    scenario: clampToAllowed(portfolio, options, raw),
  }));
