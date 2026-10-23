// กราฟ SVG แบบ static (สีคงที่ พื้นขาว) สำหรับรายงานที่พิมพ์ — ไม่พึ่ง CSS variables หรือการวัดขนาดหน้าจอ
import { fmtBaht } from '../core/thai';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function niceMax(max: number): { max: number; ticks: number[] } {
  if (max <= 0) return { max: 1, ticks: [0, 1] };
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / exp;
  const step = (f <= 1 ? 0.2 : f <= 2 ? 0.5 : f <= 5 ? 1 : 2) * exp;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: top, ticks };
}
const compact = (n: number) => (Math.abs(n) >= 1e6 ? `${+(n / 1e6).toFixed(1)} ล้าน` : Math.abs(n) >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(Math.round(n)));

export interface StaticSeries { name: string; color: string; values: number[] }

export function staticLineSvg(xs: number[], series: StaticSeries[], xLabel: (x: number) => string, w = 720, h = 230): string {
  const m = { l: 52, r: 14, t: 12, b: 28 };
  const iw = w - m.l - m.r;
  const ih = h - m.t - m.b;
  const n = xs.length;
  const { max, ticks } = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const x = (i: number) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => m.t + ih - (v / max) * ih;
  const maxTicks = Math.max(2, Math.floor(iw / 90));
  const step = Math.max(1, Math.ceil((n - 1) / (maxTicks - 1)));
  let g = '';
  for (const t of ticks) g += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(t)}" y2="${y(t)}" stroke="#e3e2dc"/><text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end" fill="#6b6a64" font-size="10">${compact(t)}</text>`;
  for (let i = 0; i < n; i += step) g += `<text x="${x(i)}" y="${h - 8}" text-anchor="middle" fill="#6b6a64" font-size="10">${esc(xLabel(xs[i]!))}</text>`;
  for (const s of series) {
    const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    if (n > 1) g += `<polygon points="${x(0)},${y(0)} ${pts} ${x(n - 1)},${y(0)}" fill="${s.color}" opacity="0.1"/>`;
    g += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (n === 1) g += `<circle cx="${x(0)}" cy="${y(s.values[0]!)}" r="4" fill="${s.color}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" role="img" font-family="Noto Sans Thai, sans-serif">${g}</svg>`;
}

const WD = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
export function staticHeatmapSvg(grid: number[][], w = 720): string {
  const left = 30;
  const top = 16;
  const cw = Math.floor((w - left) / 24);
  const ch = 20;
  const max = Math.max(1, ...grid.flat());
  const levels = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
  let g = '';
  for (let h = 0; h < 24; h += 3) g += `<text x="${left + h * cw + cw / 2}" y="11" text-anchor="middle" fill="#6b6a64" font-size="10">${h}</text>`;
  grid.forEach((row, r) => {
    g += `<text x="${left - 6}" y="${top + r * ch + ch / 2 + 4}" text-anchor="end" fill="#6b6a64" font-size="10">${WD[r]}</text>`;
    row.forEach((v, hh) => {
      const c = v <= 0 ? '#eeeeea' : levels[Math.min(6, Math.floor((v / max) * 7))]!;
      g += `<rect x="${left + hh * cw + 1}" y="${top + r * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="3" fill="${c}"><title>${WD[r]} ${hh}:00 — ${fmtBaht(v)}</title></rect>`;
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${left + cw * 24} ${top + ch * 7 + 4}" width="100%" role="img" font-family="Noto Sans Thai, sans-serif">${g}</svg>`;
}
