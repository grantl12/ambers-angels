export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12">
      <div className="max-w-2xl mx-auto space-y-8 text-white/70 leading-relaxed">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Privacy Policy</h1>
          <p className="text-sm text-white/40">Effective date: June 24, 2026</p>
        </div>

        <Section title="Who we are">
          Amber&rsquo;s Angels is a volunteer-driven public safety platform that helps locate
          missing and abducted persons by responding to active government-issued alerts (AMBER,
          Silver, Blue, Purple, and other alert types). We are a federally recognized 501(c)(3)
          nonprofit (EIN 42-2052151) headquartered in Carrollton, Georgia. Our server
          infrastructure is located in the United States.
        </Section>

        <Section title="How the app works — two scanning modes">
          <p className="mb-3">
            Our mobile app has two distinct operating modes with different privacy properties.
            Understanding this distinction is central to how we protect volunteer privacy.
          </p>
          <div className="space-y-3">
            <div className="bg-white/5 rounded-lg p-3">
              <p className="text-white/80 font-medium text-sm mb-1">Background passive scan (default volunteer experience)</p>
              <p className="text-sm">
                License plate recognition runs <strong className="text-white/80">entirely on
                your phone</strong> using on-device machine learning. No camera frames or images
                ever leave your device. Only the recognized plate text, a confidence score, and
                your GPS coordinates are transmitted to our server for matching against active
                alerts. This is the default scanning mode and its no-frame-upload guarantee is
                a core architectural commitment.
              </p>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <p className="text-white/80 font-medium text-sm mb-1">Active pilot camera (explicit opt-in)</p>
              <p className="text-sm">
                When a pilot taps &ldquo;Start Mission,&rdquo; the app enters active camera
                mode. In this mode, camera frames are uploaded to our server for server-side
                analysis. High-confidence match frames are retained as evidence for potential
                law enforcement coordination. This mode requires explicit action and is clearly
                indicated in the app interface.
              </p>
            </div>
          </div>
        </Section>

        <Section title="What we collect">
          <ul className="list-disc pl-5 space-y-1.5 text-sm">
            <li><strong className="text-white/80">Account information:</strong> username, email address, phone number, city, FAA certification number (if applicable), and equipment type — provided during registration. If you sign in with Google, we receive your Google profile name and email.</li>
            <li><strong className="text-white/80">Location data:</strong> GPS coordinates, altitude, heading, and speed transmitted during active missions and background scanning. Location is collected only while a scanning mode is active.</li>
            <li><strong className="text-white/80">On-device scan results (background mode):</strong> plate text, confidence score, and GPS coordinates. No images.</li>
            <li><strong className="text-white/80">Camera frames (active mode only):</strong> JPEG images uploaded during active pilot missions for server-side ALPR and vehicle classification. Most frames are deleted after processing. Frames associated with high-confidence alert matches are retained as evidence (see <a href="/retention" className="text-amber-400 hover:underline">Data Retention Policy</a>).</li>
            <li><strong className="text-white/80">Detection data:</strong> license plate text, confidence scores, vehicle attributes (color, make, body type), GPS coordinates, and timestamps.</li>
            <li><strong className="text-white/80">Device tokens:</strong> push notification tokens (via Expo) to deliver alert notifications to your device.</li>
            <li><strong className="text-white/80">Watch areas:</strong> geographic area preferences you set to receive relevant alerts.</li>
            <li><strong className="text-white/80">Usage data:</strong> login timestamps, mission participation records, and Terms of Service acceptance.</li>
          </ul>
        </Section>

        <Section title="What we do not collect">
          <ul className="list-disc pl-5 space-y-1.5 text-sm">
            <li>In background scan mode, we never receive, transmit, or store camera frames or images from your device. Only plate text and GPS coordinates are sent.</li>
            <li>We do not record or store audio.</li>
            <li>We do not sell, rent, or share personal data with advertisers or data brokers.</li>
            <li>We do not build a persistent surveillance database of license plates. Non-alerted detections are automatically purged on a rolling schedule. Only detections that matched an active government-issued alert are retained as evidence.</li>
          </ul>
        </Section>

        <Section title="Government data sources we consume">
          <p className="mb-2 text-sm">
            We ingest data from government and public safety sources to maintain our active alert
            watchlist. We pull data from these sources — we do not share volunteer data with them.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong className="text-white/80">FEMA IPAWS</strong> — AMBER, Silver, Blue, Purple, and other emergency alerts via CAP/XML</li>
            <li><strong className="text-white/80">National Weather Service</strong> — WEA-distributed AMBER alerts</li>
            <li><strong className="text-white/80">NCMEC</strong> — National Center for Missing & Exploited Children RSS feeds (all 50 states)</li>
            <li><strong className="text-white/80">NamUs</strong> — National Missing and Unidentified Persons System (DOJ)</li>
            <li><strong className="text-white/80">Law enforcement BOLOs</strong> — Be On the Lookout bulletins forwarded by partner agencies</li>
          </ul>
        </Section>

        <Section title="How we use your data">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>To authenticate and manage volunteer accounts.</li>
            <li>To display real-time volunteer positions on the mission coordination map.</li>
            <li>To match detected license plates and vehicle descriptions against active alert watchlists.</li>
            <li>To notify mission coordinators of potential matches for human review.</li>
            <li>To deliver push notifications about new alerts in your watch areas.</li>
            <li>To generate mission statistics and badges for volunteer recognition.</li>
          </ul>
        </Section>

        <Section title="Data sharing">
          <ul className="list-disc pl-5 space-y-1.5 text-sm">
            <li><strong className="text-white/80">Coordinators:</strong> detection matches against active alerts are sent to mission coordinators via Discord for human review. No match is forwarded to law enforcement without coordinator review.</li>
            <li><strong className="text-white/80">Law enforcement:</strong> when a high-confidence match is confirmed by a coordinator, detection data and associated evidence frames may be shared with the responding law enforcement agency handling the active alert.</li>
            <li><strong className="text-white/80">Legal process:</strong> we may disclose data in response to a valid subpoena, court order, or other legal process.</li>
            <li>We do not share raw detection logs, volunteer identities, or location data with any third party for commercial purposes.</li>
          </ul>
        </Section>

        <Section title="Third-party service providers">
          <ul className="list-disc pl-5 space-y-1.5 text-sm">
            <li><strong className="text-white/80">Plate Recognizer</strong> — optional cloud ALPR enrichment. Only the camera frame is sent (no volunteer identity). Governed by their privacy policy.</li>
            <li><strong className="text-white/80">Anthropic (Claude)</strong> — AI-assisted text extraction from law enforcement BOLO images. Only the BOLO image is sent (no volunteer data).</li>
            <li><strong className="text-white/80">Discord</strong> — alert notifications dispatched to a private coordinator webhook.</li>
            <li><strong className="text-white/80">Expo (EAS)</strong> — push notification delivery. Only device tokens and notification content are transmitted.</li>
            <li><strong className="text-white/80">Mapbox</strong> — map tiles. Tile requests include no personal data beyond IP address.</li>
            <li><strong className="text-white/80">Twilio</strong> — optional SMS alerts for high-confidence matches. Phone numbers are transmitted only if SMS alerting is enabled.</li>
          </ul>
        </Section>

        <Section title="Data retention">
          Non-alerted detections are purged after 30 days. Alerted detections (evidence) are
          retained for up to 1 year. Alert records are retained for 3 years for accountability.
          Telemetry is retained for 90 days. Evidence frames associated with confirmed matches
          are retained alongside their detection records. See our full{" "}
          <a href="/retention" className="text-amber-400 hover:underline">Data Retention Policy</a>{" "}
          for the complete schedule.
        </Section>

        <Section title="Your rights">
          <ul className="list-disc pl-5 space-y-1.5 text-sm">
            <li><strong className="text-white/80">Access:</strong> request a copy of your personal data.</li>
            <li><strong className="text-white/80">Correction:</strong> request correction of inaccurate information.</li>
            <li><strong className="text-white/80">Deletion:</strong> delete your account directly in the app (Settings &rarr; Delete Account) or by emailing us. Deletion is completed within 30 days except where retention is required by law or for evidence preservation.</li>
            <li><strong className="text-white/80">Opt out:</strong> you may stop scanning at any time by closing the app. Background scanning requires an active foreground notification and can be stopped from that notification.</li>
          </ul>
          <p className="mt-2 text-sm">
            For any privacy request, contact{" "}
            <a href="mailto:info@amberangels.org" className="text-amber-400 hover:underline">
              info@amberangels.org
            </a>.
          </p>
        </Section>

        <Section title="Security">
          Passwords are stored as bcrypt hashes. Authentication uses signed JWTs with 30-day
          expiry. All data in transit is encrypted via HTTPS/TLS. Internal API communication
          between services uses shared secret authentication. We do not store plaintext
          credentials.
        </Section>

        <Section title="Children's data">
          Our platform is operated by adult volunteers (18+) and does not knowingly collect
          personal information from children under 13 in compliance with COPPA. If you believe
          a minor has registered, contact us immediately at{" "}
          <a href="mailto:info@amberangels.org" className="text-amber-400 hover:underline">
            info@amberangels.org
          </a>{" "}
          for removal.
        </Section>

        <Section title="Changes to this policy">
          We will post changes to this page and update the effective date. Active volunteers will
          be notified of material changes via the app. Continued use of the platform after changes
          constitutes acceptance. The app may require re-acceptance of Terms of Service for
          significant changes.
        </Section>

        <Section title="Contact">
          Questions about this policy:{" "}
          <a href="mailto:info@amberangels.org" className="text-amber-400 hover:underline">
            info@amberangels.org
          </a>
          <br />
          Amber&rsquo;s Angels · 103 Springwood Dr · Carrollton, GA 30117
        </Section>

        <div className="flex gap-6 text-xs text-white/30 pt-4 border-t border-white/8">
          <a href="/retention" className="hover:text-white/60 transition-colors">Data Retention Policy</a>
          <a href="/terms" className="hover:text-white/60 transition-colors">Terms of Service</a>
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
