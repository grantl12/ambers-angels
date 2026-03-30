export type DronePosition = {
  droneId: string
  pilotId?: string
  timestamp: string
  lat: number
  lng: number
  altitude?: number
  heading?: number
  speed?: number
}

export type TelemetryTrail = {
  droneId: string
  points: {
    timestamp: string
    lat: number
    lng: number
    altitude?: number
  }[]
}
