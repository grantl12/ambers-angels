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
            <li>You must receive administrator approval before gaining mission access.</li>
            <li>You must comply with all applicable federal, state, and local laws governing your participation — whether operating a drone, a vehicle, or a phone camera.</li>
            <li>If you operate an unmanned aircraft (drone), you are responsible for ensuring your operations comply with FAA regulations. An FAA Remote Pilot Certificate (Part 107) is strongly encouraged for drone operators and required where mandated by law.</li>
            <li>Vehicle-mounted phone camera volunteers must comply with all applicable traffic laws, including laws prohibiting handheld device use while driving. Phone operation must be hands-free and must not distract the driver.</li>
          </ul>
        </Section>

        <Section title="Volunteer status">
          All volunteers are unpaid. Participation does not create an employment,
          contractor, or agency relationship with Amber's Angels. You are solely responsible
          for your own actions, equipment, and compliance with applicable law.
        </Section>

        <Section title="Safe and lawful operation">
          <p className="mb-2">For drone operators:</p>
          <ul className="list-disc pl-5 space-y-1 text-sm mb-4">
            <li>Fly within FAA airspace rules, including altitude limits and restricted zones.</li>
            <li>Do not fly over people, moving vehicles, or private property without permission unless responding to an active sanctioned mission.</li>
            <li>Do not interfere with law enforcement, emergency responders, or active search operations.</li>
            <li>Cease operations immediately if directed by law enforcement or air traffic control.</li>
            <li>Carry your Remote Pilot Certificate or recreational registration when flying.</li>
          </ul>
          <p className="mb-2">For vehicle-mounted phone camera volunteers:</p>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>The phone must be mounted in a fixed holder — never held in hand while the vehicle is in motion.</li>
            <li>You must obey all traffic laws at all times. The mission does not override road safety.</li>
            <li>Do not enter private property or violate trespassing laws in the course of a search.</li>
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
