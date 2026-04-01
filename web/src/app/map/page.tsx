"use client"

import { useRef, useState } from "react"
import { MapLoader } from "@/components/map/map-loader"
import { MissionSidebar } from "@/components/mission/mission-sidebar"
import { EventFeed } from "@/components/mission/event-feed"
import { TopBar } from "@/components/layout/top-bar"

export type LayerState = {
  flock: boolean
  coverage: boolean
  drones: boolean
  heat: boolean
  hits: boolean
}

export default function MapPage() {
  const [layers, setLayers] = useState<LayerState>({
    flock: true,
    coverage: true,
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

  return (
    <main className="flex h-screen w-screen flex-col bg-neutral-950">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <MissionSidebar layers={layers} onToggleLayer={toggleLayer} onFlyTo={flyTo} />
        <div className="flex-1">
          <MapLoader layers={layers} onMapReady={(fn) => { flyToRef.current = fn }} />
        </div>
        <EventFeed onFlyTo={flyTo} />
      </div>
    </main>
  )
}
