"use client"

import { useActiveMissions } from "@/features/missions/api"
import { useLatestTelemetry } from "@/features/telemetry/api"
import { useDetectionsFeed } from "@/features/detections/api"

export function MissionSidebar() {
  const { data: missions = [] } = useActiveMissions()
  const { data: drones = [] }   = useLatestTelemetry()
  const { data: detections = [] } = useDetectionsFeed(50)

  const mission = missions[0]

  const alertCount = detections.filter((d) => d.status === "alerted").length

  return (
    <aside className="flex h-full w-72 flex-col border-r border-white/10 bg-black/60 p-4 text-white backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-xs uppercase tracking-widest text-white/50">Live Mission</span>
      </div>
      <h2 className="text-lg font-semibold leading-tight">
        {mission?.title ?? "No active mission"}
      </h2>
      {mission && (
        <div className="mt-1 text-xs text-white/40">
          Started {new Date(mission.startedAt).toLocaleDateString(undefined, {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          })}
        </div>
      )}

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-2">
        <StatCard label="Drones" value={drones.length} color="text-sky-400" />
        <StatCard label="Detections" value={detections.length} color="text-amber-400" />
        <StatCard label="Alerts" value={alertCount} color="text-red-400" />
        <StatCard
          label="With GPS"
          value={detections.filter((d) => d.lat != null).length}
          color="text-emerald-400"
        />
      </div>

      {/* Drone list */}
      <div className="mt-6">
        <div className="text-xs uppercase tracking-widest text-white/40 mb-2">Drone Status</div>
        {drones.length === 0 ? (
          <div className="text-sm text-white/30">No drones online</div>
        ) : (
          <div className="space-y-2">
            {drones.map((drone) => (
              <div
                key={drone.droneId}
                className="rounded-lg border border-white/10 bg-white/5 p-2 text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{drone.droneId}</span>
                  <span className="text-xs text-emerald-400">online</span>
                </div>
                <div className="mt-1 text-xs text-white/40">
                  {drone.altitude != null ? `${drone.altitude}m` : "—"}
                  {drone.heading != null ? ` · ${Math.round(drone.heading)}°` : ""}
                  {drone.speed != null ? ` · ${drone.speed.toFixed(1)}m/s` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-xs uppercase text-white/40">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  )
}
