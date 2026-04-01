"use client"

import { useState } from "react"
import Link from "next/link"
import { useAllMissions, useMissionDebrief } from "@/features/missions/api"

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="text-xs uppercase tracking-widest text-white/40 mb-1">{label}</div>
      <div className="text-2xl font-semibold text-white">{value}</div>
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <h2 className="text-xs uppercase tracking-widest text-white/40 mb-4">{title}</h2>
      {children}
    </div>
  )
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

export default function DebriefPage() {
  const { data: missions = [], isLoading: missionsLoading } = useAllMissions()
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null)
  const { data: debrief, isLoading: debriefLoading, error: debriefError } = useMissionDebrief(selectedMissionId)

  return (
    <main className="min-h-screen bg-neutral-950 text-white px-4 py-8">
      <div className="mx-auto max-w-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link
            href="/map"
            className="text-white/40 hover:text-white/80 transition-colors text-sm"
          >
            ← Map
          </Link>
          <h1 className="text-xl font-semibold">Mission Debrief</h1>
        </div>

        {/* Mission selector */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 mb-6">
          <label className="block text-xs uppercase tracking-widest text-white/40 mb-3">
            Select Mission
          </label>
          {missionsLoading ? (
            <div className="text-sm text-white/30">Loading missions…</div>
          ) : missions.length === 0 ? (
            <div className="text-sm text-white/30">No missions found.</div>
          ) : (
            <select
              value={selectedMissionId ?? ""}
              onChange={(e) => setSelectedMissionId(e.target.value || null)}
              className="w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-sky-500/60 focus:outline-none"
            >
              <option value="">— choose a mission —</option>
              {missions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} ({m.status})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Debrief content */}
        {selectedMissionId && (
          <>
            {debriefLoading && (
              <div className="text-sm text-white/30 text-center py-12">Loading debrief…</div>
            )}

            {debriefError && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-400">
                Failed to load debrief data.
              </div>
            )}

            {debrief && !debriefLoading && (
              <div className="space-y-4">

                {/* Overview stats grid */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <StatCard label="Duration" value={formatDuration(debrief.durationMinutes)} />
                  <StatCard label="Total Detections" value={debrief.totalDetections} />
                  <StatCard label="Watchlist Hits" value={debrief.watchlistHits} />
                  <StatCard label="Plates Scanned" value={debrief.platesScanned} />
                  <StatCard label="Drones Active" value={debrief.dronesActive.length} />
                  <StatCard label="Pilots Active" value={debrief.pilotsActive.length} />
                </div>

                {/* Drones & Pilots */}
                {(debrief.dronesActive.length > 0 || debrief.pilotsActive.length > 0) && (
                  <div className="grid grid-cols-2 gap-3">
                    {debrief.dronesActive.length > 0 && (
                      <SectionCard title="Drones">
                        <ul className="space-y-1">
                          {debrief.dronesActive.map((d) => (
                            <li key={d} className="text-sm text-white/70 font-mono">{d}</li>
                          ))}
                        </ul>
                      </SectionCard>
                    )}
                    {debrief.pilotsActive.length > 0 && (
                      <SectionCard title="Pilots">
                        <ul className="space-y-1">
                          {debrief.pilotsActive.map((p) => (
                            <li key={p} className="text-sm text-white/70">{p}</li>
                          ))}
                        </ul>
                      </SectionCard>
                    )}
                  </div>
                )}

                {/* Top plates */}
                {debrief.topPlates.length > 0 && (
                  <SectionCard title="Top Plates">
                    <div className="space-y-2">
                      {debrief.topPlates.map(({ plate, count }) => (
                        <div key={plate} className="flex items-center justify-between">
                          <span className="font-mono text-sm text-white/80">{plate}</span>
                          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/50">
                            {count}×
                          </span>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                )}

                {/* Alerts by type */}
                {Object.keys(debrief.alertsByType).length > 0 && (
                  <SectionCard title="Alerts by Type">
                    <div className="space-y-2">
                      {Object.entries(debrief.alertsByType).map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between">
                          <span className="text-sm capitalize text-white/80">{type}</span>
                          <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs text-amber-300">
                            {count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                )}

                {/* Time range footer */}
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-white/30 space-y-0.5">
                  {debrief.startedAt && (
                    <div>Started: {new Date(debrief.startedAt).toLocaleString()}</div>
                  )}
                  {debrief.endedAt && (
                    <div>Ended: {new Date(debrief.endedAt).toLocaleString()}</div>
                  )}
                  {!debrief.endedAt && (
                    <div className="text-emerald-400/60">Mission still active — stats update in real time</div>
                  )}
                </div>

              </div>
            )}
          </>
        )}

      </div>
    </main>
  )
}
