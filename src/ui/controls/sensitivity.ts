// 민감도 컨트롤 (10.1, 3.3-7, 3.3-C): 자산군별 IRR·MoIC 단계 선택, 하한 위반 단계 비활성화, 해석 설정.

import type { StepAvailability } from '../../engine/scenarios';
import { ASSET_CLASSES, type AssetClass, type ByClass, type FundInfo, type IrrShiftMode, type MoicShiftMode, type NavBasis, type Scenario } from '../../engine/types';
import { escapeHtml, multiple, pct } from '../format';
import { CLASS_LABEL } from '../scope';

export interface Settings {
  irrShiftMode: IrrShiftMode;
  moicShiftMode: MoicShiftMode;
  applyToDirect: boolean;
  navBasis: NavBasis;
}

export type Availability = ByClass<{ readonly irr: readonly StepAvailability[]; readonly moic: readonly StepAvailability[] }>;

const signed = (v: number, digits: number, unit: string) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}${unit}`);

/** 단계 라벨: 해석 모드에 따라 %p / % / x */
export function stepLabel(kind: 'irr' | 'moic', shift: number, s: Settings): string {
  if (kind === 'irr') return s.irrShiftMode === 'pp' ? signed(shift * 100, 0, '%p') : signed(shift * 100, 0, '%');
  return s.moicShiftMode === 'relative' ? signed(shift * 100, 0, '%') : signed(shift, 2, 'x');
}

/** 같은 부동소수 단계인지 (0.03 등) */
export const sameShift = (a: number, b: number) => Math.abs(a - b) < 1e-9;

function segment(c: AssetClass, kind: 'irr' | 'moic', steps: readonly StepAvailability[], current: number, s: Settings): string {
  const buttons = steps
    .map((st) => {
      const selected = sameShift(st.shift, current);
      const attrs = [
        `type="button"`,
        `class="seg-btn${selected ? ' selected' : ''}"`,
        `data-class="${c}"`,
        `data-kind="${kind}"`,
        `data-shift="${st.shift}"`,
        `aria-pressed="${selected}"`,
        st.allowed ? '' : `disabled title="${escapeHtml(`하한 위반: ${st.reason ?? ''}`)}"`,
      ].join(' ');
      return `<button ${attrs}>${stepLabel(kind, st.shift, s)}</button>`;
    })
    .join('');
  return `<div class="seg" role="group" aria-label="${c} ${kind === 'irr' ? 'IRR' : 'MoIC'} 조정"><span class="seg-name">${kind === 'irr' ? 'IRR' : 'MoIC'}</span>${buttons}</div>`;
}

function appliedLabel(funds: readonly FundInfo[]): string {
  const fund = funds.find((f) => f.type === 'fund');
  const direct = funds.find((f) => f.type === 'direct');
  const fmt = (f: FundInfo) => {
    const changed = Math.abs(f.irr - f.gIRR) > 1e-12 || Math.abs(f.moic - f.gMOIC) > 1e-12;
    const base = `${pct(f.gIRR)} · ${multiple(f.gMOIC)}`;
    return changed ? `${base} → <strong>${pct(f.irr)} · ${multiple(f.moic)}</strong>` : base;
  };
  return [fund ? fmt(fund) : '', direct ? `<span class="sens-direct">${escapeHtml(direct.name)} ${fmt(direct)}</span>` : ''].filter(Boolean).join(' ');
}

export function renderSensitivity(scenario: Scenario, settings: Settings, availability: Availability, funds: readonly FundInfo[], notice: string | undefined): string {
  const rows = ASSET_CLASSES.map((c) => {
    const a = availability[c];
    return `<div class="sens-row">
      <div class="sens-label"><span class="sens-class">${CLASS_LABEL[c]}</span><span class="sens-values">${appliedLabel(funds.filter((f) => f.assetClass === c))}</span></div>
      ${segment(c, 'irr', a.irr, scenario.irrShift[c], settings)}
      ${segment(c, 'moic', a.moic, scenario.moicShift[c], settings)}
    </div>`;
  }).join('');

  const blocked = ASSET_CLASSES.flatMap((c) =>
    (['irr', 'moic'] as const).flatMap((kind) =>
      availability[c][kind].filter((s) => !s.allowed).map((s) => `<li>${c} ${kind === 'irr' ? 'IRR' : 'MoIC'} ${stepLabel(kind, s.shift, settings)} — ${escapeHtml(s.reason ?? '')}</li>`),
    ),
  );
  const active = ASSET_CLASSES.some((c) => scenario.irrShift[c] !== 0 || scenario.moicShift[c] !== 0);

  return `<section class="side-section sens-panel" aria-label="민감도 조정">
    <div class="eyebrow">Sensitivity</div>
    <div class="sens-head">
      <h2>민감도 조정 <span class="muted">IRR ${settings.irrShiftMode === 'pp' ? '3%p' : '3%'} · MoIC ${settings.moicShiftMode === 'relative' ? '20%' : '0.20x'} 단위</span></h2>
      <button type="button" id="reset-shifts" class="text-btn"${active ? '' : ' disabled'}>기본 가정으로 초기화</button>
    </div>
    ${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ''}
    <div class="sens-grid">${rows}</div>
    ${blocked.length ? `<details class="blocked" data-panel="blocked"><summary>비활성 단계 ${blocked.length}개 (조정 하한: IRR′ ≥ 1%, MoIC′ > 1.0x)</summary><ul>${blocked.join('')}</ul></details>` : ''}
    ${renderSettings(settings)}
  </section>`;
}

function renderSettings(s: Settings): string {
  const sel = (id: string, value: string, options: [string, string][]) =>
    `<select data-setting="${id}">${options.map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;
  return `<details class="settings" data-panel="settings">
    <summary>해석 설정</summary>
    <div class="settings-grid">
      <label class="control"><span>IRR 조정 해석</span>${sel('irrShiftMode', s.irrShiftMode, [['pp', '%p 가감 (18% → 15%)'], ['relative', '상대 변동 (18% → 17.46%)']])}</label>
      <label class="control"><span>MoIC 조정 해석</span>${sel('moicShiftMode', s.moicShiftMode, [['relative', '상대 변동 (2.0x → 1.6x)'], ['absolute', '절대 가감 (2.0x → 1.8x)']])}</label>
      <label class="control"><span>NAV 기준</span>${sel('navBasis', s.navBasis, [['gross', 'Gross (평가가치 합)'], ['net', 'Net (성과보수 예상분·미지급 보수 차감)']])}</label>
      <label class="check"><input type="checkbox" data-setting="applyToDirect"${s.applyToDirect ? ' checked' : ''} /> PE 조정을 XXX(직접투자)에도 적용</label>
    </div>
  </details>`;
}
