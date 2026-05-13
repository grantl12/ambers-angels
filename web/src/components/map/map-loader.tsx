"use client"

import dynamic from "next/dynamic"
import type { LayerState } from "@/app/map/page"
import type { FlockBbox } from "@/features/flock/api"

type Props = {
  layers: LayerState
  flockBbox?: FlockBbox
  onMapReady?: (flyTo: (lat: number, lng: number) => void) => void
}

const DynamicMap = dynamic(
  () => import("./mission-map").then((m) => m.MissionMap),
  { ssr: false, loading: () => <div className="h-full w-full bg-neutral-950" /> }
)

export function MapLoader(props: Props) {
  return <DynamicMap {...props} />
}
