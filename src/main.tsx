import { render } from 'preact';
import '@fontsource/noto-sans-thai/400.css';
import '@fontsource/noto-sans-thai/500.css';
import '@fontsource/noto-sans-thai/700.css';
import './styles/app.css';
import './styles/print.css';
import { App } from './app';
import { applyTheme, tryRestoreLastCase, refreshCases } from './state';

applyTheme();
render(<App />, document.getElementById('app')!);

// เริ่มต้น: โหลดรายการคดีและเปิดคดีล่าสุด
void (async () => {
  try {
    await refreshCases();
    await tryRestoreLastCase();
  } catch (e) {
    console.error(e);
  }
})();

// ขอให้เบราว์เซอร์เก็บข้อมูลถาวร (ลดโอกาสถูกล้างเอง โดยเฉพาะบน iOS Safari)
void navigator.storage?.persist?.().catch(() => undefined);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => undefined);
}
