# Voice input prototype

## Scope

The MVP transcribes short Russian voice fragments into the workout note and client trainer-note fields. Each successful transcription replaces the current textarea value, so a repeated recording does not append another version of the note. The result remains editable and is saved only when the trainer submits the corresponding form. Manual text input always remains available.

Voice input is intentionally limited to workout notes and trainer notes on clients. It does not parse exercises, sets, measurements, or commands.

## Privacy and data flow

- The microphone recording and transcription stay in the browser.
- Audio is not uploaded to Supabase or another service, stored in application state after transcription, written to logs, or persisted in the database.
- Only the trainer-reviewed text is saved as an ordinary workout or client note.
- Moving transcription to a server or a third-party API requires a separate architecture and privacy review.

## Implementation

- Runtime: `@fugood/node-whisper-wasm`, an MIT-licensed browser wrapper around `whisper.cpp`.
- Model: multilingual `ggml-tiny-q5_1.bin` from `ggerganov/whisper.cpp`, pinned to revision `5359861c739e955e79d9a303bcbc70fb988958b1`.
- Model download: approximately 31 MB on the first use, then cached by the browser.
- Audio: recorded with `MediaRecorder`, decoded and resampled to mono 16 kHz PCM in the browser.
- Recognition: Russian language, up to 60 seconds per fragment. The worker uses multiple threads when the browser is cross-origin isolated and falls back to one thread otherwise.

The model is deliberately loaded only after the trainer starts voice input, so normal page loading is not blocked by the model download.

## User states

The control must visibly distinguish:

1. idle;
2. recording with elapsed time and a stop action;
3. model preparation/download;
4. transcription;
5. success or an actionable error.

Permission denial, unavailable microphone, unsupported recording, model download failure, and recognition failure must leave the textarea editable and allow a retry.

## Acceptance gate

Before treating the prototype as release-ready:

- verify microphone permission and transcription on current iPhone Safari and Android Chrome;
- test 20-30 realistic fitness phrases in Russian, including exercise names, weights, repetitions, and pauses;
- record perceived first-load time and warm transcription time on representative phones;
- confirm that DevTools Network contains only the pinned model download and no audio upload;
- confirm that page refresh or navigation discards unfinished audio;
- keep the feature a prototype if recognition quality or mobile latency is not acceptable.

CI tests the text insertion and all UI states with fakes. CI must not request a real microphone or download the model.
