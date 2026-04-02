export default function TermsPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12">
      <div className="max-w-2xl mx-auto space-y-8 text-white/70 leading-relaxed">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Terms of Service</h1>
          <p className="text-sm text-white/40">Effective date: April 2, 2026</p>
        </div>

        <Section title="Agreement">
          By registering as a pilot or using the Amber's Angels platform, you agree to these
          Terms of Service. If you do not agree, do not use the platform.
        </Section>

        <Section title="Eligibility">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>You must be at least 18 years of age.</li>
            <li>You must hold or be supervised by someone holding a valid FAA Remote Pilot Certificate (Part 107) where required by law.</li>
            <li>You must comply with all applicable federal, state, and local laws governing drone operation.</li>
            <li>You must receive administrator approval before gaining mission access.</li>
          </ul>
        </Section>

        <Section title="Volunteer status">
          All pilots are unpaid volunteers. Participation does not create an employment,
          contractor, or agency relationship with Amber's Angels. You are solely responsible
          for your own actions, equipment, and compliance with applicable law.
        </Section>

        <Section title="Safe and lawful operation">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>You must fly within FAA airspace rules, including altitude limits and restricted zones.</li>
            <li>You must not fly over people, moving vehicles, or private property without permission unless responding to an active sanctioned mission.</li>
            <li>You must not interfere with law enforcement, emergency responders, or active search operations.</li>
            <li>You must immediately cease operations if directed by law enforcement or air traffic control.</li>
            <li>You must carry your Remote Pilot Certificate or recreational registration when flying.</li>
          </ul>
        </Section>

        <Section title="Data and detections">
          Detection data you generate belongs to Amber's Angels and is used solely for child
          recovery efforts. You must not use the platform to surveil individuals for purposes
          unrelated to active AMBER/SILVER alerts. Misuse of detection data is grounds for
          immediate account termination and may be reported to authorities.
        </Section>

        <Section title="Disclaimer of liability">
          Amber's Angels is a volunteer nonprofit. THE PLATFORM IS PROVIDED "AS IS" WITHOUT
          WARRANTY OF ANY KIND. WE ARE NOT LIABLE FOR ANY DAMAGE TO YOUR EQUIPMENT, INJURIES,
          FINES, OR OTHER LOSSES ARISING FROM YOUR PARTICIPATION. You fly at your own risk.
          Amber's Angels does not carry liability insurance covering volunteer pilots — you are
          responsible for your own coverage.
        </Section>

        <Section title="Indemnification">
          You agree to indemnify and hold harmless Amber's Angels, its officers, and volunteers
          from any claim arising out of your use of the platform or your drone operations.
        </Section>

        <Section title="Account termination">
          Amber's Angels may suspend or terminate your account at any time for violation of
          these terms, unsafe behavior, or for any reason at our discretion. Appeals may be
          submitted to{" "}
          <a href="mailto:admin@ambersangels.org" className="text-amber-400 hover:underline">
            admin@ambersangels.org
          </a>.
        </Section>

        <Section title="Changes to these terms">
          We may update these terms at any time. We will notify active pilots by email.
          Continued use after changes constitutes acceptance.
        </Section>

        <Section title="Contact">
          <a href="mailto:admin@ambersangels.org" className="text-amber-400 hover:underline">
            admin@ambersangels.org
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
