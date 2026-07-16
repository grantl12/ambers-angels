"""
tests/test_fema_e2e.py

End-to-end test for the FEMA alert ingestion pipeline.

Fakes a CAP XML payload and walks every stage:
  1. XML parsing  — plates, vehicle profile, polygon, alert type
  2. Watchlist insertion
  3. Vehicle target insertion
  4. Discord notification (plates + no-plate paths)
  5. Watch-area pilot push notifications (Expo, no email)
  6. Full poll_fema_ipaws() — all of the above in one shot

No real DB or HTTP connections are made.  All I/O is mocked.

Run with:
    cd backend && pytest tests/test_fema_e2e.py -v
"""

import sys
import os
import textwrap
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest
import pytest_asyncio

# Allow direct imports from backend/
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import services.fema_connector as fc
from services.fema_connector import (
    _parse_cap_alerts,
    _extract_plates,
    _extract_vehicle_profile,
    _classify_alert,
    _add_to_watchlist,
    _add_vehicle_target,
    _notify_plates,
    _notify_no_plate,
    _notify_watching_pilots,
    poll_fema_ipaws,
)


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

# Realistic CAP XML — AMBER alert with a plate, vehicle profile, and polygon
CAP_XML_WITH_PLATE = textwrap.dedent("""\
    <?xml version="1.0" encoding="UTF-8"?>
    <alerts>
      <alert>
        <identifier>TEST-AMBER-2026-001</identifier>
        <sent>2026-04-03T12:00:00-05:00</sent>
        <headline>Amber Alert — Carroll County, GA</headline>
        <description>
          AMBER ALERT: Suspect vehicle is a silver Honda Civic sedan,
          license plate ABC1234. Last seen on I-20 westbound near
          Carrollton, GA. Child believed to be in immediate danger.
        </description>
        <areaDesc>Carroll County, GA</areaDesc>
        <polygon>33.55,-85.15 33.70,-84.95 33.45,-84.95 33.45,-85.15 33.55,-85.15</polygon>
        <eventCode>
          <value>CAE</value>
        </eventCode>
      </alert>
    </alerts>
""").encode()

# Same alert but no plate in the description
CAP_XML_NO_PLATE = textwrap.dedent("""\
    <?xml version="1.0" encoding="UTF-8"?>
    <alerts>
      <alert>
        <identifier>TEST-AMBER-2026-002</identifier>
        <sent>2026-04-03T13:00:00-05:00</sent>
        <headline>Amber Alert — Jefferson County, AL</headline>
        <description>
          AMBER ALERT: Suspect vehicle is a black Dodge pickup truck.
          No plate information available. Last seen near Birmingham, AL.
        </description>
        <areaDesc>Jefferson County, AL (Birmingham area)</areaDesc>
        <polygon>33.45,-87.00 33.60,-86.70 33.30,-86.70 33.30,-87.00 33.45,-87.00</polygon>
        <eventCode>
          <value>CAE</value>
        </eventCode>
      </alert>
    </alerts>
""").encode()

# Mattie's Call (CEM code, keyword match)
CAP_XML_MATTIES = textwrap.dedent("""\
    <?xml version="1.0" encoding="UTF-8"?>
    <alerts>
      <alert>
        <identifier>TEST-MATTIES-2026-001</identifier>
        <sent>2026-04-03T14:00:00-05:00</sent>
        <headline>Mattie's Call Issued for Fulton County, GA</headline>
        <description>
          Mattie's Call: Missing endangered adult. Last seen near Atlanta.
          Red Toyota Camry, plate XYZ9876.
        </description>
        <areaDesc>Fulton County, GA</areaDesc>
        <eventCode>
          <value>CEM</value>
        </eventCode>
      </alert>
    </alerts>
""").encode()


def _make_session_factory(rowcount=1):
    """Return an async context-manager factory wrapping a mock session."""
    mock_result = MagicMock()
    mock_result.rowcount = rowcount

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(return_value=mock_result)
    mock_session.commit = AsyncMock()
    mock_session.rollback = AsyncMock()

    @asynccontextmanager
    async def factory():
        yield mock_session

    factory._session = mock_session   # expose for assertions
    return factory


@pytest.fixture(autouse=True)
def clear_seen_identifiers():
    """Reset the module-level seen-identifier cache between tests."""
    fc._seen_identifiers.clear()
    yield
    fc._seen_identifiers.clear()


# ---------------------------------------------------------------------------
# 1. Pure parsing — no I/O
# ---------------------------------------------------------------------------

class TestParsing:

    def test_plate_extraction(self):
        alerts = _parse_cap_alerts(CAP_XML_WITH_PLATE)
        assert len(alerts) == 1
        assert "ABC1234" in alerts[0]["plates"]

    def test_vehicle_profile(self):
        alerts = _parse_cap_alerts(CAP_XML_WITH_PLATE)
        profile = alerts[0]["vehicle_profile"]
        assert profile["color"] == "silver"
        assert profile["make"] == "Honda"
        assert profile["body_type"] == "sedan"

    def test_polygon_present(self):
        alerts = _parse_cap_alerts(CAP_XML_WITH_PLATE)
        poly = alerts[0]["polygon"]
        assert poly is not None
        # Should have at least 3 coordinate pairs
        pairs = poly.strip().split()
        assert len(pairs) >= 3

    def test_alert_type_amber(self):
        alerts = _parse_cap_alerts(CAP_XML_WITH_PLATE)
        assert alerts[0]["alert_type"]["key"] == "amber"

    def test_alert_type_matties(self):
        alerts = _parse_cap_alerts(CAP_XML_MATTIES)
        assert len(alerts) == 1
        assert alerts[0]["alert_type"]["key"] == "matties"

    def test_no_plate_returns_empty_list(self):
        alerts = _parse_cap_alerts(CAP_XML_NO_PLATE)
        assert alerts[0]["plates"] == []

    def test_no_plate_vehicle_profile_still_extracted(self):
        alerts = _parse_cap_alerts(CAP_XML_NO_PLATE)
        profile = alerts[0]["vehicle_profile"]
        assert profile["color"] == "black"
        assert profile["body_type"] == "pickup"

    def test_area_and_headline(self):
        alerts = _parse_cap_alerts(CAP_XML_WITH_PLATE)
        assert "Carroll County" in alerts[0]["area"]
        assert "Amber Alert" in alerts[0]["headline"]

    def test_source_program(self):
        alerts = _parse_cap_alerts(CAP_XML_WITH_PLATE)
        assert alerts[0]["source_program"]   # should be non-empty

    def test_unmonitored_event_code_ignored(self):
        xml = b"""
        <alerts><alert>
          <identifier>IGNORE-001</identifier><sent>2026-01-01T00:00:00Z</sent>
          <headline>Tornado Warning</headline><description>Tornado warning.</description>
          <areaDesc>Somewhere</areaDesc>
          <eventCode><value>SVR</value></eventCode>
        </alert></alerts>"""
        alerts = _parse_cap_alerts(xml)
        assert alerts == []

    def test_malformed_xml_returns_empty(self):
        assert _parse_cap_alerts(b"not xml at all!!!") == []

    def test_extract_plates_direct(self):
        assert "XYZ123" in _extract_plates("plate: XYZ123 seen heading north")
        assert "AB1234" in _extract_plates("license plate AB1234 was recorded")

    def test_classify_alert_amber(self):
        entry = _classify_alert(["CAE"], "child abduction emergency")
        assert entry is not None
        assert entry["key"] == "amber"

    def test_classify_alert_silver(self):
        entry = _classify_alert(["CEM"], "silver alert elderly man missing")
        assert entry is not None
        assert entry["key"] == "silver"

    def test_classify_alert_unknown_returns_none(self):
        assert _classify_alert(["SVR"], "severe thunderstorm") is None


# ---------------------------------------------------------------------------
# 2. Watchlist insertion
# ---------------------------------------------------------------------------

class TestWatchlistInsertion:

    @pytest.mark.asyncio
    async def test_new_plate_inserted(self):
        factory = _make_session_factory(rowcount=1)
        result = await _add_to_watchlist(
            factory, "ABC1234", "Amber Alert | Carroll County, GA", "amber", "Amber Alert"
        )
        assert result is True
        factory._session.execute.assert_called_once()
        factory._session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_duplicate_plate_not_inserted(self):
        factory = _make_session_factory(rowcount=0)   # ON CONFLICT DO NOTHING
        result = await _add_to_watchlist(
            factory, "ABC1234", "desc", "amber", "Amber Alert"
        )
        assert result is False

    @pytest.mark.asyncio
    async def test_db_error_returns_false(self):
        factory = _make_session_factory()
        factory._session.execute.side_effect = Exception("connection lost")
        result = await _add_to_watchlist(factory, "XYZ", "desc", "amber", "Amber Alert")
        assert result is False
        factory._session.rollback.assert_called_once()


# ---------------------------------------------------------------------------
# 3. Vehicle target insertion
# ---------------------------------------------------------------------------

class TestVehicleTargetInsertion:

    @pytest.mark.asyncio
    async def test_profile_stored(self):
        alerts = _parse_cap_alerts(CAP_XML_WITH_PLATE)
        factory = _make_session_factory(rowcount=1)
        result = await _add_vehicle_target(factory, alerts[0])
        assert result is True
        factory._session.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_no_profile_skips_insert(self):
        """Alert with no color/body/make should not insert a vehicle_target row."""
        alert = {
            "identifier": "X",
            "alert_type": {"key": "amber"},
            "source_program": "Amber Alert",
            "headline": "Test",
            "area": "Somewhere",
            "polygon": None,
            "vehicle_profile": {"color": None, "body_type": None, "yolo_body_type": None, "make": None},
        }
        factory = _make_session_factory()
        result = await _add_vehicle_target(factory, alert)
        assert result is False
        factory._session.execute.assert_not_called()


# ---------------------------------------------------------------------------
# 4. Discord notifications
# ---------------------------------------------------------------------------

class TestDiscordNotification:

    @pytest.mark.asyncio
    async def test_notify_plates_posts_to_webhook(self):
        alerts = _parse_cap_alerts(CAP_XML_WITH_PLATE)
        with patch("services.fema_connector.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=MagicMock(status_code=204))
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            await _notify_plates("https://discord.example/webhook", alerts[0], ["ABC1234"])

        mock_client.post.assert_called_once()
        payload = mock_client.post.call_args.kwargs
        assert "ABC1234" in payload["json"]["content"]
        assert "AMBER" in payload["json"]["content"]

    @pytest.mark.asyncio
    async def test_notify_no_plate_includes_vehicle_description(self):
        alerts = _parse_cap_alerts(CAP_XML_NO_PLATE)
        with patch("services.fema_connector.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=MagicMock(status_code=204))
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            await _notify_no_plate("https://discord.example/webhook", alerts[0])

        content = mock_client.post.call_args.kwargs["json"]["content"]
        # Should mention the vehicle type or a fallback warning
        assert "pickup" in content.lower() or "No plate" in content

    @pytest.mark.asyncio
    async def test_no_webhook_url_skips_post(self):
        alerts = _parse_cap_alerts(CAP_XML_WITH_PLATE)
        with patch("services.fema_connector.httpx.AsyncClient") as mock_client_cls:
            await _notify_plates("", alerts[0], ["ABC1234"])
        mock_client_cls.assert_not_called()


# ---------------------------------------------------------------------------
# 5. Watch-area pilot push notifications
# ---------------------------------------------------------------------------

class TestWatchAreaNotification:

    # row format: (email, full_name, expo_push_token, notification_prefs)
    BOTH_PREFS  = ("pilot@example.com", "Jane",  "ExponentPushToken[abc123]", ["push", "email"])
    PUSH_ONLY   = ("pilot@example.com", "Jane",  "ExponentPushToken[abc123]", ["push"])
    EMAIL_ONLY  = ("pilot@example.com", "Jane",  None,                        ["email"])
    NO_TOKEN    = ("pilot@example.com", "Jane",  None,                        ["push", "email"])

    @pytest.mark.asyncio
    async def test_push_pref_receives_push(self):
        alerts = _parse_cap_alerts(CAP_XML_WITH_PLATE)
        mock_result = MagicMock()
        mock_result.fetchall.return_value = [self.PUSH_ONLY]
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)

        @asynccontextmanager
        async def factory():
            yield mock_session

        with patch("services.fema_connector.httpx.AsyncClient") as mock_cls:
            mock_http = AsyncMock()
            mock_http.post = AsyncMock(return_value=MagicMock(status_code=200))
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_http)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            await _notify_watching_pilots(factory, alerts[0])

        mock_http.post.assert_called_once()
        payload = mock_http.post.call_args.kwargs["json"]
        assert payload[0]["to"] == "ExponentPushToken[abc123]"
        assert "AMBER" in payload[0]["title"]

    @pytest.mark.asyncio
    async def test_email_pref_receives_email(self):
        alerts = _parse_cap_alerts(CAP_XML_WITH_PLATE)
        mock_result = MagicMock()
        mock_result.fetchall.return_value = [self.EMAIL_ONLY]
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)

        @asynccontextmanager
        async def factory():
            yield mock_session

        with patch.dict(os.environ, {"SMTP_HOST": "smtp.test", "SMTP_PORT": "587",
                                      "SMTP_USER": "u", "SMTP_PASS": "p"}):
            with patch("smtplib.SMTP") as mock_smtp_cls:
                mock_smtp = MagicMock()
                mock_smtp_cls.return_value.__enter__ = MagicMock(return_value=mock_smtp)
                mock_smtp_cls.return_value.__exit__ = MagicMock(return_value=False)
                await _notify_watching_pilots(factory, alerts[0])

        mock_smtp.send_message.assert_called_once()
        msg = mock_smtp.send_message.call_args[0][0]
        assert msg["To"] == "pilot@example.com"

    @pytest.mark.asyncio
    async def test_both_prefs_send_push_and_email(self):
        alerts = _parse_cap_alerts(CAP_XML_WITH_PLATE)
        mock_result = MagicMock()
        mock_result.fetchall.return_value = [self.BOTH_PREFS]
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)

        @asynccontextmanager
        async def factory():
            yield mock_session

        with patch("services.fema_connector.httpx.AsyncClient") as mock_cls:
            mock_http = AsyncMock()
            mock_http.post = AsyncMock(return_value=MagicMock(status_code=200))
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_http)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            with patch.dict(os.environ, {"SMTP_HOST": "smtp.test", "SMTP_PORT": "587",
                                          "SMTP_USER": "u", "SMTP_PASS": "p"}):
                with patch("smtplib.SMTP") as mock_smtp_cls:
                    mock_smtp = MagicMock()
                    mock_smtp_cls.return_value.__enter__ = MagicMock(return_value=mock_smtp)
                    mock_smtp_cls.return_value.__exit__ = MagicMock(return_value=False)
                    await _notify_watching_pilots(factory, alerts[0])

        mock_http.post.assert_called_once()
        mock_smtp.send_message.assert_called_once()

    @pytest.mark.asyncio
    async def test_push_pref_no_token_skips_push(self):
        """Pilot wants push but hasn't registered a token — no push, no error."""
        alerts = _parse_cap_alerts(CAP_XML_WITH_PLATE)
        mock_result = MagicMock()
        mock_result.fetchall.return_value = [self.NO_TOKEN]
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)

        @asynccontextmanager
        async def factory():
            yield mock_session

        with patch("services.fema_connector.httpx.AsyncClient") as mock_cls:
            with patch.dict(os.environ, {"SMTP_HOST": "smtp.test", "SMTP_PORT": "587",
                                          "SMTP_USER": "u", "SMTP_PASS": "p"}):
                with patch("smtplib.SMTP") as mock_smtp_cls:
                    mock_smtp = MagicMock()
                    mock_smtp_cls.return_value.__enter__ = MagicMock(return_value=mock_smtp)
                    mock_smtp_cls.return_value.__exit__ = MagicMock(return_value=False)
                    await _notify_watching_pilots(factory, alerts[0])

        mock_cls.assert_not_called()        # no push
        mock_smtp.send_message.assert_called_once()  # email still fires

    @pytest.mark.asyncio
    async def test_no_matching_pilots_sends_nothing(self):
        alerts = _parse_cap_alerts(CAP_XML_WITH_PLATE)
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)

        @asynccontextmanager
        async def factory():
            yield mock_session

        with patch("services.fema_connector.httpx.AsyncClient") as mock_cls:
            await _notify_watching_pilots(factory, alerts[0])
        mock_cls.assert_not_called()

    @pytest.mark.asyncio
    async def test_push_includes_centroid_data(self):
        alerts = _parse_cap_alerts(CAP_XML_WITH_PLATE)
        mock_result = MagicMock()
        mock_result.fetchall.return_value = [self.PUSH_ONLY]
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)

        @asynccontextmanager
        async def factory():
            yield mock_session

        with patch("services.fema_connector.httpx.AsyncClient") as mock_cls:
            mock_http = AsyncMock()
            mock_http.post = AsyncMock(return_value=MagicMock(status_code=200))
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_http)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            await _notify_watching_pilots(factory, alerts[0])

        msg = mock_http.post.call_args.kwargs["json"][0]
        assert msg["data"]["centroidLat"] is not None
        assert msg["data"]["centroidLng"] is not None


# ---------------------------------------------------------------------------
# 6. Full poll_fema_ipaws — end-to-end with mocked HTTP + DB
# ---------------------------------------------------------------------------

class TestPollFemaIpaws:

    def _make_http_mock(self, content: bytes, status_code: int = 200):
        """
        poll_fema_ipaws now fetches the IPAWS feed index first (one entry
        linking to a message URL), then fetches that message's CAP XML
        separately — a real two-step protocol (see _fetch_recent_ipaws_alerts).
        The first call returns a synthetic one-entry feed; the second (and
        any further) call returns the given CAP `content`. On a non-200
        status, every call returns that status so the "fetch failed" path
        is still exercised.
        """
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        feed_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<feed xmlns="http://www.w3.org/2005/Atom">'
            '<entry>'
            '<id>https://apps.fema.gov/IPAWSOPEN_EAS_SERVICE/rest/eas/999</id>'
            f'<updated>{now}</updated>'
            '<category term="13" label="statefips"/>'
            '<category term="CAE" label="event"/>'
            '</entry></feed>'
        ).encode()

        call_count = {"n": 0}

        async def fake_get(*args, **kwargs):
            call_count["n"] += 1
            if status_code != 200:
                return MagicMock(status_code=status_code, content=content)
            body = feed_xml if call_count["n"] == 1 else content
            return MagicMock(status_code=200, content=body)

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=fake_get)
        mock_client_cls = MagicMock()
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        return mock_client_cls, mock_client

    @pytest.mark.asyncio
    async def test_full_pipeline_plate_alert(self):
        """
        Happy path: new AMBER alert with plate.
        Expects: vehicle_target stored, plate watchlisted, Discord notified.
        """
        mock_client_cls, mock_http = self._make_http_mock(CAP_XML_WITH_PLATE)
        factory = _make_session_factory(rowcount=1)

        # Capture Discord calls
        discord_calls: list[str] = []
        async def fake_post_discord(url, content):
            discord_calls.append(content)

        with patch("services.fema_connector.httpx.AsyncClient", mock_client_cls):
            with patch("services.fema_connector._post_discord", side_effect=fake_post_discord):
                with patch("services.fema_connector._notify_watching_pilots", new=AsyncMock()):
                    await poll_fema_ipaws(factory, webhook_url="https://discord.example/hook")

        # Vehicle target INSERT should have fired
        assert factory._session.execute.call_count >= 2  # vehicle_target + watchlist

        # Discord was called and message contains the plate
        assert len(discord_calls) == 1
        assert "ABC1234" in discord_calls[0]
        assert "AMBER" in discord_calls[0]

    @pytest.mark.asyncio
    async def test_full_pipeline_no_plate_alert(self):
        """
        AMBER alert with no plate — should post no-plate Discord notification.
        """
        mock_client_cls, _ = self._make_http_mock(CAP_XML_NO_PLATE)
        factory = _make_session_factory(rowcount=1)
        discord_calls: list[str] = []

        async def fake_post_discord(url, content):
            discord_calls.append(content)

        with patch("services.fema_connector.httpx.AsyncClient", mock_client_cls):
            with patch("services.fema_connector._post_discord", side_effect=fake_post_discord):
                with patch("services.fema_connector._notify_watching_pilots", new=AsyncMock()):
                    await poll_fema_ipaws(factory, webhook_url="https://discord.example/hook")

        assert len(discord_calls) == 1
        # No plate in the message — should be the no-plate template
        assert "ABC1234" not in discord_calls[0]

    @pytest.mark.asyncio
    async def test_duplicate_identifier_skipped(self):
        """
        Polling the same alert twice should not insert or notify a second time.
        """
        mock_client_cls, _ = self._make_http_mock(CAP_XML_WITH_PLATE)
        factory = _make_session_factory(rowcount=1)

        discord_calls: list[str] = []
        async def fake_post_discord(url, content):
            discord_calls.append(content)

        kwargs = dict(
            webhook_url="https://discord.example/hook"
        )
        patches = dict(
            httpx_cls=patch("services.fema_connector.httpx.AsyncClient", mock_client_cls),
            discord=patch("services.fema_connector._post_discord", side_effect=fake_post_discord),
            watch=patch("services.fema_connector._notify_watching_pilots", new=AsyncMock()),
        )
        with patches["httpx_cls"], patches["discord"], patches["watch"]:
            await poll_fema_ipaws(factory, **kwargs)
            await poll_fema_ipaws(factory, **kwargs)

        # Second poll must not trigger a second Discord call
        assert len(discord_calls) == 1

    @pytest.mark.asyncio
    async def test_404_response_is_handled_gracefully(self):
        mock_client_cls, _ = self._make_http_mock(b"", status_code=404)
        factory = _make_session_factory()
        with patch("services.fema_connector.httpx.AsyncClient", mock_client_cls):
            await poll_fema_ipaws(factory)   # must not raise
        factory._session.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_fema_endpoint_returns_active_alert(self):
        """
        Verify that after poll_fema_ipaws runs, the inserted vehicle_target
        would be found by GET /fema/alerts (i.e. the INSERT SQL is correct).

        We assert the INSERT was called with the expected column values by
        inspecting the bound parameters on the mock execute call.
        """
        mock_client_cls, _ = self._make_http_mock(CAP_XML_WITH_PLATE)
        factory = _make_session_factory(rowcount=1)

        with patch("services.fema_connector.httpx.AsyncClient", mock_client_cls):
            with patch("services.fema_connector._post_discord", new=AsyncMock()):
                with patch("services.fema_connector._notify_watching_pilots", new=AsyncMock()):
                    await poll_fema_ipaws(factory, webhook_url="https://discord.example/hook")

        # Find the vehicle_target INSERT call (contains 'fema_identifier' param)
        target_call = next(
            (c for c in factory._session.execute.call_args_list
             if "fema_id" in (c.args[1] if c.args and len(c.args) > 1 else {})),
            None
        )
        assert target_call is not None, "vehicle_target INSERT not found"
        params = target_call.args[1]
        assert params["fema_id"] == "TEST-AMBER-2026-001"
        assert params["atype"] == "amber"
        assert params["color"] == "silver"
