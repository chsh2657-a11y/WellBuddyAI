import { defineConfig, devices } from '@playwright/test';

/**
 * 빌드된 API(4000)·웹(3000)을 띄워 실제 브라우저로 검증한다.
 *   pnpm build && pnpm test:e2e
 * 로컬 샌드박스처럼 Playwright 버전과 설치된 Chromium 이 다르면
 * PLAYWRIGHT_CHROMIUM_PATH 로 브라우저 실행 파일을 지정한다.
 */
const CI = !!process.env.CI;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath,
          // 로캘이 POSIX 인 환경에서는 브라우저가 한글 다운로드 파일 이름을 버리므로 UTF-8 로 띄운다
          env: { ...process.env, LANG: process.env.LANG || 'C.UTF-8' },
        },
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @wellbuddy/api start',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: !CI,
      timeout: 60_000,
      stdout: 'pipe',
    },
    {
      command: 'pnpm --filter @wellbuddy/web start',
      url: 'http://localhost:3000/login',
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
