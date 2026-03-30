"use client"

import dynamic from "next/dynamic"

export const MapLoader = dynamic(
  () => import("./mission-map").then((m) => m.MissionMap),
  { ssr: false, loading: () => <div className="h-full w-full bg-neutral-950" /> }
)
