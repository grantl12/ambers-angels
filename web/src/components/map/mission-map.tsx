"use client"

import Map, { Marker, NavigationControl, Popup, Source, Layer } from "react-map-gl"
import "mapbox-gl/dist/mapbox-gl.css"
import { useMemo, useState } from "react"
import { env } from "@/lib/env"
import { mockDetections, mockDronePositions, mockTrail } from "@/lib/mock-data"
import type { Detection } from "@/features/detections/types"

export function MissionMap() {
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null)

  const trailGeoJson = useMemo(
    () => ({
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: mockTrail,
      },
      properties: {},
    }),
    []
  )

  return (
    <Map
      initialViewState={{
        longitude: -97.7431,
        latitude: 30.2672,
        zoom: 12,
      }}
      mapStyle="mapbox://styles/mapbox/dark-v11"
      mapboxAccessToken={env.mapboxToken}
    >
      <NavigationControl position="top-right" />

      {mockDronePositions.map((drone) => (
        <Marker
          key={drone.droneId}
          longitude={drone.lng}
          latitude={drone.lat}
          anchor="center"
        >
          <div className="h-4 w-4 rounded-full border border-white bg-sky-500 shadow" />
        </Marker>
      ))}

      {mockDetections.map((detection) => (
        <Marker
          key={detection.id}
          longitude={detection.lng}
          latitude={detection.lat}
          anchor="center"
          onClick={(e) => {
            e.originalEvent.stopPropagation()
            setSelectedDetection(detection)
          }}
        >
          <div className="h-4 w-4 rounded-full border border-white bg-rose-500 shadow" />
        </Marker>
      ))}

      <Source id="trail" type="geojson" data={trailGeoJson}>
        <Layer
          id="trail-line"
          type="line"
          paint={{
            "line-width": 4,
            "line-opacity": 0.8,
          }}
        />
      </Source>

      {selectedDetection && (
        <Popup
          longitude={selectedDetection.lng}
          latitude={selectedDetection.lat}
          anchor="top"
          onClose={() => setSelectedDetection(null)}
        >
          <div className="text-sm">
            <div className="font-semibold">{selectedDetection.plateText || "Unknown plate"}</div>
            <div>Status: {selectedDetection.status}</div>
            <div>Confidence: {selectedDetection.confidence ?? "n/a"}</div>
          </div>
        </Popup>
      )}
    </Map>
  )
}
