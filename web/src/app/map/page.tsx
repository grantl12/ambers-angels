"use client"

import { useRef, useState } from "react"
import { MapLoader } from "@/components/map/map-loader"
import { MissionSidebar } from "@/components/mission/mission-sidebar"
import { EventFeed } from "@/components/mission/event-feed"
import { TopBar } from "@/components/layout/top-bar"

export type LayerState = {
  flock: boolean
  coverage: boolean
  zones: boolean
  drones: boolean
  heat: boolean
  hits: boolean
}

export default function MapPage() {
  const [layers, setLayers] = useState<LayerState>({
    flock: true,
    coverage: true,
    zones: true,
    drones: true,
    heat: true,
    hits: true,
  })

  const flyToRef = useRef<((lat: number, lng: number) => void) | null>(null)

  const toggleLayer = (key: keyof LayerState) =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }))

  function flyTo(lat: number, lng: number) {
    flyToRef.current?.(lat, lng)
  }

  const [mobileSidebar, setMobileSidebar] = useState(false)
  const [mobileFeed,    setMobileFeed]    = useState(false)

  return (
    <main className="flex h-screen w-screen flex-col bg-neutral-950">
      <TopBar />
      <div className="relative flex flex-1 overflow-hidden">

        {/* Sidebar — always visible on md+, drawer overlay on mobile */}
        <div className="hidden md:flex">
          <MissionSidebar layers={layers} onToggleLayer={toggleLayer} onFlyTo={flyTo} />
        </div>
        {mobileSidebar && (
          <div className="absolute inset-0 z-30 flex md:hidden">
            <div className="flex h-full">
              <MissionSidebar layers={layers} onToggleLayer={toggleLayer} onFlyTo={(lat, lng) => { flyTo(lat, lng); setMobileSidebar(false) }} />
            </div>
            <div className="flex-1 bg-black/50" onClick={() => setMobileSidebar(false)} />
          </div>
        )}

        {/* Map — always full width on mobile */}
        <div className="flex-1 relative">
          <MapLoader layers={layers} onMapReady={(fn) => { flyToRef.current = fn }} />

          {/* Mobile toggle buttons */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-3 md:hidden">
            <button
              onClick={() => { setMobileSidebar(true); setMobileFeed(false) }}
              className="rounded-full bg-black/80 border border-white/20 px-4 py-2 text-xs text-white/70 backdrop-blur-sm"
            >
              ☰ Layers
            </button>
            <button
              onClick={() => { setMobileFeed(true); setMobileSidebar(false) }}
              className="rounded-full bg-black/80 border border-white/20 px-4 py-2 text-xs text-white/70 backdrop-blur-sm"
            >
              ⚡ Feed
            </button>
          </div>
        </div>

        {/* Event feed — always visible on md+, drawer overlay on mobile */}
        <div className="hidden md:flex">
          <EventFeed onFlyTo={flyTo} />
        </div>
        {mobileFeed && (
          <div className="absolute inset-0 z-30 flex flex-row-reverse md:hidden">
            <div className="flex h-full">
              <EventFeed onFlyTo={(lat, lng) => { flyTo(lat, lng); setMobileFeed(false) }} />
            </div>
            <div className="flex-1 bg-black/50" onClick={() => setMobileFeed(false)} />
          </div>
        )}

      </div>
    </main>
  )
}
