export type Mission = {
  id: string
  title: string
  status: "planned" | "active" | "paused" | "completed"
  startedAt: string
  endedAt?: string
}
