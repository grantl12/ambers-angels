import asyncio
from datetime import datetime
from services.detection_pipeline import DetectionPipeline
from services.aggregation_service import AggregationService
from services.event_service import EventService
from services.alert_dispatcher import AlertDispatcher
from services.detection_models import DetectionInput
from event_repository import EventRepository

async def run_live_test():
    # 1. Setup real Repository
    # Format: postgresql://username:password@localhost/dbname
    DATABASE_URL = "postgresql://ambers-angels:Ambers1Angels@localhost/ambers_angels"
    repo = EventRepository(DATABASE_URL)
    
    # 2. Setup Services
    aggregator = AggregationService()
    events = EventService(repository=repo)
    alerts = AlertDispatcher(repository=repo, webhook_url=None)
    
    pipeline = DetectionPipeline(aggregator, events, alerts)
    
    # 3. Create a High-Confidence Detection
    det = DetectionInput(
        plate="FLYER77",
        plate_normalized="FLYER77",
        confidence=0.98,
        drone_id="DRONE_01",
        latitude=33.7490,
        longitude=-84.3880,
        timestamp=datetime.utcnow()
    )
    
    print("🚀 Sending live detection to Database...")
    try:
        result = await pipeline.process_detection(det)
        print(f"✅ Success! Database Result: {result}")
    except Exception as e:
        print(f"❌ Database Insertion Failed: {e}")

if __name__ == "__main__":
    asyncio.run(run_live_test())
