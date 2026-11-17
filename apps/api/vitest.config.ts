import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// NestJS 의존성 주입은 데코레이터 메타데이터(emitDecoratorMetadata)가 필요하므로 SWC 로 변환한다.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
