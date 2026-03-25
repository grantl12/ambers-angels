import { mockMission, mockDronePositions, mockDetections } from "@/lib/mock-data"

export function MissionSidebar() {
  return (
    <aside className="flex h-full w-80 flex-col border-r border-white/10 bg-black/40 p-4 text-white backdrop-blur">
      <h2 className="text-lg font-semibold">{mockMission.title}</h2>
      <div className="mt-2 text-sm text-white/70">Status: {mockMission.status}</div>

      <div className="mt-6 space-y-3">
        <div className="rounded-xl border border-white/10 p-3">
          <div className="text-xs uppercase text-white/50">Active drones</div>
          <div className="mt-1 text-2xl font-semibold">{mockDronePositions.length}</div>
        </div>

        <div className="rounded-xl border border-white/10 p-3">
          <div className="text-xs uppercase text-white/50">Detections</div>
          <div className="mt-1 text-2xl font-semibold">{mockDetections.length}</div>
        </div>
      </div>
    </aside>
  )
}
