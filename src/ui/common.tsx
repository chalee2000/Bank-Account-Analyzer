import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';

export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class={'modal' + (props.wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={props.title}>
        <div class="modal-head">
          <h2>{props.title}</h2>
          <button class="btn ghost icon sm" onClick={props.onClose} aria-label="ปิด"><Icon name="close" /></button>
        </div>
        <div class="modal-body">{props.children}</div>
        {props.footer && <div class="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

export function Empty(props: { title: string; children?: ComponentChildren; icon?: string; action?: ComponentChildren }) {
  return (
    <div class="empty">
      <div style="opacity:.5;margin-bottom:8px"><Icon name={props.icon ?? 'file'} size={40} stroke={1.4} /></div>
      <h2>{props.title}</h2>
      <div style="max-width:520px;margin:0 auto">{props.children}</div>
      {props.action && <div style="margin-top:14px">{props.action}</div>}
    </div>
  );
}

export function Kpi(props: { label: string; value: string; sub?: string; title?: string }) {
  return (
    <div class="card kpi" title={props.title}>
      <div class="label">{props.label}</div>
      <div class="value">{props.value}</div>
      {props.sub && <div class="sub">{props.sub}</div>}
    </div>
  );
}

/** ความเด่นของสัญญาณ 1–3 แสดงเป็นจุด (ไม่ใช้สีแดง/เหลืองเพื่อไม่ให้สื่อถึงระดับความผิด) */
export function Prominence({ n }: { n: 1 | 2 | 3 }) {
  return (
    <span class="badge-dots" title={`ความเด่นของสัญญาณ ${n}/3 (ไม่ใช่ระดับความผิด)`} aria-label={`ความเด่น ${n} จาก 3`}>
      {'●'.repeat(n)}<span style="opacity:.25">{'●'.repeat(3 - n)}</span>
    </span>
  );
}

export function Notice(props: { kind?: 'info' | 'warn' | 'crit'; children: ComponentChildren; icon?: string }) {
  return (
    <div class={'notice ' + (props.kind === 'warn' ? 'warn' : props.kind === 'crit' ? 'crit' : '')} role="note">
      <Icon name={props.icon ?? (props.kind === 'info' || !props.kind ? 'info' : 'warn')} />
      <div>{props.children}</div>
    </div>
  );
}

export function Field(props: { label: string; children: ComponentChildren; hint?: string }) {
  return (
    <label class="field">
      <span>{props.label}</span>
      {props.children}
      {props.hint && <span class="tiny muted">{props.hint}</span>}
    </label>
  );
}

export function Seg<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div class="seg" role="group">
      {props.options.map((o) => (
        <button key={o.value} aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div class="tabs" role="tablist">
      {props.options.map((o) => (
        <button key={o.value} role="tab" aria-selected={props.value === o.value} onClick={() => props.onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

// ---------- Virtualized table ----------
export interface Col<T> {
  key: string;
  label: string;
  width: number;
  num?: boolean;
  render?: (row: T) => ComponentChildren;
  value?: (row: T) => string | number | null | undefined;
  sortable?: boolean;
  title?: (row: T) => string | undefined;
}

export function VTable<T>(props: {
  rows: T[];
  cols: Col<T>[];
  getId: (r: T) => string;
  rowHeight?: number;
  onRowClick?: (r: T) => void;
  selectedId?: string | null;
  sortKey?: string;
  sortDir?: 1 | -1;
  onSort?: (key: string) => void;
  height?: number | string;
  empty?: ComponentChildren;
}) {
  const rh = props.rowHeight ?? 34;
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [vh, setVh] = useState(400);
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setVh(el.clientHeight));
    ro.observe(el);
    setVh(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const total = props.cols.reduce((a, c) => a + c.width, 0);
  const start = Math.max(0, Math.floor(scroll / rh) - 6);
  const end = Math.min(props.rows.length, Math.ceil((scroll + vh) / rh) + 6);
  const vis = props.rows.slice(start, end);
  return (
    <div class="tbl-wrap" style={{ display: 'flex', flexDirection: 'column', height: typeof props.height === 'number' ? `${props.height}px` : props.height ?? '100%', minHeight: '160px' }}>
      <div class="vt" ref={ref} style={{ flex: '1 1 auto' }} onScroll={(e) => setScroll((e.currentTarget as HTMLElement).scrollTop)}>
        <div style={{ width: `${Math.max(total, 0)}px`, minWidth: '100%' }}>
          <div class="vt-row head" style={{ position: 'sticky', height: '34px', width: `${total}px`, minWidth: '100%' }}>
            {props.cols.map((c) => (
              <div
                key={c.key}
                class={'vt-cell' + (c.num ? ' num' : '')}
                style={{ width: `${c.width}px`, cursor: c.sortable ? 'pointer' : 'default' }}
                onClick={() => c.sortable && props.onSort?.(c.key)}
                title={c.label}
              >
                {c.label}{props.sortKey === c.key ? (props.sortDir === 1 ? ' ▲' : ' ▼') : ''}
              </div>
            ))}
          </div>
          <div class="vt-inner" style={{ height: `${props.rows.length * rh}px` }}>
            {vis.map((r, i) => {
              const id = props.getId(r);
              return (
                <div
                  key={id}
                  class={'vt-row' + (props.onRowClick ? ' clickable' : '') + (props.selectedId === id ? ' selected' : '')}
                  style={{ top: `${(start + i) * rh}px`, height: `${rh}px`, width: `${total}px`, minWidth: '100%' }}
                  onClick={() => props.onRowClick?.(r)}
                >
                  {props.cols.map((c) => (
                    <div key={c.key} class={'vt-cell' + (c.num ? ' num' : '')} style={{ width: `${c.width}px` }} title={c.title?.(r)}>
                      {c.render ? c.render(r) : String(c.value?.(r) ?? '')}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
        {!props.rows.length && <div class="empty">{props.empty ?? 'ไม่มีข้อมูล'}</div>}
      </div>
    </div>
  );
}

/** ตารางธรรมดา (ข้อมูลไม่เยอะ) */
export function SimpleTable<T>(props: {
  rows: T[];
  cols: { label: string; num?: boolean; render: (r: T, i: number) => ComponentChildren; width?: number; wrap?: boolean }[];
  onRowClick?: (r: T) => void;
  getId?: (r: T) => string;
  selectedId?: string | null;
  maxHeight?: number | string;
  empty?: string;
}) {
  return (
    <div class="tbl-wrap" style={{ maxHeight: typeof props.maxHeight === 'number' ? `${props.maxHeight}px` : props.maxHeight }}>
      <table class="tbl">
        <thead>
          <tr>{props.cols.map((c) => <th key={c.label} class={c.num ? 'num' : ''} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {props.rows.map((r, i) => {
            const id = props.getId?.(r);
            return (
              <tr key={id ?? i} class={(props.onRowClick ? 'clickable ' : '') + (id && props.selectedId === id ? 'selected' : '')} onClick={() => props.onRowClick?.(r)}>
                {props.cols.map((c) => <td key={c.label} class={(c.num ? 'num ' : '') + (c.wrap ? 'wrap' : '')}>{c.render(r, i)}</td>)}
              </tr>
            );
          })}
          {!props.rows.length && <tr><td colSpan={props.cols.length} class="muted" style="text-align:center;height:60px">{props.empty ?? 'ไม่มีข้อมูล'}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Hooks ----------
export function useElementWidth<T extends HTMLElement>(): [preact.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(200, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(200, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** ดาวน์โหลดไฟล์ — ใช้ File System Access API บน Chromium ถ้าผู้ใช้ต้องการเลือกที่บันทึก มิฉะนั้นดาวน์โหลดปกติ */
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function useSorted<T>(rows: T[], cols: Col<T>[], initialKey?: string, initialDir: 1 | -1 = -1) {
  const [key, setKey] = useState(initialKey);
  const [dir, setDir] = useState<1 | -1>(initialDir);
  const sorted = useMemo(() => {
    if (!key) return rows;
    const c = cols.find((x) => x.key === key);
    if (!c?.value) return rows;
    const get = c.value;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y), 'th') * dir;
    });
  }, [rows, key, dir]);
  const onSort = (k: string) => {
    if (k === key) setDir((d) => (d === 1 ? -1 : 1));
    else { setKey(k); setDir(-1); }
  };
  return { sorted, sortKey: key, sortDir: dir, onSort };
}

export function Pill({ children, kind }: { children: ComponentChildren; kind?: 'accent' | 'warn' | 'crit' }) {
  return <span class={'chip' + (kind ? ' ' + kind : '')}>{children}</span>;
}

export type { JSX };
