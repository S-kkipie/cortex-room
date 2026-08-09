# Manual E2E smoke checklist (Recall.ai)

Prereqs: a deployed Worker (public URL), `RECALL_API_KEY` + `RECALL_WEBHOOK_SECRET`
+ `AUTH_TOKEN` set as secrets, `PUBLIC_BASE_URL` var = the deployed URL, and a real
Google Meet link. Recall billing is active per meeting-minute.

1. Deploy: `wrangler deploy`. Note the Worker URL; confirm it equals `PUBLIC_BASE_URL`.
2. Start:
   ```bash
   curl -XPOST "$URL/meetings/demo/start" -H "authorization: Bearer $AUTH_TOKEN" \
     -H 'content-type: application/json' -d '{"meetingUrl":"<meet-link>"}'
   ```
   Expect `{ "botId": "...", "state": "in_meeting" }`. A Recall bot joins the meeting.
3. Watch: `curl "$URL/meetings/demo/stream" -H "authorization: Bearer $AUTH_TOKEN"`.
4. Speak in the meeting with ≥2 participants. Confirm `transcript.segment` events
   appear with `identityConfidence:"resolved"` and the correct `speaker.displayName`,
   plus `speaker.active` events on speech start/stop.
5. Roster: `curl "$URL/meetings/demo" -H "authorization: Bearer $AUTH_TOKEN"` lists participants.
6. Stop: `curl -XPOST "$URL/meetings/demo/stop" -H "authorization: Bearer $AUTH_TOKEN"`.
   The bot leaves; a `session.ended` event appears on the stream.
7. Replay: `curl "$URL/meetings/demo/transcript?since=0" -H "authorization: Bearer $AUTH_TOKEN"`.

## Live-verification points (confirm against current Recall docs during this run)
- Stop-bot endpoint path (`/api/v1/bot/{id}/leave_call/`).
- That `transcript.data` `words[].start_timestamp.relative` are seconds (drives absolute time).
- Webhook signature header names for your workspace (webhook-* vs svix-* for legacy workspaces).
