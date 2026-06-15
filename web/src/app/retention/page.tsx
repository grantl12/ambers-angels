export default function RetentionPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12">
      <div className="max-w-2xl mx-auto space-y-8 text-white/70 leading-relaxed">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Data Retention Policy</h1>
          <p className="text-sm text-white/40">Effective date: April 2, 2026 · Last reviewed: April 2, 2026</p>
        </div>

        <p className="text-sm">
          Amber's Angels collects the minimum data necessary to support active child recovery
          missions. This policy defines exactly what we keep, for how long, and how it is
          deleted. We do not retain data beyond operational necessity.
        </p>

        <Section title="Summary table">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-2 pr-4 text-white/50 font-medium">Data type</th>
                  <th className="text-left py-2 pr-4 text-white/50 font-medium">Retention period</th>
                  <th className="text-left py-2 text-white/50 font-medium">Deletion method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  ["Camera frames (raw JPEG)", "Deleted immediately after ALPR processing", "Unlinked from filesystem; not written to database"],
                  ["Drone GPS telemetry", "90 days", "Automated DELETE from telemetry_points"],
                  ["License plate detections", "1 year", "Automated DELETE from detections + detection_events"],
                  ["Alert records (Discord logs)", "3 years", "Manual review before deletion; used for audit/accountability"],
                  ["Mission records", "3 years", "Retained for historical records and grant accountability"],
                  ["Pilot account data", "Duration of account + 30 days after deletion request", "Hard DELETE from pilots table"],
                  ["Watchlist entries (manual)", "Until removed by admin", "Admin-managed; FEMA-sourced entries expire automatically after 24h"],
                  ["FEMA vehicle targets", "24 hours from ingestion", "Automatic expiry via expires_at column"],
                  ["Server logs (nginx, uvicorn)", "30 days", "Log rotation via logrotate"],
                ].map(([type, period, method]) => (
                  <tr key={type}>
                    <td className="py-2.5 pr-4 text-white/70">{type}</td>
                    <td className="py-2.5 pr-4 text-amber-400/80">{period}</td>
                    <td className="py-2.5 text-white/40">{method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Camera frames">
          Raw JPEG frames captured by pilot phones or drones are processed entirely in memory
          and on the local filesystem of the Amber's Angels server. Frames are written to a
          temporary processing queue, analyzed by OpenALPR and YOLOv8, and then immediately
          deleted. Frames are <strong className="text-white/80">never stored in the database</strong> and
          are <strong className="text-white/80">never transmitted to third parties</strong> except where
          a pilot has enabled the optional Plate Recognizer cloud enrichment (which sends only
          the frame, not pilot identity, to Plate Recognizer Inc. under their privacy policy).
          There is no long-term video archive.
        </Section>

        <Section title="Telemetry data">
          GPS positions, altitude, heading, and speed are recorded during active missions to
          power the live mission map. This data is retained for <strong className="text-white/80">90 days</strong> and
          then purged via a scheduled database job. Telemetry is never shared with third parties.
          It is used solely for mission coordination and post-mission debrief analysis by
          authorized pilots.
        </Section>

        <Section title="Detection records">
          License plate reads, confidence scores, vehicle attributes, and associated GPS
          coordinates are retained for <strong className="text-white/80">1 year</strong>. This window supports
          mission review, post-mission debrief, and model accuracy evaluation. After one
          year, detection records are permanently deleted. Plates that matched active alerts are
          flagged in the alert log, which is retained separately (see Alert records).
        </Section>

        <Section title="Alert records">
          Records of Discord notifications that were dispatched — including plate text, drone ID,
          timestamp, and vehicle description — are retained for <strong className="text-white/80">3 years</strong>.
          This retention supports accountability, auditing of false positives, and evidence
          preservation in the event a detection contributed to a recovery. Alert records may be
          subject to legal hold in connection with active law enforcement proceedings.
        </Section>

        <Section title="Pilot account data">
          Account data (name, email, phone, city, FAA certificate number, drone models) is
          retained for the lifetime of the account. Upon a verified deletion request, all
          personal fields are hard-deleted within <strong className="text-white/80">30 days</strong>. A
          pseudonymous record (username only) may be retained in mission logs for historical
          mission integrity. Deletion requests should be sent to{" "}
          <a href="mailto:info@amberangels.org" className="text-amber-400 hover:underline">
            info@amberangels.org
          </a>.
        </Section>

        <Section title="Automated enforcement">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>FEMA vehicle targets include an <code className="text-amber-400/80">expires_at</code> timestamp set 24 hours after ingestion. Expired targets are excluded from all queries automatically.</li>
            <li>Telemetry purge and detection purge are implemented as scheduled database jobs. If you self-host, run <code className="text-amber-400/80">backend/scripts/purge_expired.py</code> via cron or a scheduled task.</li>
            <li>Server logs rotate every 30 days via <code className="text-amber-400/80">logrotate</code>.</li>
          </ul>
        </Section>

        <Section title="Third-party data processors">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong className="text-white/80">Plate Recognizer</strong> — optional cloud enrichment. Frames sent only when local confidence exceeds threshold. Their retention policy is governed by their own privacy policy.</li>
            <li><strong className="text-white/80">Discord</strong> — alert notifications are sent to a private mission webhook. Discord retains messages per their terms of service.</li>
            <li><strong className="text-white/80">Expo / EAS</strong> — mobile app build infrastructure. No mission data is transmitted to Expo.</li>
            <li><strong className="text-white/80">Mapbox</strong> — map tile provider. Tile requests include no personal data beyond IP address.</li>
          </ul>
        </Section>

        <Section title="Data subject requests">
          To request a copy, correction, or deletion of your data, email{" "}
          <a href="mailto:info@amberangels.org" className="text-amber-400 hover:underline">
            info@amberangels.org
          </a>{" "}
          from the address associated with your account. We will respond within 14 days and
          complete eligible requests within 30 days.
        </Section>

        <Section title="Policy review">
          This policy is reviewed annually and whenever material changes to data handling
          practices occur. The effective date at the top of this page reflects the most recent
          revision. Active pilots will be notified by email of material changes.
        </Section>

        <div className="flex gap-6 text-xs text-white/30 pt-4 border-t border-white/8">
          <a href="/privacy" className="hover:text-white/60 transition-colors">Privacy Policy</a>
          <a href="/terms"   className="hover:text-white/60 transition-colors">Terms of Service</a>
        </div>
      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-white mb-2">{title}</h2>
      <div className="text-sm">{children}</div>
    </section>
  )
}
