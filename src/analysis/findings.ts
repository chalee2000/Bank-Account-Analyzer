// ร่างผลวิเคราะห์ 4 ระดับ: ข้อเท็จจริง (Fact) / ข้อสังเกต (Observation) / สมมติฐาน (Hypothesis) / ข้อเสนอแนะ (Recommendation)
// หลักบังคับ: ใช้ภาษาระมัดระวัง ("พบว่า…", "อาจ…", "ควรตรวจสอบเพิ่มเติม…") ห้ามสรุปความผิดจากธุรกรรมเพียงอย่างเดียว
// ข้อความทุกชุดถูกตรวจด้วยเทสต์ว่าไม่มีคำต้องห้ามหลุดออกไป (tests/unit/findings.test.ts)

import type { AltHypothesis, AnalysisResult, Finding, Signal, SignalType } from '../core/types';
import { fmtBaht, fmtInt, formatThaiDate } from '../core/thai';
import { accountLabel, type Ctx } from './ctx';
import { PRIORITY_DISCLAIMER } from './priority';

export const FORBIDDEN_TERMS = [
  'บัญชีม้า', 'ผู้สั่งการ', 'เงินค่ายา', 'ค่ายาเสพติด', 'ฟอกเงิน', 'ผู้กระทำผิด', 'ผู้ต้องหา', 'ค้ายา', 'ขบวนการ',
  'เป็นผู้ร่วมกระทำ', 'แน่นอนว่า',
];

export const CLOSING_STATEMENT =
  'ธุรกรรมทางการเงินและค่าทางเครือข่ายเป็นเครื่องมือช่วยชี้เป้าและสร้างสมมติฐาน ไม่ใช่ข้อพิสูจน์ความผิดหรือความเกี่ยวข้องกับยาเสพติดโดยลำพัง ต้องตรวจสอบร่วมกับ CDR, Cell Site และพยานหลักฐานอื่นที่ได้มาโดยชอบด้วยกฎหมาย';

export const LIMITATIONS: string[] = [
  'รายการโทรศัพท์ (CDR) ไม่ได้บอกเนื้อหาการสนทนา และไม่ได้แสดงว่าใครเป็นผู้ใช้เครื่องในขณะนั้น',
  'ข้อมูลเสาสัญญาณ (Cell Site) เป็นตำแหน่งโดยประมาณของพื้นที่ให้บริการ ไม่ใช่พิกัด GPS ที่ยืนยันตำแหน่งบุคคล',
  'เจ้าของบัญชีไม่จำเป็นต้องเป็นผู้ควบคุมบัญชีหรือผู้ทำรายการจริง',
  'การปรากฏอยู่ในเครือข่ายธุรกรรมไม่ได้พิสูจน์การร่วมกระทำความผิด',
  'รูปแบบธุรกรรม (Pattern) ไม่ได้พิสูจน์วัตถุประสงค์ของเงิน',
  'การจับคู่เงินเข้า-ออกเพื่อคำนวณระยะเวลาถือเงินและเส้นทางเงินใช้สมมติฐานแบบเข้าก่อนออกก่อน (FIFO) ซึ่งเงินเป็นสิ่งที่ทดแทนกันได้ จึงไม่ได้ยืนยันว่าเป็นเงินก้อนเดียวกัน',
  'ผลการวิเคราะห์ขึ้นกับความครบถ้วนของ Statement ที่นำเข้า บัญชีที่ไม่มี Statement เห็นเฉพาะรายการที่ปรากฏในบัญชีอื่น',
  'รายการที่ไม่มีข้อมูลเวลา วิเคราะห์ได้ละเอียดระดับวันเท่านั้น และค่าที่อ่านจาก OCR อาจคลาดเคลื่อนแม้ผ่านการตรวจแก้',
];

export function defaultAltHypotheses(): AltHypothesis[] {
  return [
    'ธุรกิจปกติของเจ้าของบัญชี (ค้าขาย/รับชำระค่าสินค้าและบริการ)',
    'ตัวแทนรับ-จ่ายหรือรวบรวมเงินแทนผู้อื่นตามปกติ',
    'เงินเดือน ค่าแรง หรือค่าจ้าง',
    'การชำระหนี้ หรือยืม-คืนเงินระหว่างบุคคล',
    'ซื้อขายสินค้าหรือทรัพย์สินระหว่างบุคคล',
    'สมาชิกครอบครัวหรือบุคคลใกล้ชิดใช้บัญชีร่วมกัน',
    'ผู้ควบคุมบัญชีจริงไม่ใช่เจ้าของบัญชี (ถูกยืมใช้หรือถูกใช้แทน)',
    'ธุรกรรมที่ดูต่อเนื่องอาจไม่ใช่เงินก้อนเดียวกัน (การจับคู่แบบ FIFO เป็นเพียงสมมติฐาน)',
  ].map((label, i) => ({ id: `alt${i + 1}`, label, status: 'open' as const }));
}

const OBS: Record<SignalType, string> = {
  rapid_movement:
    'ลักษณะเงินเข้าแล้วออกต่อในเวลาสั้นสอดคล้องกับบัญชีที่ทำหน้าที่เป็นทางผ่านของเงิน แต่ก็พบได้ในการใช้บัญชีตามปกติ เช่น การรับเงินแทนแล้วโอนต่อ',
  structuring:
    'การโอนเป็นก้อนยอดใกล้เคียงกันไปหลายบัญชีในเวลาสั้นสอดคล้องกับรูปแบบการแบ่งโอน (Splitting) แต่ก็อาจเกิดจากข้อจำกัดวงเงินต่อรายการ หรือการจ่ายเงินให้ผู้รับหลายรายตามปกติ',
  convergence:
    'การรับเงินจากหลายบัญชีในเวลาใกล้กันแล้วส่งต่อสอดคล้องกับลักษณะจุดรวมเงิน (Convergence) แต่ก็อาจเป็นบัญชีรับชำระหรือผู้เก็บเงินแทนกลุ่มตามปกติ',
  layering:
    'เส้นทางที่เงินผ่านหลายบัญชีติดต่อกันโดยยอดคงเหลือใกล้เคียงเดิมในเวลาสั้นสอดคล้องกับการส่งต่อผ่านบัญชีทางผ่าน (Layering) ทั้งนี้การจับคู่เส้นทางเป็นสมมติฐานจากเวลาและยอดเงิน ยังไม่ยืนยันว่าเป็นเงินก้อนเดียวกัน',
  circular:
    'เงินที่วนกลับมายังบัญชีต้นทางอาจเกิดจากการคืนเงิน ยืม-คืน หรือการโอนระหว่างบัญชีที่ใช้ร่วมกัน ซึ่งเป็นเรื่องปกติได้',
  cash_out:
    'การถอนเงินสดจำนวนสูงตามหลังเงินโอนเข้าในเวลาสั้นสอดคล้องกับลักษณะจุดถอนเงินสด (Cash-out) แต่เป็นพฤติกรรมที่พบได้ในการใช้บัญชีทั่วไป',
  cross_bank:
    'การส่งต่อเงินข้ามหลายธนาคารในเวลาสั้นทำให้ติดตามยากขึ้น แต่การโอนข้ามธนาคารเป็นเรื่องปกติของระบบพร้อมเพย์',
  repeated:
    'รูปแบบเดิมที่เกิดซ้ำหลายวันบ่งชี้ว่าไม่ใช่เหตุการณ์ครั้งเดียว อย่างไรก็ดีหากเป็นคู่บัญชีและยอดเท่าเดิมเป็นรอบ อาจเป็นการชำระตามกำหนด เช่น ค่าเช่า เงินเดือน หรือการผ่อนชำระ',
  near_threshold:
    'ยอดที่อยู่ใต้วงเงินที่ตั้งไว้เล็กน้อยหลายรายการอาจเกี่ยวข้องกับการจัดยอดให้ต่ำกว่าวงเงิน หรืออาจเป็นผลจากวงเงินต่อรายการของช่องทางทำรายการ',
};

const HYP: Record<SignalType, (who: string) => string> = {
  rapid_movement: (who) => `${who} อาจมีบทบาทเป็นบัญชีทางผ่าน (Transit) หรืออาจเป็นการรับ-จ่ายเงินแทนผู้อื่นตามปกติ ต้องทดสอบด้วยหลักฐานอื่น`,
  structuring: (who) => `${who} อาจมีบทบาทเป็นจุดกระจายเงิน (Source/Distributor) หรืออาจเป็นการจ่ายเงินให้ผู้รับหลายรายตามปกติทางธุรกิจ`,
  convergence: (who) => `${who} อาจมีบทบาทเป็นจุดรวมเงิน (Convergence Point) ซึ่งต้องแยกจากบัญชีรับชำระปกติ`,
  layering: () => 'บัญชีระหว่างทางอาจมีบทบาทเป็นบัญชีทางผ่าน (Transit/Layering) หรืออาจเป็นการชำระหนี้/ซื้อขายต่อเนื่องที่ไม่เกี่ยวข้องกัน',
  circular: () => 'อาจเป็นการหมุนเงินเพื่อเพิ่มความซับซ้อนของเส้นทาง หรืออาจเป็นการโอนระหว่างบัญชีของบุคคลเดียวกัน/ครอบครัว',
  cash_out: (who) => `${who} หรือผู้ใช้ตู้/สาขาที่ถอนอาจเกี่ยวข้องกับขั้นตอนถอนเงินสด (Cash-out) ซึ่งต้องยืนยันว่าใครเป็นผู้ถอนจริง`,
  cross_bank: () => 'อาจเป็นการกระจายเส้นทางเงินข้ามธนาคาร หรืออาจเป็นการใช้บัญชีหลายธนาคารตามความสะดวก',
  repeated: () => 'อาจเป็นพฤติกรรมที่ทำเป็นระบบต่อเนื่อง หรืออาจเป็นรอบชำระตามปกติ',
  near_threshold: () => 'อาจมีการจัดยอดให้ต่ำกว่าวงเงิน หรืออาจเป็นไปตามวงเงินต่อรายการของช่องทางทำรายการ',
};

const REC: Record<SignalType, string> = {
  rapid_movement:
    'ควรตรวจ KYC และผู้ควบคุมบัญชีจริง ช่องทาง/อุปกรณ์ที่ใช้ทำรายการ ความสัมพันธ์ระหว่างเจ้าของบัญชีกับคู่โอน และขอคำอธิบายที่มา-ปลายทางของเงิน พร้อมพิจารณาคำอธิบายทางเลือก',
  structuring:
    'ควรตรวจความสัมพันธ์ของผู้รับแต่ละบัญชี (KYC, หมายเลขโทรศัพท์ที่ผูกบัญชี) ตรวจ CDR/Cell Site ของผู้โอนในช่วงเวลาดังกล่าว และตรวจเอกสารการจ่ายเงินรองรับ',
  convergence:
    'ควรตรวจกิจกรรมทางธุรกิจของเจ้าของบัญชี ที่มาของผู้โอนแต่ละราย และเงินที่ส่งต่อไปยังบัญชีใด (ใช้ Forward Trace) พร้อมเทียบกับ CDR',
  layering:
    'ควรตรวจ KYC ผู้ควบคุมบัญชีและอุปกรณ์ของทุกบัญชีในเส้นทาง ตรวจ CDR/Cell Site ในช่วงเวลาทำรายการ และขอ Statement ของบัญชีระหว่างทางที่ยังไม่มีในคดี',
  circular:
    'ควรตรวจว่าบัญชีในวงจรมีผู้ควบคุมเดียวกันหรือไม่ (KYC, อุปกรณ์, เบอร์โทร) และมีเอกสารการยืม-คืนรองรับหรือไม่',
  cash_out:
    'ควรขอภาพ CCTV ตู้ ATM/สาขา ณ เวลาที่ถอน เทียบพิกัดตู้กับ Cell Site ของบุคคลที่เกี่ยวข้อง และตรวจบัตร/อุปกรณ์ที่ใช้ถอน',
  cross_bank:
    'ควรขอข้อมูลบัญชีจากทุกธนาคารในเส้นทางพร้อมกันเพื่อเทียบเวลาและอุปกรณ์ที่ใช้ทำรายการ',
  repeated:
    'ควรเปรียบเทียบกับพฤติกรรมพื้นฐานของบัญชีก่อนช่วงที่สนใจ (Baseline) และตรวจเอกสารที่มาของรอบการชำระ',
  near_threshold:
    'ควรตรวจวงเงินต่อรายการ/ต่อวันของช่องทางที่ใช้ และเปรียบเทียบกับพฤติกรรมในช่วงเวลาอื่น',
};

export function buildFindings(
  ctx: Ctx,
  r: Pick<AnalysisResult, 'profiles' | 'pairs' | 'signals' | 'priority' | 'quality'>,
  maxSignals = 15,
): Finding[] {
  const out: Finding[] = [];
  let n = 0;
  const id = () => `auto${++n}`;
  const q = r.quality;
  const realAccounts = Object.values(ctx.accounts).filter((a) => a.kind === 'account');
  const withStatement = realAccounts.filter((a) => a.hasStatement).length;

  if (q.firstTs !== undefined && q.lastTs !== undefined && ctx.txns.length) {
    const totalAmt = ctx.txns.reduce((a, t) => a + t.amount, 0);
    out.push({
      id: id(), level: 'fact', source: 'auto', include: true, group: 'overview',
      text:
        `ข้อมูลที่นำเข้าครอบคลุมช่วงเวลา ${formatThaiDate(q.firstTs, true)} ถึง ${formatThaiDate(q.lastTs, true)} ` +
        `เกี่ยวข้องกับ ${fmtInt(realAccounts.length)} บัญชี (มี Statement ${fmtInt(withStatement)} บัญชี) ` +
        `รวม ${fmtInt(ctx.txns.length)} ธุรกรรม มูลค่ารวม ${fmtBaht(totalAmt)} บาท` +
        (q.mirrorsMerged ? ` (รวมรายการที่ปรากฏซ้ำในสองฝั่ง ${fmtInt(q.mirrorsMerged)} รายการเป็นรายการเดียว)` : ''),
    });
  }

  const topPairs = r.pairs.filter((p) => ctx.accounts[p.from]?.kind === 'account' && ctx.accounts[p.to]?.kind === 'account').slice(0, 3);
  if (topPairs.length) {
    out.push({
      id: id(), level: 'fact', source: 'auto', include: true, group: 'overview',
      text:
        'คู่บัญชีที่มียอดโอนรวมสูงสุด ได้แก่ ' +
        topPairs
          .map((p) => `${accountLabel(ctx.accounts[p.from])} → ${accountLabel(ctx.accounts[p.to])} ${fmtBaht(p.total)} บาท (${fmtInt(p.count)} ครั้ง)`)
          .join('; '),
    });
  }

  // ---- สัญญาณที่เด่นที่สุด ----
  // สัญญาณเด่น (ความเด่น ≥2) ก่อน; ถ้ามีน้อยกว่า 5 เติมด้วยสัญญาณที่เด่นรองลงมา
  const strong = r.signals.filter((s) => s.prominence >= 2);
  const weak = r.signals.filter((s) => s.prominence < 2 && s.type !== 'near_threshold');
  const candidates = [...strong, ...weak.slice(0, Math.max(0, 5 - strong.length))].slice(0, maxSignals);
  for (const s of candidates) {
    const who = accountLabel(ctx.accounts[s.focus[0] ?? '']);
    const g = s.id;
    out.push({ id: id(), level: 'fact', source: 'auto', include: s.prominence >= 2, group: g, signalId: s.id, txnIds: s.txnIds.slice(0, 80), text: s.summary + (s.timeApprox ? ' (บางรายการไม่มีเวลา ระยะเวลาเป็นค่าประมาณระดับวัน)' : '') });
    out.push({ id: id(), level: 'observation', source: 'auto', include: s.prominence >= 2, group: g, signalId: s.id, text: OBS[s.type] });
    out.push({ id: id(), level: 'hypothesis', source: 'auto', include: s.prominence >= 2, group: g, signalId: s.id, text: HYP[s.type](who) });
    out.push({ id: id(), level: 'recommendation', source: 'auto', include: s.prominence >= 2, group: g, signalId: s.id, text: REC[s.type] });
  }

  // ---- คุณภาพข้อมูล ----
  const dq: string[] = [];
  if (q.duplicatesRemoved) dq.push(`พบรายการซ้ำข้ามไฟล์และถูกตัดออก ${fmtInt(q.duplicatesRemoved)} รายการ`);
  if (q.skipped) dq.push(`มีแถวที่อ่านไม่ได้หรือถูกข้าม ${fmtInt(q.skipped)} แถว`);
  if (q.balanceMismatch) dq.push(`ยอดคงเหลือไม่ต่อเนื่อง ${fmtInt(q.balanceMismatch)} รายการ`);
  if (q.noCounterparty) dq.push(`มี ${fmtInt(q.noCounterparty)} รายการที่ไม่ระบุคู่บัญชี จึงไม่สามารถนำไปเชื่อมในเครือข่ายได้`);
  if (q.noTime) dq.push(`มี ${fmtInt(q.noTime)} รายการที่ไม่มีเวลา`);
  if (q.inferredCounterparty) dq.push(`มี ${fmtInt(q.inferredCounterparty)} รายการที่คู่บัญชีได้จากการอ่านข้อความรายละเอียด ซึ่งควรตรวจกับต้นฉบับ`);
  if (dq.length) {
    out.push({ id: id(), level: 'fact', source: 'auto', include: true, group: 'quality', text: 'คุณภาพข้อมูล: ' + dq.join('; ') });
    out.push({
      id: id(), level: 'recommendation', source: 'auto', include: true, group: 'quality',
      text: 'ควรตรวจทานรายการที่ถูกข้าม/ยอดคงเหลือไม่ต่อเนื่องกับไฟล์ต้นฉบับ และขอ Statement ที่ขาดเพิ่มเติมก่อนสรุปผลจากข้อมูลชุดนี้',
    });
  }

  // ---- ลำดับตรวจสอบ ----
  const top = r.priority.slice(0, 5).filter((p) => p.orderingScore > 0);
  if (top.length) {
    out.push({
      id: id(), level: 'observation', source: 'auto', include: true, group: 'priority',
      text:
        'บัญชีที่ค่าตัวชี้วัดโครงสร้างเด่นเมื่อเทียบกับบัญชีอื่นในคดีนี้ (ควรเปิดดูก่อน): ' +
        top.map((p) => accountLabel(ctx.accounts[p.accountId])).join('; ') +
        `. ${PRIORITY_DISCLAIMER}`,
    });
  }
  return out;
}

export function signalLabel(type: SignalType): string {
  return SIGNAL_LABEL[type];
}

export const SIGNAL_LABEL: Record<SignalType, string> = {
  rapid_movement: 'เงินไหลผ่านเร็ว (Rapid Movement)',
  structuring: 'แบ่งโอนยอดใกล้เคียงกัน (Structuring/Splitting)',
  convergence: 'รวมเงินเข้าบัญชีเดียว (Convergence)',
  layering: 'ส่งต่อเงินผ่านบัญชีต่อเนื่อง (Layering/Transit)',
  circular: 'เงินวนกลับต้นทาง (Circular)',
  cash_out: 'ถอนเงินสดหลังรับโอน (Cash-out)',
  cross_bank: 'ส่งต่อข้ามหลายธนาคาร (Cross-bank)',
  repeated: 'รูปแบบซ้ำหลายวัน (Repeated)',
  near_threshold: 'ยอดใต้วงเงินที่กำหนด (Near-threshold)',
};

export type { Signal };
