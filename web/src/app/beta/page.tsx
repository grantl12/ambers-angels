"use client"

import Link from "next/link"

export default function BetaPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">

      {/* Top bar */}
      <div className="sticky top-0 z-50 border-b border-white/[0.06] bg-neutral-950/90 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold text-white/70 hover:text-white transition-colors">
            <img src="/aa-icon.png" alt="AA" className="w-6 h-6 rounded-full" />
            Amber&apos;s Angels
          </Link>
          <span className="text-xs text-white/30 font-mono">Beta Program</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-16">

        {/* Hero */}
        <div className="mb-16 text-center">
          <div className="text-[11px] font-bold tracking-widest uppercase text-amber-400 mb-4">App Testers Needed</div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-6 leading-tight">
            Help us build the network<br />
            <em className="text-amber-400">before the next alert fires.</em>
          </h1>
          <p className="text-lg text-white/50 leading-relaxed max-w-2xl mx-auto">
            Amber&apos;s Angels is in active beta testing. We need real volunteers on real roads
            running the app so we can harden the platform before it matters most. Install the app,
            run a test scan, and help us find what breaks.
          </p>
        </div>

        {/* What testers do */}
        <div className="mb-16 rounded-xl border border-white/[0.06] bg-white/[0.02] p-8">
          <h2 className="text-xl font-bold text-white mb-4">What beta testers do</h2>
          <ul className="space-y-3">
            {[
              "Install the app on your phone and create an account",
              "When an alert fires in your area, drive your normal routes with the app running — your phone scans license plates in the background using on-device OCR",
              "Report bugs, crashes, or anything that feels off",
              "Help us validate the scan pipeline works across different phones, lighting, and road conditions",
            ].map((item, i) => (
              <li key={i} className="flex gap-3 text-[15px] text-white/60 leading-relaxed">
                <span className="text-amber-400 flex-shrink-0 font-bold">{i + 1}.</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-sm text-white/30">
            No special equipment needed. No drone. Just your phone and a car mount (or a passenger seat).
          </p>
        </div>

        {/* Platform cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-16">

          {/* iOS */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 flex flex-col">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-xl bg-white/[0.05] flex items-center justify-center text-2xl">
                <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white/80">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">iPhone</h3>
                <span className="text-xs text-white/30">via TestFlight</span>
              </div>
            </div>

            <div className="space-y-4 flex-1">
              <Step n={1}>
                <span>Install <strong className="text-white/80">TestFlight</strong>{" "}from the App Store — it&apos;s Apple&apos;s
                official beta testing app (free, made by Apple).</span>
              </Step>
              <Step n={2}>
                <span>Open the invite link below on your iPhone. It will open TestFlight
                and show you Amber&apos;s Angels.</span>
              </Step>
              <Step n={3}>
                <span>Tap <strong className="text-white/80">&ldquo;Accept&rdquo;</strong> then{" "}
                <strong className="text-white/80">&ldquo;Install.&rdquo;</strong> The app installs like any other app —
                it appears on your home screen.</span>
              </Step>
              <Step n={4}>
                <span>Open the app, create an account, and you&apos;re in.</span>
              </Step>
            </div>

            <a
              href="https://testflight.apple.com/join/5qrESec8"
              className="mt-8 block text-center py-3 px-6 rounded-lg bg-amber-500 text-black font-bold text-sm hover:bg-amber-400 transition-colors"
            >
              Join iOS Beta (TestFlight) →
            </a>
            <p className="mt-3 text-xs text-white/25 text-center">
              Requires iOS 16+. Link opens TestFlight on your phone.
            </p>
          </div>

          {/* Android */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 flex flex-col">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-xl bg-white/[0.05] flex items-center justify-center text-2xl">
                <svg viewBox="0 0 24 24" className="w-7 h-7 fill-[#3ddc84]">
                  <path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V7H6v11zM3.5 7C2.67 7 2 7.67 2 8.5v7c0 .83.67 1.5 1.5 1.5S5 16.33 5 15.5v-7C5 7.67 4.33 7 3.5 7zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48C13.85.55 12.95.05 12 .05s-1.85.5-2.64 1.08L7.88.65c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.3 1.3C7.15 3.75 6.2 5.28 6.2 7h11.6c0-1.72-.95-3.25-2.27-4.34zM10 5H9V4h1v1zm5 0h-1V4h1v1z"/>
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Android</h3>
                <span className="text-xs text-white/30">Coming soon</span>
              </div>
            </div>

            <div className="space-y-4 flex-1">
              <p className="text-[15px] text-white/60 leading-relaxed">
                The Android version is currently in review with Google Play. Once approved,
                we&apos;ll post the install link here.
              </p>
              <p className="text-[15px] text-white/60 leading-relaxed">
                Want to be notified when it&apos;s ready? Drop us a line at{" "}
                <a href="mailto:info@amberangels.org" className="text-amber-400 hover:underline">info@amberangels.org</a>{" "}and
                we&apos;ll let you know as soon as it goes live.
              </p>
            </div>

            <div
              className="mt-8 block text-center py-3 px-6 rounded-lg bg-white/[0.06] text-white/30 font-bold text-sm cursor-not-allowed"
            >
              Android — Coming Soon
            </div>
            <p className="mt-3 text-xs text-white/25 text-center">
              Requires Android 13+.
            </p>
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-16">
          <h2 className="text-xl font-bold text-white mb-6">Common questions</h2>
          <div className="space-y-4">
            <Faq q="Is this a real app or just a prototype?">
              Real app, real infrastructure. The platform is live and ingesting FEMA IPAWS alerts in real-time.
              We need testers to stress-test the scan pipeline under real driving conditions before we go wide.
            </Faq>
            <Faq q="What does TestFlight cost?">
              Nothing. TestFlight is free. It&apos;s Apple&apos;s official tool for distributing beta apps.
              It stays on your phone alongside the beta app, and you can uninstall both any time.
            </Faq>
            <Faq q="Does the app track me or store footage of my car?">
              No. Background scanning runs entirely on your phone — raw camera frames never leave
              your device. Only license plate text is transmitted, and only during an active mission.
              Full details on our <Link href="/privacy" className="text-amber-400 hover:underline">privacy page</Link>.
            </Faq>
            <Faq q="What if I find a bug?">
              That&apos;s exactly why you&apos;re here. Shake your phone in TestFlight to send a
              screenshot and feedback directly to us, or email{" "}
              <a href="mailto:info@amberangels.org" className="text-amber-400 hover:underline">info@amberangels.org</a>{" "}
              with a description and we&apos;ll jump on it.
            </Faq>
            <Faq q="Do I need a drone?">
              No. Most testers will use the phone scanning mode — mount your phone on the dash and
              drive normally. Drone pilots with DJI hardware and FAA Part 107 certs are also welcome.
            </Faq>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="text-center py-12 border-t border-white/[0.06]">
          <p className="text-white/40 text-sm mb-4">
            Amber&apos;s Angels is a 501(c)(3) nonprofit (EIN 42-2052151) headquartered in Carrollton, GA.
          </p>
          <p className="text-white/30 text-xs">
            Questions? <a href="mailto:info@amberangels.org" className="text-amber-400 hover:underline">info@amberangels.org</a>
            {" · "}
            <Link href="/privacy" className="text-amber-400 hover:underline">Privacy Policy</Link>
            {" · "}
            <Link href="/guide" className="text-amber-400 hover:underline">User Guide</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-[15px] text-white/60 leading-relaxed">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/[0.06] text-white/40 text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div>{children}</div>
    </div>
  )
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <summary className="cursor-pointer px-5 py-4 text-[15px] font-semibold text-white/80 flex items-center justify-between hover:text-white transition-colors list-none [&::-webkit-details-marker]:hidden">
        {q}
        <svg className="w-4 h-4 text-white/30 group-open:rotate-180 transition-transform flex-shrink-0 ml-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </summary>
      <div className="px-5 pb-4 text-sm text-white/50 leading-relaxed">
        {children}
      </div>
    </details>
  )
}
