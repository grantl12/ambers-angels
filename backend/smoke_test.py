import asyncio
from datetime import datetime
# Clean imports
from services.detection_models import DetectionInput
from services.aggregation_service import AggregationService
from services.event_service import EventService
from services.alert_dispatcher import AlertDispatcher
from services.detection_pipeline import DetectionPipeline

class MockRepo:
    def __init__(self): self.data = {}
    async def get_active_event(self, p, d, **kwargs): return self.data.get(f"{p}_{d}")
    async def create_event(self, obj): 
        self.data[f"{obj.plate_best}_{obj.drone_id}"] = obj
        return obj
    async def update_event(self, id, updates): pass

async def run_test():
    class MockRepo: pass
    repo = MockRepo()
    # Setup
    agg = AggregationService()
    events = EventService(repository=MockRepo())
    alerts = AlertDispatcher(repository=repo, webhook_url=None)
    pipeline = DetectionPipeline(agg, events, alerts)

    print("🚀 Running Smoke Test (Corrected Namespaces)...")
    
    det = DetectionInput(
        plate="TEST123",
        confidence=98.0,
        drone_id="DRONE_01",
        latitude=0.0,
        longitude=0.0,
        timestamp=datetime.utcnow()
    )
    
    result = await pipeline.process_detection(det)
    if result:
        print(f"✅ Success! Status: {result.status}")
    else:
        print("❌ Failed: Detection was filtered.")

if __name__ == "__main__":
    asyncio.run(run_test())
