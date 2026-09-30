import { defineConfig } from 'vite';

// 일반 정적 빌드 (dist/, Vercel 배포용)
export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
