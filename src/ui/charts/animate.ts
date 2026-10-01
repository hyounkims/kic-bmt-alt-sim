// 차트 전환 애니메이션 (10.1 v0.9.3): 다시 그린 SVG의 도형을 이전 좌표에서 새 좌표로 보간한다.
// 엔진 값을 다시 계산하지 않는다. 이미 그려진 SVG 속성(좌표·경로 숫자)만 섞는다.

/** 도형 키(data-k) → 보간 대상 속성 값 */
export type ChartSnapshot = ReadonlyMap<string, Readonly<Record<string, string>>>;

const NUMERIC_ATTRS = ['x', 'y', 'width', 'height', 'x1', 'x2', 'y1', 'y2'] as const;
const NUMBER = /-?\d+(?:\.\d+)?/g;
const DURATION_MS = 450;

let running = 0;

/** 현재 화면 차트의 도형 좌표를 기록 (다시 그리기 직전에 호출) */
export function snapshotChart(root: ParentNode): ChartSnapshot {
  const snap = new Map<string, Record<string, string>>();
  for (const el of root.querySelectorAll<SVGElement>('svg.main-chart [data-k]')) {
    const attrs: Record<string, string> = {};
    for (const a of [...NUMERIC_ATTRS, 'd']) {
      const v = el.getAttribute(a);
      if (v !== null) attrs[a] = v;
    }
    const key = el.getAttribute('data-k');
    if (key) snap.set(key, attrs);
  }
  return snap;
}

/** 경로 문자열 보간: 명령 구조(숫자를 뺀 나머지)가 같을 때만 숫자를 섞는다 */
function pathTween(from: string, to: string): ((t: number) => string) | null {
  if (from.replace(NUMBER, '#') !== to.replace(NUMBER, '#')) return null;
  const a = (from.match(NUMBER) ?? []).map(Number);
  const b = (to.match(NUMBER) ?? []).map(Number);
  let i = 0;
  return (t) => {
    i = 0;
    return to.replace(NUMBER, () => {
      const v = (a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * t;
      i++;
      return v.toFixed(1);
    });
  };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 새로 그린 차트를 이전 기록에서 출발해 새 값까지 움직인다.
 * 같은 키가 있으면 좌표·경로를 보간하고, 새로 생긴 도형(또는 경로 구조가 달라진 선)은 서서히 나타낸다.
 */
export function animateChart(root: ParentNode, from: ChartSnapshot): void {
  if (from.size === 0 || reducedMotion() || typeof requestAnimationFrame !== 'function') return;
  const steps: ((t: number) => void)[] = [];
  for (const el of root.querySelectorAll<SVGElement>('svg.main-chart [data-k]')) {
    const prev = from.get(el.getAttribute('data-k') ?? '');
    if (!prev) {
      steps.push((t) => el.style.setProperty('opacity', String(t)));
      continue;
    }
    const d = el.getAttribute('d');
    if (d !== null && prev['d'] !== undefined && prev['d'] !== d) {
      const tween = pathTween(prev['d'], d);
      if (tween) steps.push((t) => el.setAttribute('d', t >= 1 ? d : tween(t)));
      else steps.push((t) => el.style.setProperty('opacity', String(t)));
    }
    for (const a of NUMERIC_ATTRS) {
      const to = el.getAttribute(a);
      const fromV = prev[a];
      if (to === null || fromV === undefined || to === fromV) continue;
      const a0 = Number(fromV);
      const a1 = Number(to);
      if (!Number.isFinite(a0) || !Number.isFinite(a1)) continue;
      steps.push((t) => el.setAttribute(a, t >= 1 ? to : (a0 + (a1 - a0) * t).toFixed(1)));
    }
  }
  if (steps.length === 0) return;
  // 연속 클릭: 이전 애니메이션은 멈추고, 이번 애니메이션이 화면에 남은 좌표에서 이어 간다
  const id = ++running;
  for (const s of steps) s(0);
  const start = performance.now();
  const frame = (now: number) => {
    if (id !== running) return;
    const p = Math.min(1, (now - start) / DURATION_MS);
    const t = p >= 1 ? 1 : ease(p);
    for (const s of steps) s(t);
    if (p < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
