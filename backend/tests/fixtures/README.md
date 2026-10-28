`jfk.wav` is the public JFK speech test recording from OpenAI Whisper's `tests/jfk.flac`, resampled to mono 16 kHz signed 16-bit PCM for deterministic decoder and opt-in real-model tests.
Source: https://github.com/openai/whisper/blob/main/tests/jfk.flac
Expected passage includes “ask not what your country can do for you”. No user microphone recording is stored here.

`jfk.txt` is the full reference for this 11-second fixture. `scripts/evaluate_stt.py` compares normalized words against it; WAV and WebM are two encodings of one sample, not independent quality cases.
