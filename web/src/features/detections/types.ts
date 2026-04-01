export type Detection = {
  id: string
  timestamp: string
  lat: number | null
  lng: number | null
  plateText?: string
  droneId?: string
  confidence?: number
  status: string
  frameUrl?: string | null
  source?: "fema" | "drone"
  vehicleColor?: string | null
  vehicleType?:  string | null
  vehicleMake?:  string | null
  vehicleModel?: string | null
}
