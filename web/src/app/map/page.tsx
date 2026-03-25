import { MissionMap } from "@/components/map/mission-map"
import { MissionSidebar } from "@/components/mission/mission-sidebar"
import { EventFeed } from "@/components/mission/event-feed"

export default function MapPage() {
  return (
    <main className="flex h-screen w-screen bg-neutral-950">
      <MissionSidebar />
      <div className="flex-1">
        <MissionMap />
      </div>
      <EventFeed />
    </main>
  )
}
