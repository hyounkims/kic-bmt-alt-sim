// 표시용 서식. 반올림은 여기서만 한다 (CLAUDE.md 코드 규칙).

import type { Phase } from '../engine/types';
import { qNumber, qYear, type QIndex } from '../engine/time';

const moneyFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** $mn 금액: 1,234.5 */
export const money = (v: number): string => moneyFmt.format(v);

/** 배수: 1.47x */
export const multiple = (v: number): string => `${v.toFixed(2)}x`;

/** 비율: 0.18 → 18.0% */
export const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** 비율 소수 둘째 자리: 0.1181 → 11.81% (Net IRR) */
export const pct2 = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(2)}%`);

/** 연 소수 시각: 2024.19 */
export const yearTime = (v: number): string => v.toFixed(2);

export const PHASE_LABEL: Record<Phase, string> = { past: '실현', current: '진행', future: '추정' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** 분기 표기: 2027 Q2 (v0.9) */
export const quarterLabel = (q: QIndex): string => `${qYear(q)} Q${qNumber(q)}`;

/** 분기 수 차이: +3분기 / −2분기 / 0분기 */
export const signedQuarters = (n: number): string => (n === 0 ? '0분기' : `${n > 0 ? '+' : '−'}${Math.abs(n)}분기`);
