/**
 * Polygon math helpers used by MapScreen and CameraScreen.
 * All distance values are in miles.
 */

const D2R = Math.PI / 180
const EARTH_MI = 3958.8

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * D2R
  const dLon = (lon2 - lon1) * D2R
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2
  return EARTH_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function parsePoly(s: string): [number, number][] {
  return s
    .trim()
    .split(/\s+/)
    .map((p) => {
      const [a, b] = p.split(",").map(Number)
      return [a, b]
    })
}

function inPoly(lat: number, lon: number, poly: [number, number][]): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = poly[i]
    const [yj, xj] = poly[j]
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

function segDist(
  lat: number,
  lon: number,
  a: [number, number],
  b: [number, number]
): number {
  const c = Math.cos(lat * D2R)
  const px = lon * c, py = lat
  const ax = a[1] * c, ay = a[0]
  const bx = b[1] * c, by = b[0]
  const dx = bx - ax, dy = by - ay
  const len = dx * dx + dy * dy
  const t = len > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
  return haversine(lat, lon, a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
}

/** Returns miles to the nearest edge of the polygon, or 0 if inside. */
export function distToPolygon(lat: number, lon: number, polyStr: string | null): number | null {
  if (!polyStr) return null
  const poly = parsePoly(polyStr)
  if (poly.length < 3) return null
  if (inPoly(lat, lon, poly)) return 0
  const n = poly.length
  let min = Infinity
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const d = segDist(lat, lon, poly[j], poly[i])
    if (d < min) min = d
  }
  return min
}

export type AlertWithDistance = {
  miles: number
  alert: { polygon: string | null; alertType: string; sourceProgram?: string | null; area?: string | null }
}

/** Returns the nearest active alert and its distance in miles. */
export function nearestAlert<T extends { polygon: string | null }>(
  lat: number,
  lon: number,
  alerts: T[]
): { miles: number; alert: T } | null {
  let best: { miles: number; alert: T } | null = null
  for (const a of alerts) {
    const d = distToPolygon(lat, lon, a.polygon)
    if (d === null) continue
    if (!best || d < best.miles) best = { miles: d, alert: a }
  }
  return best
}
