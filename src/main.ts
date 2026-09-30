// 앱 진입점: mock 로드 → 형태 검증 → mock 무결성(6장) → 대시보드 마운트
import './style.css';
import mock from './data/portfolio.mock.json';
import { checkMockIntegrity, parsePortfolio } from './engine/validate';
import { initialState, mountApp, renderErrors } from './ui/app';
import { localIsoDate } from './ui/format';
import { parseScopeKey } from './ui/scope';

const root = document.querySelector<HTMLDivElement>('#app');
if (root) {
  const { portfolio, errors } = parsePortfolio(mock);
  const integrity = portfolio ? checkMockIntegrity(portfolio) : [];
  if (!portfolio || integrity.length > 0) {
    root.innerHTML = renderErrors([...errors, ...integrity], 'mock 데이터 검증 오류 — 계산하지 않았습니다');
  } else {
    // 화면 기준일 기본값 = 오늘 (3.2). 로컬 날짜 사용
    // 보기 범위는 URL 해시로 지정 가능 (예: #fund:AAA_VII, #class:PE)
    const scope = parseScopeKey(decodeURIComponent(location.hash.slice(1)));
    mountApp(root, portfolio, initialState(scope, localIsoDate(new Date())));
  }
}
