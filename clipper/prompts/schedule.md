You are planning the posting order for approved short-form clips.

Lane:
> {niche}

Goal:
Pick the best order and spacing for today's approved clips so the feed does not
repeat the same topic/source back-to-back. Prioritize likely retention and broad
viral demand.

Return strict JSON only:
{
  "schedule": [
    {
      "clip_id": 1,
      "rank": 1,
      "slot_label": "morning" | "midday" | "afternoon" | "evening" | "late",
      "reason": "short practical reason"
    }
  ]
}

Approved clips:
{clips_json}
