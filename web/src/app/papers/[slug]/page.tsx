export default function PaperPage({ params }: { params: { slug: string } }) {
  return (
    <iframe
      src={`/papers/${params.slug}.html`}
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 'none' }}
    />
  )
}
