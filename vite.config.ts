/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// CSP ใส่เฉพาะตอน build (dev server ต้องใช้ inline script/WebSocket ของ HMR)
const cspForBuild = {
  name: 'strip-csp-in-dev',
  transformIndexHtml: {
    order: 'pre' as const,
    handler(html: string, ctx: { server?: unknown }) {
      return ctx.server ? html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '') : html;
    },
  },
};

export default defineConfig({
  base: './',
  plugins: [
    cspForBuild,
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Bank Account Analyzer — วิเคราะห์การเงินเชิงสืบสวน',
        short_name: 'BankAnalyzer',
        description: 'วิเคราะห์ Statement ธนาคารหลายบัญชี ความเชื่อมโยง และจัดทำรายงานประกอบการสืบสวน ประมวลผลในเครื่องทั้งหมด',
        lang: 'th',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // ไฟล์ OCR มีขนาดใหญ่ ไม่ precache — แคชเมื่อใช้งานครั้งแรก (CacheFirst จาก origin เดียวกัน)
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        globIgnores: ['ocr/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/ocr/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-assets', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
