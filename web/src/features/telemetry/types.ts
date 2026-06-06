export type DronePosition = {
  droneId: string
  pilotId?: string
  timestamp: string
  lat: number
  lng: number
  altitude?: number
  heading?: number
  speed?: number
  volunteerMode?: "drone" | "phone" | "both" | string
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
