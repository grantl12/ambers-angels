export default async function PaperPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return (
    <iframe
      src={`/papers/${slug}.html`}
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 'none' }}
    />
  )
}
