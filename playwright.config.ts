import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const local = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const executablePath = process.env.CHROMIUM_PATH || (existsSync(local) ? local : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: { executablePath, args: ['--no-sandbox'] },
    trace: 'off',
    acceptDownloads: true,
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false, // ต้อง build ใหม่ทุกครั้ง ไม่ใช้ dist เก่า
    timeout: 240_000,
  },
  projects: [
    { name: 'desktop', testIgnore: /mobile\.spec\.ts/, use: { viewport: { width: 1440, height: 900 } } },
    { name: 'iphone', testMatch: /mobile\.spec\.ts/, use: { ...devices['iPhone 14'], defaultBrowserType: 'chromium' } },
  ],
});
