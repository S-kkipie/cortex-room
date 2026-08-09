# Manual E2E smoke checklist

Prereqs: AssemblyAI key in `ASSEMBLYAI_API_KEY`, a real Meet link, and a second person to host and admit the guest.

1. `docker run -p 8080:8080 -e ASSEMBLYAI_API_KEY=... cortex-meet-agent`
2. `curl -XPOST localhost:8080/start -H 'content-type: application/json' -d '{"meetingId":"demo","meetUrl":"<link>"}'`
3. Host sees **Cortex Notetaker** requesting to join; admit it.
4. `curl localhost:8080/state` returns `{"state":"in_meeting"}`.
5. Have two people speak in turn. `curl localhost:8080/stream` shows `transcript.segment` events.
6. Confirm at least one segment has `identityConfidence:"inferred"` with the correct name.
7. If names are always `unresolved`, open Meet in a real browser, inspect a participant tile, and correct selectors in `meet-ui-adapter/selectors.ts` (the only file to touch). Re-run.
8. `curl -XPOST localhost:8080/stop` produces `session.ended` on the stream.
9. `curl "localhost:8080/transcript?since=0"` returns the full ordered list.
