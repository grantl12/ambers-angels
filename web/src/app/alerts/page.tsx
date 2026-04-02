"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getAuthState } from "@/lib/auth"
import { apiGet } from "@/lib/api-client"

type AlertRecord = {
  id:           number
  plate:        string | null
  droneId:      string | null
  channel:      string
  sentAt:       string | null
  vehicleColor: string | null
  vehicleType:  string | null
  vehicleMake:  string | null
  vehicleModel: string | null
  confidence:   number | null
  alertType:    string
  description:  string | null
}

function fmt(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
}

const TYPE_COLORS: Record<string, string> = {
  amber:  "bg-amber-500/20 text-amber-400",
  silver: "bg-slate-400/20 text-slate-300",
  blue:   "bg-blue-500/20 text-blue-400",
  test:   "bg-purple-500/20 text-purple-400",
}

export default function AlertHistoryPage() {
  const router = useRouter()
  const [alerts,  setAlerts]  = useState<AlertRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getAuthState()) { router.replace("/login"); return }
    apiGet<AlertRecord[]>("/alerts/history")
      .then(setAlerts)
      .finally(() => setLoading(false))
  }, [router])

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white">Alert History</h1>
          <p className="text-sm text-white/40 mt-1">All Discord alerts fired by the pipeline</p>
        </div>

        {loading && <div className="text-sm text-white/40">Loading…</div>}

        {!loading && alerts.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-10 text-center text-sm text-white/30">
            No alerts fired yet
          </div>
        )}

        <div className="space-y-2">
          {alerts.map((a) => {
            const vehicle = [a.vehicleColor, a.vehicleMake, a.vehicleModel, a.vehicleType]
              .filter(Boolean).join(" ")
            return (
              <div key={a.id}
                className="rounded-xl border border-white/8 bg-white/4 px-5 py-4 flex items-start gap-4">
                <div className="shrink-0 mt-0.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_COLORS[a.alertType] ?? TYPE_COLORS.amber}`}>
                    {a.alertType.toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="font-mono font-bold text-white text-base">
                      {a.plate ?? "—"}
                    </span>
                    {vehicle && (
                      <span className="text-sm text-white/50">{vehicle}</span>
                    )}
                    {a.confidence != null && (
                      <span className="text-xs text-white/25">{a.confidence}% conf</span>
                    )}
                  </div>
                  {a.description && (
                    <div className="text-xs text-white/40 mt-0.5">{a.description}</div>
                  )}
                  <div className="text-xs text-white/25 mt-1 flex gap-3 flex-wrap">
                    <span>{fmt(a.sentAt)}</span>
                    {a.droneId && <span>Drone: {a.droneId}</span>}
                    <span>{a.channel}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <button onClick={() => router.push("/map")}
          className="text-xs text-white/30 hover:text-white/60 transition-colors">
          ← Back to map
        </button>
      </div>
    </main>
  )
}
