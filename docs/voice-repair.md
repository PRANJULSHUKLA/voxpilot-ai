# Voice repair and cosmic interface — 20 October 2026

## Diagnosis

The original frontend checked getUserMedia permission, immediately stopped those tracks, and then constructed SpeechRecognition/webkitSpeechRecognition. That separate browser recognizer did not use the permission-test stream. There was no MediaRecorder, multipart audio upload, backend audio route, decoder, local model or persisted model cache. All recognition therefore depended on browser support and the vendor's speech service; a working physical microphone was insufficient. The precise vendor/device error in the user's earlier session cannot be recovered from the available evidence. No issue was found in the established Gemini/LangChain/LangGraph request path, so that integration was preserved.

## Changed components

- `frontend/src/services/recorder.ts`: actual MediaRecorder capture, MIME feature detection, media-track cleanup, permission/cancellation races, byte/time limits and a binary Blob. AudioContext/AnalyserNode drives a measured RMS meter; unavailable metering is labeled.
- `frontend/src/services/speech.ts`: state-machine orchestration, local transcription upload, automatic callback, readiness polling, stale-response protection, request interruption and actual per-turn timing.
- `frontend/src/services/synthesis.ts`: existing browser playback preserved behind its provider interface; expected cancellations do not cause playback errors.
- `frontend/src/App.tsx`: recognized text passes directly to the existing session-scoped workflow when auto-send is enabled, rather than reading stale draft state. Missing Gemini configuration preserves the transcript. Review mode lets users edit/send manually. Late model replies cannot restart cancelled playback.
- `frontend/src/components/CosmicOrb.tsx`, `frontend/src/cosmic.css`: interactive recording orb, layered celestial rings, finite star field, SVG constellation lines, nebula atmosphere, explicit voice phases, real microphone level, reduced motion and responsive layout. All existing screens retain their real functions.
- `frontend/src/features/Settings.tsx` and `Observability.tsx`: model preparation/status, auto-send preference, real local transcription counts/errors/latency and existing generation traces.
- `backend/app/providers/transcription.py`: reusable faster-whisper 1.2.1 model, CPU/int8, multilingual base, lock-protected initialization/inference, MIME/container validation, bounded PyAV decoding, VAD, no-speech errors and safe diagnostics. Native inference runs in a threadpool, not the asyncio loop.
- `backend/app/api/audio.py`: `/audio/status`, `/audio/prepare`, `/audio/transcribe`, validated response schema and metadata-only request traces. Recognition never calls Gemini.
- Backend configuration, request-size middleware and chat response metadata; Docker libgomp dependency, memory budget and persistent `whisper_models` cache volume; updated setup/privacy documentation and new tests/fixtures.

## Pipeline and states

User action → getUserMedia → supported MediaRecorder format → microphone amplitude meter → Stop → release microphone → multipart audio Blob → validated local PyAV decode → one cached faster-whisper model → recognized text → optional transcript review → established LangGraph route → configured server-side Gemini → persisted text response → browser speechSynthesis → laptop speakers.

The explicit phases are `idle`, `requesting_permission`, `listening`, `stopping_recording`, `transcribing`, `transcript_ready`, `thinking`, `speaking`, `error`. Automatic submission is enabled by default. Meeting mode accumulates segments without generating notes per fragment; knowledge mode uses the selected document. Native speech synthesis is a separate browser feature; no server TTS was added.

Recordings default to at most 60 seconds/10 MB and must contain at least 0.4 seconds of decodable audio. The client stops near the duration limit; the server independently validates decoded sample count rather than trusting upload metadata. The endpoint closes uploaded files even on errors. Raw recordings are not stored permanently; the named volume holds only model weights. The shipped JFK fixtures are public test recordings, not user microphone recordings.

Cancelling HTTP abandons the browser result, not the already-running native CPU inference or a remote Gemini generation. A model may finish after disconnect. Audio playback is stopped immediately; a late reply cannot automatically restart it. First model download requires network access to Hugging Face; cached local recognition requires no network or paid API.

## Real execution evidence

A real 11-second WAV fixture from OpenAI Whisper's public JFK test recording was transcribed on Apple Silicon/Python 3.11 using faster-whisper base, CPU/int8. Actual output:

> And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country.

A WebM/Opus re-encoding also passed real recognition with `HF_HUB_OFFLINE=1` after model caching. This establishes actual decoder/inference operation rather than a mocked transcript. Fixture-source details are in `backend/tests/fixtures/README.md`.

Normal tests mock inference/providers and perform no paid calls. Tests exercise real WAV/WebM decoding, empty/malformed/type-mismatched uploads, duration/size caps, initialization failure, empty transcription, missing Gemini after recognition, model reuse and readiness. Browser API mocks cover capture, permission denial, unsupported MIME, empty/short recordings, stale result cancellation, downstream failure, automatic chat submission, editable review and answer-only speech playback. The final suite has 42 passing backend tests (also passed in Linux ARM64 Docker), 23 passing frontend tests, and a successful production build; one paid live test was skipped. The real-STT/actual-LangGraph/mocked-Gemini PostgreSQL pipeline and the running HTTP proxy both passed. See [the verification record](verification.md) for exact Docker/browser results.

## Remaining boundaries

Browser capture was exercised: it produced a 5.7-second recording from silent input, then showed the correct no-speech error. A live spoken utterance, account-specific Gemini generation and actual speaker audibility remain unverified separately from fixture/mock tests. No Gemini key is currently configured. No accuracy claims are made beyond the tested English fixture; multilingual/noisy input and accents require a broader evaluation set. Browser/OS microphone permission and a secure context are still required. This remains a single-user local application without public deployment authentication.
