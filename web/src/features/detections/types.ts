export type Detection = {
  id: string
  timestamp: string
  lat: number
  lng: number
  plateText?: string
  confidence?: number
  status: "candidate" | "reviewed" | "dismissed" | "escalated"
}
