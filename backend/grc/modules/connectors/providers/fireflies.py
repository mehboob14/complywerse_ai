"""Fireflies.ai adapter — meeting transcription pickup.

Fetches recently transcribed meetings via the Fireflies GraphQL API at
`https://api.fireflies.ai/graphql`. Each transcript becomes a
`CommitteeMeetingMinutes`-shaped row downstream (the consumer in
`tasks/transcribe_sync.py` handles the mapping).

Auth: simple `Authorization: Bearer <api_key>` — Fireflies issues
long-lived personal API keys, no OAuth dance needed.

API docs: https://docs.fireflies.ai/graphql-api/intro
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

from ..base import ConnectionTestResult, MeetingTranscript, TranscribeAdapter
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)


FIREFLIES_ENDPOINT = "https://api.fireflies.ai/graphql"


_LIST_QUERY = """
query Transcripts($limit: Int!, $fromDate: DateTime) {
  transcripts(limit: $limit, fromDate: $fromDate) {
    id
    title
    date
    duration
    participants
    summary {
      overview
      action_items
      keywords
      bullet_gist
    }
    sentences {
      speaker_name
      text
      start_time
    }
  }
}
"""


class FirefliesAdapter(TranscribeAdapter):
    provider = "fireflies"

    def _headers(self) -> Dict[str, str]:
        key = self.credentials.get("api_key")
        if not key:
            raise RuntimeError("Fireflies API key missing")
        return {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def test_connection(self) -> ConnectionTestResult:
        try:
            resp = requests.post(
                FIREFLIES_ENDPOINT,
                json={"query": "{ user { user_id email } }"},
                headers=self._headers(),
                timeout=20,
            )
            if resp.status_code == 200 and not resp.json().get("errors"):
                user = resp.json().get("data", {}).get("user", {}) or {}
                return ConnectionTestResult(
                    success=True,
                    message="Authenticated to Fireflies.ai.",
                    details={"user_email": user.get("email")},
                )
            return ConnectionTestResult(
                success=False,
                message=f"Fireflies returned {resp.status_code}: {resp.text[:300]}",
            )
        except Exception as exc:
            logger.exception("Fireflies test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))

    def fetch_transcripts(
        self,
        *,
        since: Optional[datetime] = None,
        limit: int = 50,
    ) -> List[MeetingTranscript]:
        variables: Dict[str, Any] = {"limit": min(limit, 50)}
        if since:
            variables["fromDate"] = since.replace(tzinfo=timezone.utc).isoformat()

        resp = requests.post(
            FIREFLIES_ENDPOINT,
            json={"query": _LIST_QUERY, "variables": variables},
            headers=self._headers(),
            timeout=60,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Fireflies fetch failed ({resp.status_code}): {resp.text[:300]}"
            )
        body = resp.json()
        if body.get("errors"):
            raise RuntimeError(f"Fireflies GraphQL errors: {body['errors']}")

        items = (body.get("data") or {}).get("transcripts") or []
        out: List[MeetingTranscript] = []
        for t in items:
            try:
                started = _parse_dt(t.get("date"))
            except Exception:
                started = datetime.now(timezone.utc)
            duration = t.get("duration")
            ended = started + _duration_to_delta(duration) if duration else None
            summary_obj = t.get("summary") or {}
            transcript_md = _sentences_to_markdown(t.get("sentences") or [])
            out.append(MeetingTranscript(
                source_id=t.get("id") or "",
                title=t.get("title") or "(untitled meeting)",
                started_at=started,
                ended_at=ended,
                duration_minutes=int(duration) if isinstance(duration, (int, float)) else None,
                attendees=list(t.get("participants") or []),
                transcript_markdown=transcript_md,
                summary=summary_obj.get("overview") or summary_obj.get("bullet_gist"),
                action_items=list(summary_obj.get("action_items") or []),
                raw=t,
            ))
        return out


def _parse_dt(value: Any) -> datetime:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000 if value > 1e12 else value, tz=timezone.utc)
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _duration_to_delta(value: Any):
    from datetime import timedelta
    try:
        return timedelta(minutes=float(value))
    except Exception:
        return timedelta()


def _sentences_to_markdown(sentences: List[Dict[str, Any]]) -> str:
    if not sentences:
        return ""
    lines = []
    current_speaker = None
    for s in sentences:
        speaker = s.get("speaker_name") or "Speaker"
        text = (s.get("text") or "").strip()
        if not text:
            continue
        if speaker != current_speaker:
            lines.append(f"\n**{speaker}:**")
            current_speaker = speaker
        lines.append(text)
    return "\n".join(lines).strip()


META = ProviderMeta(
    provider="fireflies",
    label="Fireflies.ai",
    category="transcribe",
    description="Pull meeting transcripts from Fireflies.ai. Auto-creates committee meeting minutes with action items extracted.",
    auth_method="api_key",
    fields=[
        ProviderField(key="api_key", label="API key",
                      kind="password", required=True,
                      help_text="Fireflies personal or workspace API key."),
    ],
    adapter_cls=FirefliesAdapter,
    docs_url="https://docs.fireflies.ai/graphql-api/intro",
)
