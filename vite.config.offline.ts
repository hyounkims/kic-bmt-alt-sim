import { defineConfig, mergeConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import baseConfig from './vite.config';

// 발표 백업용 단일 HTML 빌드 (DESIGN.md 13장 [권장]).
// singlefile 방식을 바꾸게 되면 이 파일만 교체한다.
export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [viteSingleFile()],
    build: {
      outDir: 'dist-offline',
    },
  }),
);
