# Evaluation and evidence — 25 October 2026

Tests and model quality are different claims. The deterministic suite mocks Gemini and exercises real routing, transactions, schemas, failure mapping, limits, parsing and UI lifecycle. The opt-in live suite is skipped by default to avoid quota usage. Four existing cases in `backend/evals/cases.json` cover context recall, abstention, one injection and missing owners; they do not establish general accuracy.

## Repeatable speech evaluation

```sh
HF_HUB_OFFLINE=1 .venv/bin/python scripts/evaluate_stt.py
```

Requires cached base weights in `.cache/whisper`; no downloads or Gemini calls. Reference: `backend/tests/fixtures/jfk.txt`, transcribed from the included public 11-second JFK excerpt. The WAV and WebM fixtures contain the same utterance, so this is one sample in two formats. Fixture provenance is in `backend/tests/fixtures/README.md`.

`word_error_rate` normalizes case and punctuation using Unicode word tokens, computes word-level Levenshtein edit distance and divides by reference word count. An empty reference is rejected; insertions can yield WER above one. Unit tests cover substitutions, insertions, deletions and normalization. This does not score punctuation, speaker identity or meaning.

| Measurement | Observed value |
| --- | --- |
| Host | macOS 27.0 arm64, Python 3.11.15 |
| Speech configuration | faster-whisper base, CPU/int8, 4 threads |
| Cached model initialization | 834.28 ms |
| WAV inference including decode | 770.90 ms; WER 0.0 |
| WebM inference including decode | 697.82 ms; WER 0.0 |
| Input duration | 11 seconds each; sequential, one run per format |

These are host measurements, not Docker or browser turn latency. No broad acoustic dataset, live microphone accuracy, concurrent throughput, resource utilization study, live Gemini latency, answer faithfulness score or production SLO was measured. No performance regression threshold is inferred from this sample.

## Acceptance criteria and regressions

- Successful transcription must reach the callback while `/audio/status` is stalled; successful answers must reach synthesis while history refresh is stalled.
- Provider failure must preserve the draft and leave no successful message pair; a history refresh failure must not invite regenerating an already-saved answer.
- Foreign browser Origin writes must return 403 before model preparation or session creation. Configured local origins and CLI requests must still work.
- Invalid embedding count, dimensions, non-finite/non-numeric values and zero vectors must fail before persistence or answer generation. Large finite vectors must have stable cosine arithmetic.
- Existing citation membership, abstention, meeting evidence, session scoping, deletion and upload-limit tests must stay green. Blank grounded answers must not persist.

Final executed suite/build/container results are maintained in [verification](verification.md). They supersede historical records for this increment. CI is added but its hosted run requires a future push; no hosted CI success is claimed.

## Next quality experiment

Build a small held-out corpus of answerable/unanswerable questions with annotated relevant chunk IDs and expected supporting claims. Measure recall@k, abstention precision/recall, citation validity and human-reviewed claim support separately. Compare chunk size/threshold before considering hybrid search or reranking. Use a fixed prompt/model identifier and report sample counts and errors. This experiment is not implemented or scored yet.
