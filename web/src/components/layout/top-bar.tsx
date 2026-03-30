"use client"

import { useActiveMissions } from "@/features/missions/api"
import { useLatestTelemetry } from "@/features/telemetry/api"
import { useDetectionsFeed } from "@/features/detections/api"
import { env } from "@/lib/env"

export function TopBar() {
  const { data: missions = [] }   = useActiveMissions()
  const { data: drones = [] }     = useLatestTelemetry()
  const { data: detections = [] } = useDetectionsFeed(50)

  const mission    = missions[0]
  const alertCount = detections.filter((d) => d.status === "alerted").length

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 bg-black/80 px-4 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold tracking-wide text-white">{env.appName}</span>
        {mission && (
          <>
            <span className="text-white/20">/</span>
            <span className="text-sm text-white/60">{mission.title}</span>
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-400">
              {mission.status}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs text-white/50">
        <Stat label="Pilots" value={drones.length} />
        <Stat label="Detections" value={detections.length} />
        {alertCount > 0 && (
          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-semibold text-red-400">
            {alertCount} alert{alertCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </header>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <span className="text-white/30">{label}: </span>
      <span className="text-white/70 font-medium">{value}</span>
    </span>
  )
}
