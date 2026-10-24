import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  analysis, busy, cs, derived, findingsStale, go, inspector, openInspector, route, setTheme, theme, toasts, analysisMs,
} from './state';
import { Icon } from './ui/icons';
import { Inspector } from './ui/Inspector';
import { CasesPage } from './ui/pages/Cases';
import { DashboardPage } from './ui/pages/Dashboard';
import { ImportPage } from './ui/pages/Import';
import { AccountsPage } from './ui/pages/Accounts';
import { TransactionsPage } from './ui/pages/Transactions';
import { PatternsPage } from './ui/pages/Patterns';
import { TracePage } from './ui/pages/Trace';
import { NetworkPage } from './ui/pages/Network';
import { TimelinePage } from './ui/pages/Timeline';
import { FindingsPage } from './ui/pages/Findings';
import { ReportPage } from './ui/pages/Report';
import { SettingsPage } from './ui/pages/Settings';

interface NavDef {
  path: string;
  label: string;
  icon: string;
  /** สีไอคอนในเมนู (ตกแต่งเท่านั้น) */
  tone: 'violet' | 'blue' | 'teal' | 'sky' | 'pink' | 'indigo';
  title: string;
  flush?: boolean;
  needsCase?: boolean;
  count?: () => number | undefined;
  render: () => ComponentChildren;
}

const NAV: NavDef[] = [
  { path: '/dashboard', label: 'ภาพรวม', icon: 'dashboard', tone: 'violet', title: 'ภาพรวมคดี', needsCase: true, render: () => <DashboardPage /> },
  { path: '/import', label: 'นำเข้าไฟล์', icon: 'upload', tone: 'blue', title: 'นำเข้า Statement', needsCase: true, count: () => cs.value?.files.length, render: () => <ImportPage /> },
  { path: '/accounts', label: 'บัญชี', icon: 'accounts', tone: 'teal', title: 'บัญชีและโปรไฟล์', needsCase: true, count: () => Object.values(derived.value?.accounts ?? {}).filter((a) => a.kind === 'account').length, render: () => <AccountsPage /> },
  { path: '/transactions', label: 'ธุรกรรม', icon: 'list', tone: 'sky', title: 'ธุรกรรมรวม', needsCase: true, flush: true, count: () => derived.value?.txns.length, render: () => <TransactionsPage /> },
  { path: '/patterns', label: 'รูปแบบ/สัญญาณ', icon: 'alert', tone: 'pink', title: 'รูปแบบและสัญญาณ', needsCase: true, count: () => analysis.value?.signals.filter((s) => s.prominence >= 2).length, render: () => <PatternsPage /> },
  { path: '/trace', label: 'เส้นทางเงิน', icon: 'trace', tone: 'violet', title: 'เส้นทางเงิน (Money Trail)', needsCase: true, render: () => <TracePage /> },
  { path: '/network', label: 'เครือข่าย', icon: 'network', tone: 'indigo', title: 'ผังความเชื่อมโยง', needsCase: true, flush: true, render: () => <NetworkPage /> },
  { path: '/timeline', label: 'ไทม์ไลน์', icon: 'timeline', tone: 'blue', title: 'Master Timeline', needsCase: true, render: () => <TimelinePage /> },
  { path: '/findings', label: 'ผลวิเคราะห์', icon: 'findings', tone: 'teal', title: 'ผลวิเคราะห์ 4 ระดับ', needsCase: true, render: () => <FindingsPage /> },
  { path: '/report', label: 'รายงาน', icon: 'report', tone: 'pink', title: 'รายงาน', needsCase: true, render: () => <ReportPage /> },
  { path: '/settings', label: 'ตั้งค่า', icon: 'settings', tone: 'indigo', title: 'ตั้งค่าและข้อมูล', render: () => <SettingsPage /> },
];

export function App() {
  const r = route.value;
  const st = cs.value;
  const def = NAV.find((n) => n.path === r.path);
  const [menu, setMenu] = useState(false);
  const showCases = r.path === '/' || (def?.needsCase && !st) || !def;
  useEffect(() => setMenu(false), [r.path]);

  // คีย์ลัด: "/" โฟกัสช่องค้นหา · Esc ปิดแผงรายละเอียด · Alt+1…9,0 สลับหน้า
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) {
        const el = document.querySelector<HTMLInputElement>('.page input[aria-label^="ค้นหา"], .page input[placeholder^="ค้นหา"]');
        if (el) { e.preventDefault(); el.focus(); el.select(); }
      } else if (e.key === 'Escape' && !document.querySelector('.overlay') && inspector.value) {
        openInspector(null);
      } else if (e.altKey && /^Digit[0-9]$/.test(e.code) && cs.value) {
        // ใช้ e.code (ไม่ขึ้นกับเลย์เอาต์/macOS ที่ Option+เลข ให้อักขระพิเศษ)
        const d = Number(e.code.slice(5));
        const idx = d === 0 ? 9 : d - 1;
        const target = NAV.filter((n) => n.path !== '/settings')[idx];
        if (target) { e.preventDefault(); go(target.path); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hasInspector = !!inspector.value && !showCases;
  const title = showCases ? 'คดีทั้งหมด' : def!.title;
  const page = showCases ? <CasesPage /> : def!.render();
  const flush = !showCases && def?.flush;

  return (
    <div class={'shell' + (hasInspector ? ' has-inspector' : '')}>
      <nav class="nav" aria-label="เมนูหลัก">
        <div class="brand">
          <div class="logo"><Icon name="network" size={18} stroke={2} /></div>
          <div>Bank Account Analyzer<small>วิเคราะห์การเงินเชิงสืบสวน</small></div>
        </div>
        {st && (
          <div class="nav-case" title={st.meta.name}>
            <span class="tiny" style="opacity:.7">คดีที่เปิดอยู่</span>
            <b class="ellipsis">{st.meta.name}</b>
            {st.meta.caseNumber && <span class="ellipsis" style="display:block;opacity:.7">{st.meta.caseNumber}</span>}
          </div>
        )}
        <a class="nav-item" data-tone="sky" href="#/" aria-current={r.path === '/' ? 'page' : undefined}><Icon name="file" /><span class="lbl">คดีทั้งหมด</span></a>
        <div class="nav-sep" />
        {NAV.filter((n) => n.path !== '/settings').map((n) => {
          const c = st ? n.count?.() : undefined;
          return (
            <a
              key={n.path} class="nav-item" href={'#' + n.path} title={n.label} data-tone={n.tone}
              aria-current={r.path === n.path ? 'page' : undefined}
              style={!st ? 'opacity:.4;pointer-events:none' : undefined}
            >
              <Icon name={n.icon} /><span class="lbl">{n.label}</span>
              {c !== undefined && c > 0 && <span class="count">{c.toLocaleString('en-US')}</span>}
            </a>
          );
        })}
        <div class="nav-sep" />
        <a class="nav-item" data-tone="indigo" href="#/settings" aria-current={r.path === '/settings' ? 'page' : undefined}><Icon name="settings" /><span class="lbl">ตั้งค่าและข้อมูล</span></a>
        <div class="nav-foot">
          <Icon name="lock" size={13} /> ประมวลผลในเครื่องนี้ทั้งหมด<br />ไฟล์ไม่ถูกส่งออกไปที่ใด
        </div>
      </nav>

      <div class="main">
        <header class="topbar">
          <h1 class="grow ellipsis">{title}</h1>
          {busy.value && <span class="row small secondary"><span class="spinner" />{busy.value}</span>}
          {!busy.value && analysis.value && !showCases && <span class="small muted no-print hide-mobile" title="เวลาที่ใช้วิเคราะห์ล่าสุด">วิเคราะห์เสร็จใน {Math.round(analysisMs.value)} ms</span>}
          {findingsStale.value && !showCases && <a class="chip warn" href="#/findings" title="ข้อมูลหรือค่าตั้งต้นเปลี่ยนไปหลังสร้างผลวิเคราะห์อัตโนมัติ">ผลวิเคราะห์อัตโนมัติล้าสมัย</a>}
          <button
            class="btn ghost icon" aria-label="สลับโหมดสว่าง/มืด" title="สลับโหมดสว่าง/มืด"
            onClick={() => setTheme(theme.value === 'dark' ? 'light' : theme.value === 'light' ? 'auto' : 'dark')}
          >
            <Icon name={theme.value === 'dark' ? 'moon' : theme.value === 'light' ? 'sun' : 'dashboard'} />
          </button>
        </header>
        <main class={'page' + (flush ? ' flush' : '')} id="page">{page}</main>
      </div>

      {hasInspector && <Inspector />}

      <nav class="tabbar" aria-label="เมนูมือถือ">
        <a href="#/dashboard" aria-current={r.path === '/dashboard' ? 'page' : undefined}><Icon name="dashboard" />ภาพรวม</a>
        <a href="#/import" aria-current={r.path === '/import' ? 'page' : undefined}><Icon name="upload" />นำเข้า</a>
        <a href="#/accounts" aria-current={r.path === '/accounts' ? 'page' : undefined}><Icon name="accounts" />บัญชี</a>
        <a href="#/network" aria-current={r.path === '/network' ? 'page' : undefined}><Icon name="network" />เครือข่าย</a>
        <button onClick={() => setMenu(true)} aria-label="เมนูเพิ่มเติม"><Icon name="menu" />เพิ่มเติม</button>
      </nav>
      {menu && (
        <div class="overlay" onClick={() => setMenu(false)}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <div class="modal-head"><h2>เมนูทั้งหมด</h2><button class="btn ghost icon sm" onClick={() => setMenu(false)} aria-label="ปิด"><Icon name="close" /></button></div>
            <div class="modal-body stack tight">
              <a class="btn" href="#/"><Icon name="file" />คดีทั้งหมด</a>
              {NAV.map((n) => <a key={n.path} class="btn" href={'#' + n.path}><Icon name={n.icon} />{n.label}</a>)}
            </div>
          </div>
        </div>
      )}

      {busy.value && <div class="busybar" />}
      <div class="toast-host" aria-live="polite">
        {toasts.value.map((t) => <div key={t.id} class={'toast' + (t.kind === 'err' ? ' err' : '')}>{t.text}</div>)}
      </div>
    </div>
  );
}
