export default function TermsPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12">
      <div className="max-w-2xl mx-auto space-y-8 text-white/70 leading-relaxed">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Terms of Service</h1>
          <p className="text-sm text-white/40">Effective date: April 2, 2026</p>
        </div>

        <Section title="1. Acceptance">
          By registering as a volunteer or accessing the Amber&apos;s Angels platform, you agree to
          these Terms of Service. If you do not agree, do not use the platform.
        </Section>

        <Section title="2. Eligibility">
          You must be at least 18 years old to register. Drone pilots must hold a valid FAA Part
          107 Remote Pilot Certificate and provide their certificate number at registration. By
          registering, you agree to use the platform responsibly and in accordance with all
          applicable laws.
        </Section>

        <Section title="3. Volunteer Conduct">
          <p>Volunteers must:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li>Follow all applicable laws, including FAA regulations for drone operations</li>
            <li>Never follow, confront, or engage with any person or vehicle during a mission</li>
            <li>Never share operational details or detection information publicly</li>
            <li>Comply with the Amber&apos;s Angels Volunteer Training Guide at all times</li>
          </ul>
        </Section>

        <Section title="4. No Emergency Services">
          Amber&apos;s Angels is not an emergency service. Always call 911 in an emergency. The
          platform is a search coordination tool — it does not replace law enforcement response.
        </Section>

        <Section title="5. Intellectual Property">
          The Amber&apos;s Angels platform, including software, AI models, and content, is the
          property of Amber&apos;s Angels Inc. Volunteers are granted a limited, non-transferable
          license to use the mobile app solely for authorized search missions.
        </Section>

        <Section title="6. Disclaimer of Warranties">
          The platform is provided &ldquo;as is.&rdquo; Amber&apos;s Angels makes no warranties regarding
          uptime, detection accuracy, or outcomes. We do not guarantee the recovery of any missing
          person.
        </Section>

        <Section title="7. Limitation of Liability">
          To the maximum extent permitted by law, Amber&apos;s Angels Inc. shall not be liable for any
          indirect, incidental, or consequential damages arising from use of the platform.
        </Section>

        <Section title="8. Termination">
          We may suspend or terminate volunteer access at any time for violations of these terms
          or the Volunteer Training Guide.
        </Section>

        <Section title="9. Governing Law">
          These terms are governed by the laws of the State of Georgia.
        </Section>

        <Section title="10. Contact">
          <p>
            Questions:{" "}
            <a href="mailto:admin@amberangels.org" className="text-amber-400 hover:underline">
              admin@amberangels.org
            </a>
          </p>
          <p className="mt-1">Amber&apos;s Angels Inc. · 103 Springwood Dr · Carrollton, GA 30117</p>
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
