# Five-minute demonstration

Prepare beforehand: run the documented stack; prepare local Whisper weights; configure a private Gemini key if demonstrating generation; confirm one actual request works. Do not seed answers or mock results in the product. No live Gemini access was verified in this increment. Use `docs/demo/atlas.txt` and `meeting.txt`, which contain synthetic publishable data.

1. **0:00–1:00 Voice:** disable auto-send, record “What is retrieval-augmented generation?”, stop, show recognized editable text, make a correction and Send. Enable spoken responses, then interrupt playback. Explain local audio versus remote text generation. If microphone permission is denied, show the actionable error and type instead.
2. **1:00–2:00 Knowledge:** create/select a conversation, upload `atlas.txt`, ask “When and where does the study group meet?” Inspect actual source excerpt and filename. TXT has no page number. Do not imply the citation alone proves every claim.
3. **2:00–2:40 Abstention:** ask “What is the project's approved budget?” The document explicitly provides no budget. Inspect the result; a fabricated budget is a demo failure to record, not conceal.
4. **2:40–3:40 Meeting:** create a meeting, paste `meeting.txt`, generate notes. Check Leo's action evidence and the unassigned citation review. Edit an action status, save and export Markdown. Original transcript remains distinct from notes.
5. **3:40–4:20 Recovery:** record silence or deny permission; show recognition failure and text fallback. Alternatively use an isolated empty-key backend to show provider configuration failure. Do not invalidate the user's working key.
6. **4:20–5:00 Evidence:** inspect Observability for real operation IDs, latencies and available token counts. Refresh conversation to show persisted answers. Explain that cancellation may still complete on the server and that citation panels are not retained across reload.

Manual browser acceptance: desktop and narrow mobile viewport; keyboard tab/focus; reduced-motion preference; duplicate Send prevented; interruption during recording/transcription; manual draft preserved after generation failure; no secret visible in config/errors. This increment's browser automation is component-level with mocks. Physical microphone and audible speaker output require a real browser/OS session.
