import { MapLoader } from "@/components/map/map-loader"
import { MissionSidebar } from "@/components/mission/mission-sidebar"
import { EventFeed } from "@/components/mission/event-feed"
import { TopBar } from "@/components/layout/top-bar"

export default function MapPage() {
  return (
    <main className="flex h-screen w-screen flex-col bg-neutral-950">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <MissionSidebar />
        <div className="flex-1">
          <MapLoader />
        </div>
        <EventFeed />
      </div>
    </main>
  )
}
