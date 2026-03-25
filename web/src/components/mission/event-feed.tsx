import { mockDetections } from "@/lib/mock-data"

export function EventFeed() {
  return (
    <aside className="flex h-full w-80 flex-col border-l border-white/10 bg-black/40 p-4 text-white backdrop-blur">
      <h2 className="text-lg font-semibold">Live Events</h2>

      <div className="mt-4 space-y-3">
        {mockDetections.map((detection) => (
          <div key={detection.id} className="rounded-xl border border-white/10 p-3">
            <div className="font-medium">{detection.plateText || "Unknown plate"}</div>
            <div className="text-sm text-white/70">Status: {detection.status}</div>
            <div className="text-sm text-white/70">
              Confidence: {detection.confidence ?? "n/a"}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
