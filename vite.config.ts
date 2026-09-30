import { defineConfig } from 'vite';

// 일반 정적 빌드 (dist/, Vercel 배포용)
export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2022',
    // 런타임 fetch 금지 (CLAUDE.md 절대 규칙 5): Vite modulepreload 폴리필 제외
    modulePreload: { polyfill: false },
  },
});
