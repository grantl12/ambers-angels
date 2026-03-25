export type DronePosition = {
  droneId: string
  pilotId?: string
  timestamp: string
  lat: number
  lng: number
  altitude?: number
  heading?: number
}
