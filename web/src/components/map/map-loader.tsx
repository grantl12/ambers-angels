"use client"

import dynamic from "next/dynamic"
import type { LayerState } from "@/app/map/page"

type Props = {
  layers: LayerState
  onMapReady?: (flyTo: (lat: number, lng: number) => void) => void
}

const DynamicMap = dynamic(
  () => import("./mission-map").then((m) => m.MissionMap),
  { ssr: false, loading: () => <div className="h-full w-full bg-neutral-950" /> }
)

export function MapLoader(props: Props) {
  return <DynamicMap {...props} />
}
