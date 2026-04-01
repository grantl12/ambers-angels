"use client"

import Link from "next/link"
import { useLeaderboard } from "@/features/missions/api"
import type { LeaderboardEntry } from "@/features/missions/api"

/** Convert decimal minutes → "h:mm" */
function formatFlightTime(minutes: number): string {
  const totalMins = Math.round(minutes)
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60
  return `${h}:${String(m).padStart(2, "0")}`
}

/** Relative time string from an ISO timestamp */
function relativeTime(iso: string | null): string {
  if (!iso) return "—"
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-yellow-500/20 text-sm font-bold text-yellow-400 ring-1 ring-yellow-500/40">
        1
      </span>
    )
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-sm font-medium text-white/40">
      {rank}
    </span>
  )
}

function PilotRow({ entry, rank }: { entry: LeaderboardEntry; rank: number }) {
  const isTop = rank === 1
  return (
    <div
      className={`flex items-center gap-4 rounded-xl border p-4 transition-colors ${
        isTop
          ? "border-yellow-500/30 bg-yellow-500/5"
          : "border-white/10 bg-white/5"
      }`}
    >
      <RankBadge rank={rank} />

      {/* Pilot / Drone */}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-semibold ${isTop ? "text-yellow-300" : "text-white"}`}>
          {entry.pilotId}
        </div>
        <div className="truncate text-xs text-white/40">{entry.droneId}</div>
      </div>

      {/* Stats grid */}
      <div className="hidden gap-6 sm:flex">
        <Stat label="Detections" value={String(entry.totalDetections)} highlight={isTop} />
        <Stat label="Watchlist" value={String(entry.watchlistHits)} />
        <Stat label="Flight" value={formatFlightTime(entry.flightMinutes)} />
        <Stat label="Last Seen" value={relativeTime(entry.lastSeen)} />
      </div>

      {/* Compact on mobile */}
      <div className="flex flex-col items-end gap-1 sm:hidden">
        <span className={`text-sm font-bold ${isTop ? "text-yellow-400" : "text-white"}`}>
          {entry.totalDetections}
        </span>
        <span className="text-xs text-white/40">{relativeTime(entry.lastSeen)}</span>
      </div>
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="text-right">
      <div className={`text-sm font-semibold ${highlight ? "text-yellow-300" : "text-white/90"}`}>
        {value}
      </div>
      <div className="text-xs text-white/30">{label}</div>
    </div>
  )
}

export default function LeaderboardPage() {
  const { data: entries = [], isLoading, isError } = useLeaderboard()

  return (
    <main className="min-h-screen bg-neutral-950 text-white px-4 py-8">
      <div className="mx-auto max-w-2xl">

        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <Link
            href="/map"
            className="text-sm text-white/40 transition-colors hover:text-white/80"
          >
            ← Map
          </Link>
          <h1 className="text-xl font-semibold">Pilot Leaderboard</h1>
        </div>

        {/* Column headers (desktop) */}
        {entries.length > 0 && (
          <div className="mb-2 hidden items-center gap-4 px-4 sm:flex">
            <div className="h-7 w-7 shrink-0" />
            <div className="flex-1" />
            <div className="flex gap-6 text-right text-xs uppercase tracking-widest text-white/25">
              <span className="w-20">Detections</span>
              <span className="w-16">Watchlist</span>
              <span className="w-14">Flight</span>
              <span className="w-16">Last Seen</span>
            </div>
          </div>
        )}

        {/* Body */}
        {isLoading && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-10 text-center text-sm text-white/40">
            Loading leaderboard…
          </div>
        )}

        {isError && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-10 text-center text-sm text-red-400">
            Failed to load leaderboard data.
          </div>
        )}

        {!isLoading && !isError && entries.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-10 text-center text-sm text-white/40">
            No flight data recorded yet.
          </div>
        )}

        <div className="space-y-2">
          {entries.map((entry, i) => (
            <PilotRow key={`${entry.pilotId}-${entry.droneId}`} entry={entry} rank={i + 1} />
          ))}
        </div>

        {entries.length > 0 && (
          <p className="mt-6 text-center text-xs text-white/20">
            Refreshes every 30 seconds
          </p>
        )}
      </div>
    </main>
  )
}
