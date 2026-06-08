'use client'

import s from '@/app/landing.module.css'

type LogEntry = { ts: string; type: string; msg: string; sub?: string }

const TYPE_CLS: Record<string, string> = {
  ALERT:   s.tAlert,
  NOTIFY:  s.tNotify,
  MISSION: s.tNotify,
  SCAN:    s.tScan,
  READ:    s.tRead,
  AGG:     s.tAgg,
  PEAK:    s.tPeak,
  STREAM:  s.tStream,
  PROC:    s.tStream,
}

const PHONE: LogEntry[] = [
  { ts: '14:15:57', type: 'ALERT',   msg: 'FEMA IPAWS — AMBER Alert ingested',                              sub: 'plate=YVJ024  ·  white sedan  ·  Carroll Co., GA' },
  { ts: '14:15:57', type: 'NOTIFY',  msg: '3 volunteers in coverage area — mission push sent' },
  { ts: '14:16:00', type: 'MISSION', msg: 'phone-1  ·  mission opened  ·  camera scanning active' },
  { ts: '14:16:20', type: 'SCAN',    msg: '/ingest/frame  ·  1 frame/sec  ·  OpenALPR + YOLO' },
  { ts: '14:16:43', type: 'READ',    msg: 'plate=YVJ024  ·  conf=90.2% raw → 95.15% composite  ·  MATCH',   sub: 'watchlist hit  ·  vehicle: white sedan  ·  profile ✓' },
  { ts: '14:16:43', type: 'ALERT',   msg: 'Discord dispatched  ·  frame attached  ·  ← 47 s alert-to-hit' },
  { ts: '14:16:48', type: 'PEAK',    msg: 'conf=99.00%  ·  aggregation window saturated' },
]

const DRONE: LogEntry[] = [
  { ts: '15:09:00', type: 'STREAM',  msg: 'DJI Avata  →  rtmp://amberangels.org/live/avata' },
  { ts: '15:09:05', type: 'PROC',    msg: 'rtmp_monitor  →  ffmpeg spawned  ·  3 fps frame extraction' },
  { ts: '15:09:14', type: 'READ',    msg: 'plate=SYVJ0Z4  ·  conf=86.8%  ·  PROBABLE',                      sub: 'fuzzy: len=7 ≠ watchlist len=6  ·  dismissed  ·  Z↔2 OCR variant noted' },
  { ts: '15:09:19', type: 'READ',    msg: 'plate=YVJ024  ·  conf=86.81%  ·  MATCH',                         sub: 'len=6 ✓  ·  0-char delta  ·  escalating to aggregation window' },
  { ts: '15:09:20', type: 'AGG',     msg: 'aggregation window filling  ·  composite confidence rising...' },
  { ts: '15:09:34', type: 'PEAK',    msg: 'conf=99.00%  ·  sustained  ·  193 alerted events  ·  5m 42s' },
  { ts: '15:09:34', type: 'ALERT',   msg: 'Discord dispatched  ·  frame attached  ·  ← 4 s stream-to-alert' },
]

const STATS = [
  { val: '47 s', label: 'alert-to-hit · phone' },
  { val: '4 s',  label: 'stream-to-hit · drone' },
  { val: '99%',  label: 'peak confidence · both' },
  { val: '193',  label: 'alerted events · 1 session' },
]

function Row({ e }: { e: LogEntry }) {
  return (
    <div className={s.termRow}>
      <span className={s.termTs}>{e.ts}</span>
      <span className={`${s.termBadge} ${TYPE_CLS[e.type] ?? s.tNotify}`}>{e.type}</span>
      <span className={s.termMsg}>
        {e.msg}
        {e.sub && <span className={s.termSub}><br />↳ {e.sub}</span>}
      </span>
    </div>
  )
}

export default function LiveTerminal() {
  return (
    <section id="livelog" className={`${s.section} ${s.termSection}`}>
      <div className={s.fadeUp}>
        <span className={s.label}>System in Action</span>
        <div className={s.sectionHeader}>
          <h2>Real logs. Real pipeline. June 7, 2026.</h2>
          <p>
            A demo AMBER Alert was injected and two volunteers responded — one phone, one drone.
            Both hit 99% peak confidence on the same plate within the same session.
          </p>
        </div>
      </div>

      <div className={`${s.terminal} ${s.fadeUp}`}>
        <div className={s.termHead}>
          <span className={s.termDot} data-color="red" />
          <span className={s.termDot} data-color="yellow" />
          <span className={s.termDot} data-color="green" />
          <span className={s.termTitle}>ambers-angels-api  ·  2026-06-07 UTC</span>
        </div>

        <div className={s.termBody}>
          <div className={s.termPipeLabel}>── Phone Pipeline ──────────────────────────────────────</div>
          {PHONE.map((e, i) => <Row key={i} e={e} />)}

          <div className={s.termPipeLabel} style={{ marginTop: '1.1rem' }}>
            ── Drone Pipeline (DJI Avata, same session) ─────────────
          </div>
          {DRONE.map((e, i) => <Row key={i} e={e} />)}

          <span className={s.termCursor} aria-hidden>█</span>
        </div>

        <div className={s.termStats}>
          {STATS.map(({ val, label }) => (
            <div key={label} className={s.termStat}>
              <strong>{val}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
