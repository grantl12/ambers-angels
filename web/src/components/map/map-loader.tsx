"use client"

import dynamic from "next/dynamic"
import type { LayerState } from "@/app/map/page"
import type { FlockBbox } from "@/features/flock/api"

export type MapControls = {
  flyTo: (lat: number, lng: number) => void
  fitBounds: (bbox: FlockBbox) => void
}

type Props = {
  layers: LayerState
  flockBbox?: FlockBbox
  onMapReady?: (controls: MapControls) => void
}

const DynamicMap = dynamic(
  () => import("./mission-map").then((m) => m.MissionMap),
  { ssr: false, loading: () => <div className="h-full w-full bg-neutral-950" /> }
)

export function MapLoader(props: Props) {
  return <DynamicMap {...props} />
}
