import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: "Writing — Amber's Angels",
  description: "The Coverage Gap: a weekly series on event-triggered public safety AI, privacy by architecture, and the future of missing persons response.",
}

const POSTS = [
  {
    slug: 'coverage-gap-intro',
    tag: 'Series Introduction',
    title: 'The Coverage Gap',
    date: 'June 11, 2026',
    excerpt: 'Fixed ALPR answers: what happened? We answer: what\'s happening right now? A jurisdiction with only one has half the picture.',
    live: true,
  },
  {
    slug: 'post-1-always-on',
    tag: 'Post 1 of 8',
    title: 'The Problem with Always-On',
    date: 'June 16, 2026',
    excerpt: 'Every technology that retains data creates risk. The problem isn\'t character — it\'s architecture.',
    live: true,
  },
  {
    slug: 'post-2-different-questions',
    tag: 'Post 2 of 8',
    title: 'Different Questions',
    date: 'June 23, 2026',
    excerpt: 'Flock Safety and Amber\'s Angels are better together than either is alone. Fixed infrastructure covers the intersections. Mobile volunteers cover everything between them.',
    live: false,
  },
  {
    slug: 'post-3-when-plates-disappear',
    tag: 'Post 3 of 8',
    title: 'When Plates Disappear',
    date: 'June 30, 2026',
    excerpt: 'Plates fail in two distinct ways and our system handles them differently. Switched plate, no readable plate — here\'s what the pipeline does in each case.',
    live: false,
  },
  {
    slug: 'post-4-coverage-map',
    tag: 'Post 4 of 8',
    title: 'The Coverage Map Problem',
    date: 'July 7, 2026',
    excerpt: 'The communities in the biggest coverage gaps are often the ones with the least infrastructure budget. That\'s not a coincidence.',
    live: false,
  },
  {
    slug: 'post-5-join-swarm',
    tag: 'Post 5 of 8',
    title: 'Join Swarm',
    date: 'July 14, 2026',
    excerpt: 'A volunteer with a drone, kids at home, and nowhere to go can still contribute an aerial search. Here\'s how coordinator-directed remote deployment works.',
    live: false,
  },
  {
    slug: 'post-6-privacy-architecture',
    tag: 'Post 6 of 8',
    title: 'Privacy by Architecture, Not Policy',
    date: 'July 21, 2026',
    excerpt: 'A policy says what you\'re allowed to do with data. An architecture makes certain uses impossible. I spent years in a job where that distinction was the work itself.',
    live: false,
  },
  {
    slug: 'post-7-the-math',
    tag: 'Post 7 of 8',
    title: 'The Math',
    date: 'July 28, 2026',
    excerpt: 'Under a minute. Under ten seconds. 99% confidence. 193 detection events. Here are the numbers from our live system test — and the context that makes them matter.',
    live: false,
  },
  {
    slug: 'post-8-before-the-alert',
    tag: 'Post 8 of 8',
    title: 'Before the Alert',
    date: 'August 4, 2026',
    excerpt: 'By the time FEMA fires, law enforcement has known about the situation for up to 3 hours. Here\'s the gap that bothers me most — and what we\'re building to close it.',
    live: false,
  },
]

export default function BlogIndexPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#050a0f',
      color: 'rgba(255,255,255,0.88)',
      fontFamily: "'Inter', sans-serif",
    }}>
      {/* Nav */}
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
        <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: 600 }}>Writing</span>
      </nav>

      {/* Header */}
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
          color: '#f59e0b',
          marginBottom: '16px',
        }}>
          The Coverage Gap · Weekly Series
        </p>
        <h1 style={{
          fontSize: '48px',
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: '-0.5px',
          color: '#fff',
          marginBottom: '20px',
        }}>
          Written for the field.
        </h1>
        <p style={{
          fontSize: '17px',
          color: 'rgba(255,255,255,0.5)',
          lineHeight: 1.65,
          maxWidth: '600px',
        }}>
          Eight posts on where fixed ALPR ends, where mobile volunteer AI begins, and why the future of public safety technology has to be event-triggered, not always-on. Published every Tuesday.
        </p>
      </header>

      {/* Post list */}
      <main style={{ maxWidth: '900px', padding: '0 48px 96px' }}>
        {POSTS.map((post, i) => {
          const content = (
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '32px',
              padding: '36px 0',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
              opacity: post.live ? 1 : 0.45,
            }}>
              {/* Index number */}
              <div style={{
                flexShrink: 0,
                width: '48px',
                paddingTop: '4px',
                fontWeight: 700,
                fontSize: '28px',
                color: 'rgba(255,255,255,0.12)',
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {String(i).padStart(2, '0')}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: '#f59e0b',
                  }}>
                    {post.tag}
                  </span>
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)' }}>{post.date}</span>
                  {!post.live && (
                    <span style={{
                      fontSize: '9px',
                      fontWeight: 600,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: 'rgba(255,255,255,0.25)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: '2px',
                      padding: '2px 6px',
                    }}>
                      Coming
                    </span>
                  )}
                </div>
                <h2 style={{
                  fontSize: '22px',
                  fontWeight: 700,
                  color: post.live ? '#fff' : 'rgba(255,255,255,0.6)',
                  marginBottom: '10px',
                  lineHeight: 1.2,
                }}>
                  {post.title}
                </h2>
                <p style={{
                  fontSize: '14px',
                  color: 'rgba(255,255,255,0.45)',
                  lineHeight: 1.65,
                  margin: 0,
                }}>
                  {post.excerpt}
                </p>
              </div>
              {post.live && (
                <div style={{
                  flexShrink: 0,
                  alignSelf: 'center',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#f59e0b',
                  letterSpacing: '0.05em',
                  whiteSpace: 'nowrap',
                }}>
                  Read →
                </div>
              )}
            </div>
          )

          if (post.live && post.slug) {
            return (
              <Link key={i} href={`/blog/${post.slug}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
                className="blog-row">
                {content}
              </Link>
            )
          }
          return <div key={i}>{content}</div>
        })}
      </main>

      {/* Footer */}
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
        .blog-row:hover > div { opacity: 1 !important; }
        .blog-row:hover h2 { color: #fff !important; }
      `}</style>
    </div>
  )
}
