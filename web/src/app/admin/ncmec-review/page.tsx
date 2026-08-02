"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { getAuthState } from "@/lib/auth"
import { apiGet } from "@/lib/api-client"

type PendingItem = {
  id:                 number
  caseGuid:           string
  state:              string | null
  area:               string | null
  headline:           string | null
  vehicleDescription: string | null
  vehiclePlate:       string | null
  photoUrl:           string | null
  posterUrl:          string | null
  status:             string
  createdAt:          string | null
}

export default function NcmecPendingListPage() {
  const router = useRouter()
  const [items,   setItems]   = useState<PendingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await apiGet<PendingItem[]>("/admin/ncmec-pending"))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const auth = getAuthState()
    if (!auth || !["admin", "coordinator"].includes(auth.role)) { router.replace("/map"); return }
    load()
  }, [router, load])

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-bold text-white">Pending NCMEC Reviews</h1>
          <p className="text-sm text-white/40 mt-1">
            NCMEC cases cross-referenced against an active vehicle target. The national
            alert system did not create these — nothing reaches volunteers until a
            coordinator reviews and approves it here.
          </p>
        </div>

        {loading && <div className="text-sm text-white/40">Loading…</div>}
        {error   && <div className="text-sm text-red-400">{error}</div>}
        {!loading && !error && items.length === 0 && (
          <div className="text-sm text-white/40">Nothing pending right now.</div>
        )}

        <div className="space-y-3">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/admin/ncmec-review/${item.id}`}
              className="block rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 hover:bg-amber-500/10 transition-colors"
            >
              <div className="font-semibold text-white">
                {item.headline || item.vehicleDescription || "Vehicle match"}
              </div>
              <div className="text-xs text-white/40 mt-1">
                {item.area || item.state || "Unknown area"}
                {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString()}` : ""}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
