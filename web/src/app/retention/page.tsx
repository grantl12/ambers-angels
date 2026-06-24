export default function RetentionPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12">
      <div className="max-w-2xl mx-auto space-y-8 text-white/70 leading-relaxed">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Data Retention Policy</h1>
          <p className="text-sm text-white/40">Effective date: June 24, 2026</p>
        </div>

        <p className="text-sm">
          Amber&rsquo;s Angels collects the minimum data necessary to support active missing
          person recovery missions. This policy defines exactly what we keep, for how long,
          and how it is deleted. We do not retain data beyond operational necessity.
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
                  ["On-device scan results", "Matched: 30 days (non-alerted) / 1 year (alerted). No images stored.", "Automated purge by source tag"],
                  ["Camera frames (non-match)", "Deleted immediately after ALPR processing", "Unlinked from filesystem"],
                  ["Evidence frames (high-confidence match)", "1 year (aligned with detection record)", "Deleted with associated detection record"],
                  ["GPS telemetry", "90 days", "Automated purge from telemetry_points"],
                  ["Non-alerted detections", "30 days", "Automated purge from detection_events"],
                  ["Alerted detections (evidence)", "1 year", "Automated purge from detection_events"],
                  ["Alert records (dispatch logs)", "3 years", "Manual review before deletion; used for audit/accountability"],
                  ["FEMA/NWS vehicle targets", "24 hours from ingestion", "Automatic expiry via expires_at column"],
                  ["NCMEC case data", "30 days after case resolution", "Automated purge"],
                  ["NamUs/BOLO vehicle targets", "7 days (configurable)", "Automatic expiry via expires_at column"],
                  ["Manual watchlist entries", "Until removed by admin", "Admin-managed via web panel"],
                  ["Pilot account data", "Duration of account + 30 days after deletion", "Hard DELETE from database"],
                  ["Push notification tokens", "Duration of account", "Deleted with account"],
                  ["Server logs (nginx, application)", "30 days", "Log rotation (50 MB cap, 7-day retain for PM2)"],
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

        <Section title="Camera frames and evidence">
          <p className="mb-2">
            Our app has two scanning modes with different data handling:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-sm">
            <li><strong className="text-white/80">Background scan (on-device):</strong> license plate recognition runs entirely on the volunteer&rsquo;s phone. No camera frames or images are ever transmitted to or stored on our server. Only plate text, confidence, and GPS are sent.</li>
            <li><strong className="text-white/80">Active camera mode:</strong> frames are uploaded to our server for analysis by OpenALPR and YOLOv8. Non-matching frames are deleted immediately after processing.</li>
            <li><strong className="text-white/80">Evidence frames:</strong> when a frame produces a high-confidence match against an active alert, it is retained on our server as an evidence frame. Evidence frames are stored for up to <strong className="text-white/80">1 year</strong>, aligned with the associated detection record, and may be subject to legal hold. Evidence frames are never shared publicly — they are available only to authorized coordinators and, when relevant, the responding law enforcement agency.</li>
          </ul>
        </Section>

        <Section title="Telemetry data">
          GPS positions, altitude, heading, and speed are recorded during active scanning to
          power the live mission map. This data is retained for <strong className="text-white/80">90
          days</strong> and then purged. Telemetry is never shared with third parties. It is
          used solely for mission coordination by authorized volunteers.
        </Section>

        <Section title="Detection records">
          <ul className="list-disc pl-5 space-y-1.5 text-sm">
            <li><strong className="text-white/80">Non-alerted detections</strong> (plates that did not match any active alert) are purged after <strong className="text-white/80">30 days</strong>.</li>
            <li><strong className="text-white/80">Alerted detections</strong> (plates that matched an active alert) are retained for up to <strong className="text-white/80">1 year</strong> as evidence. These records may be subject to legal hold in connection with active law enforcement proceedings.</li>
          </ul>
        </Section>

        <Section title="Alert and watchlist data">
          <ul className="list-disc pl-5 space-y-1.5 text-sm">
            <li><strong className="text-white/80">FEMA/NWS alert vehicle targets</strong> include an expiry timestamp set 24 hours after ingestion. Expired targets are excluded from all queries automatically.</li>
            <li><strong className="text-white/80">NamUs and BOLO vehicle targets</strong> expire after 7 days by default (configurable).</li>
            <li><strong className="text-white/80">Alert dispatch records</strong> (Discord notifications sent) are retained for <strong className="text-white/80">3 years</strong> for accountability, false-positive auditing, and evidence preservation.</li>
          </ul>
        </Section>

        <Section title="Pilot account data">
          Account data (username, email, phone, city, FAA certificate number, equipment) is
          retained for the lifetime of the account. You can delete your account directly in the
          app (Settings &rarr; Delete Account) or by emailing{" "}
          <a href="mailto:info@amberangels.org" className="text-amber-400 hover:underline">
            info@amberangels.org
          </a>. Upon deletion, all personal fields are hard-deleted
          within <strong className="text-white/80">30 days</strong>. Detection records
          associated with your account that have evidentiary value (matched an active alert) may
          be retained in pseudonymized form.
        </Section>

        <Section title="Third-party data processors">
          <ul className="list-disc pl-5 space-y-1.5 text-sm">
            <li><strong className="text-white/80">Plate Recognizer</strong> — optional cloud ALPR enrichment. Only the camera frame is sent (no volunteer identity). Governed by their privacy policy.</li>
            <li><strong className="text-white/80">Anthropic (Claude)</strong> — AI text extraction from law enforcement BOLO images. Only the BOLO image is processed (no volunteer data).</li>
            <li><strong className="text-white/80">Discord</strong> — alert notifications sent to a private coordinator webhook. Discord retains messages per their terms of service.</li>
            <li><strong className="text-white/80">Expo (EAS)</strong> — push notification delivery. Device tokens and notification content only.</li>
            <li><strong className="text-white/80">Mapbox</strong> — map tile provider. Tile requests include no personal data beyond IP address.</li>
            <li><strong className="text-white/80">Twilio</strong> — optional SMS alerts for high-confidence matches. Active only when configured by the operator.</li>
          </ul>
        </Section>

        <Section title="Data subject requests">
          To request a copy, correction, or deletion of your data, email{" "}
          <a href="mailto:info@amberangels.org" className="text-amber-400 hover:underline">
            info@amberangels.org
          </a>{" "}
          from the address associated with your account, or use the in-app account deletion
          feature. We will respond within 14 days and complete eligible requests within 30 days.
        </Section>

        <Section title="Policy review">
          This policy is reviewed whenever material changes to data handling practices occur.
          The effective date at the top of this page reflects the most recent revision. Active
          volunteers will be notified of material changes via the app.
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
