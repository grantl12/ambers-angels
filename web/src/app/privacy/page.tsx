export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12">
      <div className="max-w-2xl mx-auto space-y-8 text-white/70 leading-relaxed">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Privacy Policy</h1>
          <p className="text-sm text-white/40">Effective date: April 2, 2026</p>
        </div>

        <Section title="Who we are">
          Amber's Angels is a volunteer-run drone license plate recognition network dedicated to
          assisting in the recovery of missing and abducted children. We operate as a 501(c)(3)
          nonprofit (pending). Our server is located in the United States.
        </Section>

        <Section title="What we collect">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong className="text-white/80">Volunteer accounts:</strong> name, email address, phone number, city, FAA certification number (if applicable), and equipment type — provided voluntarily during registration.</li>
            <li><strong className="text-white/80">Location data:</strong> GPS coordinates, altitude, heading, and speed transmitted during active missions — whether from a drone or a vehicle-mounted phone. Location data is collected only while the app is in active mission mode.</li>
            <li><strong className="text-white/80">Camera frames:</strong> JPEG images captured by drone cameras or vehicle-mounted phone cameras are transmitted to the server for processing. Frames are analyzed and immediately deleted — they are never stored in the database. See <a href="/retention" className="text-amber-400 hover:underline">Data Retention Policy</a>.</li>
            <li><strong className="text-white/80">Detection data:</strong> license plate text, confidence scores, associated vehicle attributes (color, make, type), and frame timestamps. No images are retained with detections.</li>
            <li><strong className="text-white/80">Usage data:</strong> login timestamps and mission participation records.</li>
          </ul>
        </Section>

        <Section title="What we do not collect">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>We do not store raw video footage or retain camera frames after ALPR processing.</li>
            <li>We do not record or store audio.</li>
            <li>We do not collect location data outside of active missions. The app does not run in the background when not in use.</li>
            <li>We do not sell, rent, or share personal data with advertisers or third parties for commercial purposes.</li>
            <li>We do not build persistent databases of license plates or vehicle sightings beyond what is required to match an active government-issued alert.</li>
          </ul>
        </Section>

        <Section title="How we use your data">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>To authenticate and manage pilot accounts.</li>
            <li>To display real-time drone positions on the mission map.</li>
            <li>To match detected license plates against active AMBER/SILVER alert watchlists and notify law enforcement and emergency coordinators.</li>
            <li>To generate mission statistics and leaderboards for volunteer recognition.</li>
          </ul>
        </Section>

        <Section title="Data sharing">
          Detection matches against active alerts are reported via Discord to mission coordinators.
          We do not share raw detection logs with law enforcement directly — coordinators review
          all matches before escalation. We may be compelled to disclose data in response to a
          valid legal process (subpoena, court order).
        </Section>

        <Section title="Data retention">
          Telemetry data is retained for 90 days. Detection records are retained for 1 year.
          Alert records are retained for 3 years for audit and accountability purposes. Pilot
          account data is retained for the lifetime of the account and deleted upon request.
          Camera frames are deleted immediately after processing and are never stored long-term.
          See our full{" "}
          <a href="/retention" className="text-amber-400 hover:underline">Data Retention Policy</a>{" "}
          for the complete schedule.
        </Section>

        <Section title="Your rights">
          You may request a copy of your personal data, correction of inaccuracies, or deletion
          of your account by contacting us at{" "}
          <a href="mailto:privacy@amberangels.org" className="text-amber-400 hover:underline">
            privacy@amberangels.org
          </a>. Deletion requests are honored within 30 days except where retention is required
          by law.
        </Section>

        <Section title="Security">
          Passwords are stored as bcrypt hashes. Authentication tokens are signed JWTs with
          30-day expiry. We use HTTPS for all data in transit. We do not store plaintext
          credentials.
        </Section>

        <Section title="Children's data">
          Our platform is operated by adult volunteers and does not knowingly collect personal
          information from children under 13. If you believe a minor has registered, contact us
          immediately for removal.
        </Section>

        <Section title="Changes to this policy">
          We will post changes to this page and update the effective date. Continued use of the
          platform after changes constitutes acceptance.
        </Section>

        <Section title="Contact">
          Questions about this policy:{" "}
          <a href="mailto:privacy@amberangels.org" className="text-amber-400 hover:underline">
            privacy@amberangels.org
          </a>
        </Section>
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
