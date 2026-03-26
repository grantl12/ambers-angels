import asyncio
from services.detection_models import DetectionInput 
from services.aggregation_service import AggregationService
from services.event_service import EventService
from services.alert_dispatcher import AlertDispatcher

class DetectionPipeline:
    def __init__(self, aggregation, events, alerts):
        self.aggregation = aggregation
        self.events = events
        self.alerts = alerts

    async def process_detection(self, detection_input: DetectionInput):
        snapshot = self.aggregation.ingest(detection_input)
        if not snapshot or not snapshot.should_open_event:
            return None

        decision = self.events.upsert_from_snapshot(snapshot)
        if not decision:
            return None

        if decision.should_dispatch_alert:
            await self.alerts.dispatch(decision.event)

        return decision
