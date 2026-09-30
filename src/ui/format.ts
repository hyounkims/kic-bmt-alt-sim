// 표시용 서식. 반올림은 여기서만 한다 (CLAUDE.md 코드 규칙).

import type { Phase } from '../engine/types';

const moneyFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** $mn 금액: 1,234.5 */
export const money = (v: number): string => moneyFmt.format(v);

/** 배수: 1.47x */
export const multiple = (v: number): string => `${v.toFixed(2)}x`;

/** 비율: 0.18 → 18.0% */
export const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** 연 소수 시각: 2024.19 */
export const yearTime = (v: number): string => v.toFixed(2);

export const PHASE_LABEL: Record<Phase, string> = { past: '실현', current: '진행', future: '추정' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** 로컬 날짜 YYYY-MM-DD (toISOString은 UTC라 KST 오전에 전날이 됨) */
export function localIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
