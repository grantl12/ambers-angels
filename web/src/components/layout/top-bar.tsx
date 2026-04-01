"use client"

import { useActiveMissions } from "@/features/missions/api"
import { useLatestTelemetry } from "@/features/telemetry/api"
import { useDetectionsFeed } from "@/features/detections/api"
import { env } from "@/lib/env"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"

function useUsername() {
  const [name, setName] = useState("Pilot")
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("aa_username") : null
    if (stored) setName(stored)
  }, [])
  return name
}

export function TopBar() {
  const { data: missions = [] }   = useActiveMissions()
  const { data: drones = [] }     = useLatestTelemetry()
  const { data: detections = [] } = useDetectionsFeed(50)
  const username = useUsername()

  const mission    = missions[0]
  const alertCount = detections.filter((d) => d.status === "alerted").length

  const [utcTime, setUtcTime] = useState("")
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setUtcTime(
        `${String(now.getUTCHours()).padStart(2, "0")}:` +
        `${String(now.getUTCMinutes()).padStart(2, "0")}:` +
        `${String(now.getUTCSeconds()).padStart(2, "0")} UTC`
      )
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [menuOpen])

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
        {utcTime && (
          <span className="font-mono text-white/30">{utcTime}</span>
        )}

        {/* Username / account dropdown */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            <span className="h-5 w-5 rounded-full bg-sky-500/30 text-sky-300 text-[10px] flex items-center justify-center font-bold select-none">
              {username[0]?.toUpperCase() ?? "P"}
            </span>
            {username}
            <svg className={`h-3 w-3 text-white/40 transition-transform ${menuOpen ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none">
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-white/10 bg-neutral-900 shadow-xl z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-white/10 text-xs text-white/40">
                Signed in as <span className="text-white/70">{username}</span>
              </div>
              <Link
                href="/settings"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors"
              >
                Settings &amp; Notifications
              </Link>
            </div>
          )}
        </div>
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
