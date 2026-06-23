import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: "Papers — Amber's Angels",
  description: "Technical papers and whitepapers documenting the capabilities and research behind the Amber's Angels platform.",
}

const PAPERS = [
  {
    id: 'AA-2026-001',
    slug: 'purple-alert-water-search',
    title: 'Automated Water Search for Purple Alert Response',
    date: 'June 23, 2026',
    abstract: 'How event-triggered drone automation addresses the leading cause of death in wandering incidents involving individuals with autism and developmental disabilities.',
    tags: ['Purple Alert', 'Water Search', 'Drone Automation', 'Wandering'],
  },
]

export default function PapersIndexPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#050a0f',
      color: 'rgba(255,255,255,0.88)',
      fontFamily: "'Inter', sans-serif",
    }}>
      <nav style={{
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '16px 48px',
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
      }}>
        <Link href="/" style={{ color: 'rgba(255,255,255,0.45)', textDecoration: 'none', fontSize: '13px' }}>
          ← amberangels.org
        </Link>
        <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '13px' }}>/</span>
        <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: 600 }}>Papers</span>
      </nav>

      <header style={{
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '64px 48px 56px',
        maxWidth: '900px',
      }}>
        <p style={{
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: '#7C3AED',
          marginBottom: '16px',
        }}>
          Technical Papers
        </p>
        <h1 style={{
          fontSize: '48px',
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: '-0.5px',
          color: '#fff',
          marginBottom: '20px',
        }}>
          Built, documented, dated.
        </h1>
        <p style={{
          fontSize: '17px',
          color: 'rgba(255,255,255,0.5)',
          lineHeight: 1.65,
          maxWidth: '600px',
        }}>
          Research and technical documentation behind the Amber&apos;s Angels platform. Each paper describes a capability we built, the data that drove it, and how it works.
        </p>
      </header>

      <main style={{ maxWidth: '900px', padding: '0 48px 96px' }}>
        {PAPERS.map((paper, i) => (
          <Link key={i} href={`/papers/${paper.slug}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
            className="paper-row">
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '32px',
              padding: '36px 0',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
            }}>
              <div style={{
                flexShrink: 0,
                paddingTop: '4px',
                fontWeight: 600,
                fontSize: '11px',
                color: 'rgba(255,255,255,0.2)',
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.05em',
                width: '90px',
              }}>
                {paper.id}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)' }}>{paper.date}</span>
                  {paper.tags.map((tag, j) => (
                    <span key={j} style={{
                      fontSize: '9px',
                      fontWeight: 600,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: '#7C3AED',
                      border: '1px solid rgba(124,58,237,0.3)',
                      borderRadius: '2px',
                      padding: '2px 6px',
                    }}>
                      {tag}
                    </span>
                  ))}
                </div>
                <h2 style={{
                  fontSize: '22px',
                  fontWeight: 700,
                  color: '#fff',
                  marginBottom: '10px',
                  lineHeight: 1.2,
                }}>
                  {paper.title}
                </h2>
                <p style={{
                  fontSize: '14px',
                  color: 'rgba(255,255,255,0.45)',
                  lineHeight: 1.65,
                  margin: 0,
                }}>
                  {paper.abstract}
                </p>
              </div>
              <div style={{
                flexShrink: 0,
                alignSelf: 'center',
                fontSize: '12px',
                fontWeight: 600,
                color: '#7C3AED',
                letterSpacing: '0.05em',
                whiteSpace: 'nowrap',
              }}>
                Read →
              </div>
            </div>
          </Link>
        ))}
      </main>

      <footer style={{
        borderTop: '1px solid rgba(255,255,255,0.07)',
        padding: '32px 48px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '12px',
        color: 'rgba(255,255,255,0.3)',
      }}>
        <span>Amber&apos;s Angels Inc. · 501(c)(3) · EIN 42-2052151 · Carrollton, Georgia</span>
        <Link href="/" style={{ color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>amberangels.org</Link>
      </footer>

      <style>{`
        .paper-row:hover h2 { color: #fff !important; }
        .paper-row:hover { opacity: 0.95; }
      `}</style>
    </div>
  )
}
