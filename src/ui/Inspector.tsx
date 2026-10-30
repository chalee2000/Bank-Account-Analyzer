import { useEffect, useState } from 'preact/hooks';
import { draftOf, noteOf, PersonFields, PersonPhoto, type PersonDraft } from './PersonEditor';
import { accounts, analysis, cs, derived, go, inspector, labelOf, mergeAccounts, notify, openInspector, patchCase, setAccountNote, txnById } from '../state';
import { Icon } from './icons';
import { ComponentBars, COMP_LABELS } from './charts';
import { Prominence } from './common';
import { FLAG_LABEL, KIND_LABEL, metricRows } from './labels';
import { bankDisplay, formatAccountNumber } from '../core/normalize';
import { fmtBaht, fmtDuration, fmtInt, fmtPct, formatThaiDateTime } from '../core/thai';
import { ROLE_LABEL, SIGNAL_LABEL, PRIORITY_DISCLAIMER } from '../analysis';
import { EVIDENCE_LABEL, type EvidenceKey, type Finding, type Signal } from '../core/types';
import { newId } from '../store/model';

export function Inspector() {
  const t = inspector.value;
  if (!t) return null;
  const title = t.kind === 'account' ? 'รายละเอียดบัญชี' : t.kind === 'signal' ? 'รายละเอียดสัญญาณ' : 'รายละเอียดธุรกรรม';
  return (
    <aside class="inspector" aria-label={title}>
      <div class="inspector-head">
        <h2 class="grow">{title}</h2>
        <button class="btn ghost icon sm" onClick={() => openInspector(null)} aria-label="ปิดแผงรายละเอียด"><Icon name="close" /></button>
      </div>
      <div class="inspector-body">
        {t.kind === 'account' && <AccountPanel key={t.id} id={t.id} />}
        {t.kind === 'signal' && <SignalPanel id={t.id} />}
        {t.kind === 'txn' && <TxnPanel id={t.id} />}
      </div>
    </aside>
  );
}

export function AccountLink({ id, short }: { id: string; short?: boolean }) {
  const a = accounts.value[id];
  const label = labelOf(id, !short);
  if (!a || a.kind !== 'account') return <span>{label}</span>;
  return (
    <a href="javascript:void(0)" onClick={(e) => { e.preventDefault(); openInspector({ kind: 'account', id }); }} title={label}>{label}</a>
  );
}

function AccountPanel({ id }: { id: string }) {
  const a = accounts.value[id];
  const res = analysis.value;
  const st = cs.value!;
  const saved = st.accountNotes[id];
  const [draft, setDraft] = useState<PersonDraft>(() => draftOf(saved));
  // แก้จากที่อื่น (เมนูคลิกขวาบนผัง) → แสดงค่าล่าสุด
  useEffect(() => setDraft(draftOf(saved)), [saved]);
  if (!a) return <div class="muted">ไม่พบบัญชี</div>;
  const p = res?.profiles[id];
  const m = res?.metrics[id];
  const prio = res?.priority.find((x) => x.accountId === id);
  const hints = res?.roleHints[id] ?? [];
  const sigs = (res?.signals ?? []).filter((s) => s.focus.includes(id) && s.type !== 'near_threshold' ).slice(0, 12);
  const pairs = res?.pairs ?? [];
  const topIn = pairs.filter((x) => x.to === id).slice(0, 5);
  const topOut = pairs.filter((x) => x.from === id).slice(0, 5);
  const suggestions = (derived.value?.aliasSuggestions ?? []).filter((s) => s.a === id || s.b === id);
  const inGroup = st.aliases.find((g) => g.members.includes(id));

  return (
    <>
      <div class="row" style="align-items:flex-start">
        {saved?.photo && <PersonPhoto src={saved.photo} size={56} alt={`รูปของ ${a.label || a.name || 'บุคคล'}`} />}
        <div class="grow" style="min-width:0">
        <div style="font-size:16px;font-weight:600">{a.label || a.name || (a.number ? formatAccountNumber(a.number) : a.id)}</div>
        {a.kind === 'account' && (
          <div class="secondary small">
            {a.number ? formatAccountNumber(a.number) : 'ไม่ทราบเลขบัญชี'} {a.bank ? '· ' + bankDisplay(a.bank) : ''}
          </div>
        )}
        {a.label && a.name && a.label !== a.name && <div class="tiny muted">ชื่อบัญชีตามข้อมูลธนาคาร: {a.name}</div>}
        </div>
      </div>
      <div>
        <div class="row wrap" style="margin-top:6px">
          {a.kind === 'account' && (a.hasStatement ? <span class="chip accent">มี Statement</span> : <span class="chip">ไม่มี Statement (เห็นเฉพาะรายการในบัญชีอื่น)</span>)}
          {a.masked && <span class="chip warn">เลขบัญชีถูกปิดบางส่วน</span>}
          {inGroup && <span class="chip">รวมจาก {inGroup.members.length} รหัส</span>}
        </div>
      </div>

      {a.meta && Object.keys(a.meta).length > 0 && (
        <section class="stack tight">
          <h3>ข้อมูลจากหัวเอกสาร Statement</h3>
          <dl class="kv-list">
            {Object.entries(a.meta).map(([k, v]) => (<><dt key={k}>{k}</dt><dd>{v}</dd></>))}
          </dl>
        </section>
      )}

      {p && (
        <div class="grid cols-2 keep2" style="gap:8px">
          <MiniKpi label="เงินเข้า" value={fmtBaht(p.totalIn)} sub={`${fmtInt(p.inCount)} รายการ · ${p.uniqueSenders} ผู้ส่ง`} />
          <MiniKpi label="เงินออก" value={fmtBaht(p.totalOut)} sub={`${fmtInt(p.outCount)} รายการ · ${p.uniqueReceivers} ผู้รับ`} />
          <MiniKpi label="สุทธิ" value={fmtBaht(p.net)} />
          <MiniKpi label="Flow-through" value={fmtPct(p.flowThrough)} sub="เงินออก/เงินเข้า" />
          <MiniKpi label="ถือเงินมัธยฐาน" value={fmtDuration(p.holding.medianMs)} sub={`ต่ำสุด ${fmtDuration(p.holding.minMs)}`} />
          <MiniKpi label="ออกภายใน 60 นาที" value={fmtPct(p.holding.shareWithin[60] * 100, 0)} sub={`ภายใน 15 นาที ${fmtPct(p.holding.shareWithin[15] * 100, 0)}`} />
        </div>
      )}

      {p?.holding.unmatchedOut ? (
        <div class="tiny muted">เงินออก {fmtBaht(p.holding.unmatchedOut)} บาท ไม่มีเงินเข้าที่ปรากฏในข้อมูลรองรับ (อาจเป็นยอดยกมาหรือ Statement ไม่ครบ)</div>
      ) : null}

      <div class="row wrap">
        <button class="btn sm" onClick={() => go('/trace', { acc: id, dir: 'forward' })}><Icon name="trace" size={15} />ไล่เงินออก</button>
        <button class="btn sm" onClick={() => go('/trace', { acc: id, dir: 'backward' })}><Icon name="trace" size={15} />ย้อนที่มาเงินเข้า</button>
        <button class="btn sm" onClick={() => go('/network', { focus: id })}><Icon name="network" size={15} />ดูในเครือข่าย</button>
        <button class="btn sm" onClick={() => go('/transactions', { acc: id })}><Icon name="list" size={15} />ธุรกรรม</button>
      </div>

      {hints.length > 0 && (
        <section class="stack tight">
          <h3>บทบาทเบื้องต้นที่ “อาจมี”</h3>
          {hints.map((h) => (
            <div key={h.role} class="small"><b>{ROLE_LABEL[h.role]}</b><div class="muted">{h.reason}</div></div>
          ))}
          <div class="disclaimer">ป้ายเหล่านี้ได้จากโครงสร้างข้อมูลเท่านั้น ยังไม่ใช่ข้อเท็จจริงเรื่องบทบาทของบุคคล ต้องยืนยันด้วยหลักฐานอื่น</div>
        </section>
      )}

      {m && (
        <section class="stack tight">
          <h3>ตัวชี้วัดเครือข่าย</h3>
          <dl class="kv-list">
            <dt>จำนวนบัญชีที่โอนเข้า / โอนออก</dt><dd>{m.inDegree} / {m.outDegree}</dd>
            <dt>Betweenness (0–1)</dt><dd>{m.betweenness.toFixed(3)}</dd>
            <dt>จุดตัดของเครือข่าย</dt><dd>{m.isBridge ? 'ใช่' : 'ไม่ใช่'}</dd>
            <dt>กลุ่มเครือข่าย (component)</dt><dd>#{m.component + 1}</dd>
            <dt>ชุมชน (community)</dt><dd>#{m.community + 1}</dd>
          </dl>
          <div class="disclaimer">Centrality หรือ Degree สูงไม่ได้หมายความว่ามีความผิด และ Betweenness สูงไม่ได้แปลว่าเป็นผู้สั่งการ</div>
        </section>
      )}

      {prio && (
        <section class="stack tight">
          <h3>องค์ประกอบลำดับการตรวจสอบ</h3>
          <div class="row"><ComponentBars comps={prio.components as unknown as Record<string, number>} /><span class="small muted">ค่าสัมพัทธ์ในคดีนี้</span></div>
          <dl class="kv-list">
            {Object.entries(prio.components).map(([k, v]) => (<><dt key={k}>{COMP_LABELS[k]}</dt><dd>{Math.round((v as number) * 100)}%</dd></>))}
          </dl>
          <div class="disclaimer">{PRIORITY_DISCLAIMER}</div>
        </section>
      )}

      {(topIn.length > 0 || topOut.length > 0) && (
        <section class="stack tight">
          <h3>คู่บัญชีสำคัญ</h3>
          {topIn.length > 0 && <div class="small secondary">รับจาก</div>}
          {topIn.map((x) => (
            <div class="row small" key={'i' + x.from}><span class="grow ellipsis"><AccountLink id={x.from} short /></span><span class="num">{fmtBaht(x.total)}</span><span class="muted">×{x.count}</span></div>
          ))}
          {topOut.length > 0 && <div class="small secondary" style="margin-top:6px">โอนให้</div>}
          {topOut.map((x) => (
            <div class="row small" key={'o' + x.to}><span class="grow ellipsis"><AccountLink id={x.to} short /></span><span class="num">{fmtBaht(x.total)}</span><span class="muted">×{x.count}</span></div>
          ))}
        </section>
      )}

      {sigs.length > 0 && (
        <section class="stack tight">
          <h3>สัญญาณที่เกี่ยวข้อง</h3>
          {sigs.map((s) => (
            <div key={s.id} class="row small" style="cursor:pointer" onClick={() => openInspector({ kind: 'signal', id: s.id })}>
              <Prominence n={s.prominence} /><span class="grow ellipsis">{SIGNAL_LABEL[s.type]}</span><span class="num">{fmtBaht(s.totalAmount)}</span>
            </div>
          ))}
        </section>
      )}

      {suggestions.length > 0 && (
        <section class="stack tight">
          <h3>อาจเป็นบัญชีเดียวกัน?</h3>
          {suggestions.map((s) => {
            const other = s.a === id ? s.b : s.a;
            return (
              <div key={other} class="notice warn">
                <div class="grow">
                  <b>{labelOf(other)}</b>
                  <div class="small">{s.reason}</div>
                  <div class="tiny muted">เลขที่ถูกปิดบางส่วนอาจตรงกับได้หลายบัญชี — รวมเมื่อมั่นใจจากหลักฐานอื่นเท่านั้น</div>
                  <button class="btn sm" style="margin-top:6px" onClick={() => mergeAccounts(s.a, s.b)}>ยืนยัน: รวมเป็นบัญชีเดียว</button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {a.kind === 'account' && (
        <section class="stack tight">
          <h3>บันทึกของผู้สืบสวน: ชื่อ-นามสกุล และรูปบุคคล</h3>
          <PersonFields draft={draft} onChange={setDraft} onCommit={(d) => void setAccountNote(id, noteOf(d))} />
        </section>
      )}
    </>
  );
}

function MiniKpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style="background:var(--surface-2);border-radius:8px;padding:8px 10px">
      <div class="tiny muted">{label}</div>
      <div style="font-weight:600;font-variant-numeric:tabular-nums">{value}</div>
      {sub && <div class="tiny muted">{sub}</div>}
    </div>
  );
}

export function addSignalToFindings(s: Signal) {
  const st = cs.peek()!;
  const g = 'manual-' + s.id;
  if (st.findings.some((f) => f.group === g)) {
    notify('สัญญาณนี้อยู่ในผลวิเคราะห์แล้ว');
    return;
  }
  const mk = (level: Finding['level'], text: string): Finding => ({ id: newId('f_'), level, text, include: true, source: 'manual', group: g, signalId: s.id, txnIds: s.txnIds.slice(0, 80) });
  void patchCase({
    findings: [
      ...st.findings,
      mk('fact', s.summary),
      mk('observation', 'ผู้สืบสวนเพิ่มสัญญาณนี้เพื่อพิจารณา — โปรดระบุข้อสังเกตเพิ่มเติม'),
    ],
  });
  notify('เพิ่มลงในผลวิเคราะห์แล้ว (หน้า “ผลวิเคราะห์”)');
}

function SignalPanel({ id }: { id: string }) {
  const s = analysis.value?.signals.find((x) => x.id === id);
  if (!s) return <div class="muted">ไม่พบสัญญาณ (ข้อมูลอาจถูกวิเคราะห์ใหม่)</div>;
  const txns = s.txnIds.map((t) => txnById.value.get(t)).filter(Boolean) as NonNullable<ReturnType<typeof txnById.value.get>>[];
  return (
    <>
      <div>
        <div class="row"><Prominence n={s.prominence} /><b>{SIGNAL_LABEL[s.type]}</b></div>
        <div class="small muted">{formatThaiDateTime(s.startTs, !s.timeApprox)}{s.endTs !== s.startTs ? ' → ' + formatThaiDateTime(s.endTs, !s.timeApprox) : ''}</div>
      </div>
      <p>{s.summary}</p>
      {s.timeApprox && <div class="notice warn small">บางรายการไม่มีเวลา ช่วงเวลาที่แสดงเป็นค่าประมาณระดับวัน</div>}
      <dl class="kv-list">
        <dt>ยอดเงินที่เกี่ยวข้อง</dt><dd>{fmtBaht(s.totalAmount)}</dd>
        {metricRows(s.metrics).map((r) => (<><dt key={r.label}>{r.label}</dt><dd>{r.value}</dd></>))}
      </dl>
      <div class="disclaimer">สัญญาณเป็นรูปแบบที่ควรตรวจสอบต่อ ไม่ใช่ข้อพิสูจน์ความผิด ความเด่นของสัญญาณบอกว่าเกินเกณฑ์มากเพียงใด ไม่ใช่ระดับความผิด</div>
      <div class="row wrap">
        <button class="btn sm primary" onClick={() => addSignalToFindings(s)}><Icon name="plus" size={15} />เพิ่มในผลวิเคราะห์</button>
        <button class="btn sm" onClick={() => go('/network', { focus: s.focus.join(',') })}><Icon name="network" size={15} />ดูในเครือข่าย</button>
        <button class="btn sm" onClick={() => go('/transactions', { sig: s.id })}><Icon name="list" size={15} />ธุรกรรมทั้งหมด</button>
      </div>
      <section class="stack tight">
        <h3>บัญชีที่เกี่ยวข้อง</h3>
        {s.focus.slice(0, 12).map((f) => (<div key={f} class="small"><AccountLink id={f} /></div>))}
      </section>
      <section class="stack tight">
        <h3>ธุรกรรมหลักฐาน ({fmtInt(s.txnIds.length)})</h3>
        {txns.slice(0, 40).map((t) => (
          <div key={t.id} class="row small" style="cursor:pointer" onClick={() => openInspector({ kind: 'txn', id: t.id })}>
            <span class="muted nowrap">{formatThaiDateTime(t.ts, t.hasTime).replace(' เวลา', '')}</span>
            <span class="grow ellipsis">{labelOf(t.from, false)} → {labelOf(t.to, false)}</span>
            <span class="num">{fmtBaht(t.amount)}</span>
          </div>
        ))}
        {txns.length > 40 && <div class="tiny muted">…และอีก {txns.length - 40} รายการ (ดูทั้งหมดในหน้าธุรกรรม)</div>}
      </section>
    </>
  );
}

function TxnPanel({ id }: { id: string }) {
  const t = txnById.value.get(id);
  const files = cs.value!.files;
  if (!t) return <div class="muted">ไม่พบธุรกรรม</div>;
  return (
    <>
      <div>
        <div style="font-size:20px;font-weight:600;font-variant-numeric:tabular-nums">{fmtBaht(t.amount)} <span class="small muted">บาท</span></div>
        <div class="small secondary">{formatThaiDateTime(t.ts, t.hasTime, true)}{!t.hasTime && ' (ไม่มีเวลา)'}</div>
      </div>
      <div class="stack tight">
        <div class="small muted">จาก</div><AccountLink id={t.from} />
        <div class="small muted">ไป</div><AccountLink id={t.to} />
      </div>
      <dl class="kv-list">
        <dt>ชนิด</dt><dd>{KIND_LABEL[t.kind]}</dd>
        {t.channel && <><dt>ช่องทาง</dt><dd>{t.channel}</dd></>}
        {t.location && <><dt>สถานที่/ตู้</dt><dd>{t.location}</dd></>}
        {t.reference && <><dt>เลขอ้างอิง</dt><dd>{t.reference}</dd></>}
        {t.balanceAfter !== undefined && <><dt>ยอดคงเหลือหลังรายการ</dt><dd>{fmtBaht(t.balanceAfter)}</dd></>}
      </dl>
      {t.extra && Object.keys(t.extra).length > 0 && (
        <section class="stack tight">
          <h3>หลักฐานเสริมจาก Statement</h3>
          <dl class="kv-list">
            {(Object.keys(EVIDENCE_LABEL) as EvidenceKey[]).filter((k) => t.extra![k]).map((k) => (
              <><dt key={'k' + k}>{EVIDENCE_LABEL[k]}</dt>
                <dd key={'v' + k}>
                  {k === 'ip' || k === 'atmId' || k === 'phone' ? (
                    <a href="javascript:void(0)" title="ดูธุรกรรมอื่นที่มีค่านี้" onClick={(e) => { e.preventDefault(); go('/transactions', { q: t.extra![k]! }); }}>{t.extra![k]}</a>
                  ) : t.extra![k]}
                </dd></>
            ))}
          </dl>
          <div class="tiny muted">IP และเลขเครื่องที่ซ้ำกันบ่งชี้ว่าใช้เครือข่ายหรืออุปกรณ์เดียวกันได้ แต่ IP ของผู้ให้บริการมือถือถูกใช้ร่วมกันหลายคน จึงไม่ใช่ข้อพิสูจน์ว่าเป็นบุคคลเดียวกัน</div>
        </section>
      )}
      {t.description && <div><div class="small muted">รายละเอียดตามต้นฉบับ</div><div style="white-space:pre-wrap;word-break:break-word">{t.description}</div></div>}
      <div class="row wrap">
        {t.mirrored && <span class="chip accent" title="รายการนี้ปรากฏใน Statement ของทั้งสองบัญชี และถูกรวมเป็นรายการเดียว">ยืนยันจาก 2 Statement</span>}
        {t.inferred && <span class="chip warn" title="คู่บัญชีได้จากการอ่านข้อความหรือเลขที่ถูกปิดบางส่วน">คู่บัญชีเป็นการอนุมาน</span>}
        {(t.flags ?? []).map((f) => <span class="chip warn" key={f}>{FLAG_LABEL[f] ?? f}</span>)}
      </div>
      <section class="stack tight">
        <h3>แหล่งที่มา</h3>
        {t.sources.map((s, i) => {
          const f = files.find((x) => x.record.id === s.fileId);
          return <div class="small" key={i}>{f?.record.name ?? s.fileId} · แถวที่ {s.row}</div>;
        })}
      </section>
      <div class="row wrap">
        <button class="btn sm" onClick={() => go('/trace', { txn: t.id, dir: 'forward' })}><Icon name="trace" size={15} />ไล่เงินต่อจากรายการนี้</button>
        <button class="btn sm" onClick={() => go('/trace', { txn: t.id, dir: 'backward' })}><Icon name="trace" size={15} />ย้อนที่มาของรายการนี้</button>
      </div>
    </>
  );
}
