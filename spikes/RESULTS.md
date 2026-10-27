# Phase 1 — Day-1 spikes: results with real calls

Date: 2026-10-26. Runner: `pnpm spikes` (`spikes/run-all.ts`, six spikes in
order, one row each; a failing spike never aborts the run).

Environment notes (no secrets below — keys are only ever read through
`process.env` and travel only in request headers/bodies, never in logs):

- `.env` provided `META_API_KEY` + `META_API_BASE_URL` (`https://api.meta.ai/v1`),
  `MUSE_SPARK_MODEL=muse-spark-1.3`, `SAM_MODEL=sam-3.1`,
  `STT_MODEL=muse-voice-transcribe-1.0`. All Meta spikes ran for real.
- `BASETEN_BASE_URL` / `BASETEN_API_KEY` are empty → spike 5 `SKIPPED`.
- `ELEVENLABS_API_KEY` / `ELEVENLABS_MODEL_ID` / `ELEVENLABS_VOICE_ID_ES`
  are empty → spike 6 `SKIPPED`.
- `ffmpeg` is NOT installed (`ffmpeg -version` → not found). `afinfo`
  (macOS) confirms the WAV is already PCM16 mono 16 kHz, so no conversion
  was needed; the spike rebuilds canonical WAVs in pure Node when probing.
- Sandbox limitation: the `tsx` CLI cannot open its IPC pipe here
  (`listen EPERM`), so runs used `node --import tsx/esm` on the same files.
  Committed scripts keep `tsx` (works outside the sandbox).
- Sandbox network is proxy-only: raw `ws` DNS fails here while `fetch`
  works. `spikes/04-stt.ts` therefore passes an `HttpsProxyAgent` (new
  spikes devDependency) to `ws` when `HTTPS_PROXY`/`https_proxy` is set,
  and connects directly otherwise — the STT realtime socket was tested
  for real through the proxy. Proxy handshakes measured 3.1–5.6 s
  (~400 ms direct per the manual run); one run transiently lost a socket
  at DNS (close 1006) while an identical config succeeded minutes apart.
- No usage/pricing fields were returned by any Meta endpoint, and no token
  counts were observed in SSE events. Cost tracking stays call-count based
  (`ProviderCallLog`) against the $150 credits (§24 row 8).
- Secret scan: `grep -ri 'bearer|sk-|xi-api-key' spikes/fixtures/` is clean;
  `calls.jsonl` (44 lines) carries model/endpoint/status/latency only.

## Spike 1 — SAM 3.1 (`spikes/01-sam.ts`) — OK

Sent: `POST https://api.meta.ai/v1/responses` exactly per spec §10.2
(`model: sam-3.1`, one message with `input_text` concept + `input_image`
data URL, `stream: true`,
`metadata: { include_confidence: "true", mask_encoding }`).
24 combos: 5 photos × 4 concepts (`cup`, `plate`, `fork`, `aluminum tray`);
photo 01 tried both `one_bit` and `lossless`, photos 02–05 `one_bit`.
24/24 HTTP 200. Raw streams saved verbatim to
`spikes/fixtures/sam/<photo>__<concept>__<encoding>.txt` (+ `parsed.json`).

Sent sizes (JPEG q85, none downscaled — all longest sides ≤ 1500 px):
01: 1448×1086, 321,597 bytes; 02: 1086×1448, 342,355 bytes;
03: 1448×1086, 342,176 bytes; 04: 1312×1199, 294,569 bytes;
05: 1448×1086, 333,454 bytes.

Received: SSE event sequence per call is
`response.created → response.in_progress → response.output_item.added →
response.content_part.added →` exactly ONE `response.output_text.delta`
(carries the FULL text, not chunks) `→ response.output_text.done`
(repeats the full text in `text`) `→ response.content_part.done →
response.output_item.done → response.completed`
(`response.output[i].content[j].text` repeats it a third time) `→ [DONE]`.
Zero matches (05 plate, 05 fork) produce NO delta event at all — confirmed.

Parser bug found and fixed the same day: the first version also collected
`.done`'s `text`, which double-counted every object (8 instead of 4).
The committed parser only consumes `response.output_text.delta`.
`spikes/lib/sam.ts` parses `<Nf>id<|box;x1=..;…;c=..|><|mask;x=..;data=H,W,enc+payload|>`
into frames/objects/boxes/confidences; all 76 parsed objects carry `c`
(box and mask level) because `include_confidence` was always `"true"`.

Latencies (ms): min 606, p50 1253, max 6927 (first call of the run).
Per concept p50/max: cup 1031/6927, plate 1478/3540, fork 1135/2022,
aluminum tray 1326/2309. One concept ≈ 1–2 s typical; 4 parallel
concepts per frame fit the §11.2 p50 < 2.5 s budget if parallelized.

Counts vs `spikes/inputs/ground-truth.json` (`one_bit` runs):

| photo                   | cup (truth→sam, err) | plate    | fork      | tray     |
| ----------------------- | -------------------- | -------- | --------- | -------- |
| 01 top-down             | 4→4 (0)              | 3→3 (0)  | 6→6 (0)   | 2→2 (0)  |
| 02 angled               | 4→4 (0)              | 1→2 (+1) | 10→7 (−3) | 3→3 (0)  |
| 03 top-down, lidded     | 4→0 (−4)             | 0→0 (0)  | 7→7 (0)   | 2→2 (0)  |
| 04 angled cluttered     | 4→5 (+1)             | 4→3 (−1) | 7→8 (+1)  | 2→3 (+1) |
| 05 false-positive check | 1→1 (0)              | 0→0 (0)  | 0→0 (0)   | 1→1 (0)  |

Per-concept absolute error: cup 5, plate 2, fork 4, tray 1 (21 photos×concepts
with nonzero truth). Photo 05 shows no hallucinated plates/forks.
Photo 03's 4 lidded cups are missed by the `cup` concept (they read as
cups-with-lids; the 6 sauce cups are a separate concept) — evidence for §24
row 7: covered/lidded items need the identify/lid-label step, not SAM alone.

Mask encodings: `one_bit` payloads carry `!`, `lossless` carry `~`
(`data=H,W,<enc><payload>`), same boxes/dims/counts for both encodings on
photo 01 (e.g. fork 286×45 both; tray 340×319 both). Lossless payloads are
~20× longer than one_bit for the same object.

Base85 evidence (76 payloads): the observed alphabet is exactly 85 chars —
`!#$%&'()*+-./0123456789:=?@A-Z[]^_` + backtick + `a-z{`
(codes 33,35–43,45–47,48–58,61,63–91,93–96,97–123; notably excludes
`"`, `,`, `;`, `<`, `>`, `\`, `|`, `}`, `~`).
It is NONE of RFC1924 (differs by `'./:[]`), Z85 (differs by `'`, `_`,
backtick — closest, Δ3), or Ascii85 (differs by `vwxyz{`).
Decoding 5→4 bytes under the two most plausible orders (sorted-index,
ascii85-with-substitution) yields byte counts matching NEITHER the one-bit
(`ceil(H·W/8)`) NOR the byte-per-pixel (`H·W`) hypothesis
(e.g. fork 286×45 lossless: 1,676 bytes vs 12,870; one_bit: 76 bytes vs
1,609), and zlib/gzip/raw-inflate/brotli all fail on the decoded bytes;
bit-rendered ASCII art of a fork mask is noise. The packing is therefore
NOT plain base85-of-bitmap — likely a compressed/vector form whose
char→value order is still unknown.

Verdict: request shape, streaming shape, boxes, and confidences CONFIRMED;
alphabet recorded exactly; bit packing UNRESOLVED → §24 row 1 fallback
stands (boxes + confidences for overlays; mask decode deferred to Phase 5).

## Spike 2 — identify a crop (`spikes/02-identify.ts`) — OK

Sent: crop of spike-1 box `01/cup#0` with 8% padding, 213×229 JPEG
(11,190 bytes; `fixtures/identify/crop.png` + `crop-meta.json`), plus the
prompt "Identify the single object in this crop. Candidates: cup, plate,
fork, aluminum tray, other…" to `POST …/v1/responses` with model
`muse-spark-1.3` (never a `-contributor` variant — the spike refuses one).

Received: mechanism A (`text.format: { type: "json_schema", name:
"identification", strict: true, schema }`) → HTTP 200 with a standard
Responses envelope (`output[].content[].text`), parsed first try with Zod as
`{"concept":"cup","confidence":0.99,"lidLabelText":null,"isLidClosed":false,
"reason":"Clear ribbed transparent plastic tumbler …"}`.
Mechanism B (prompt-for-JSON + Zod + one repair retry) was implemented but
never needed; result shapes saved (redacted) to
`fixtures/identify/result.json`. Latencies: 3,433 ms (first run),
3,002 ms (final run).

Verdict: the spec §10.2 structured-output field name is CONFIRMED as
`text.format` with `json_schema` (§24 row 3 resolved, no fallback needed;
mechanism B stays as defensive fallback).

## Spike 3 — read the scale display (`spikes/03-display.ts`) — OK

Sent: `spikes/inputs/display.png` (1086×1448, sent as 269,384-byte JPEG,
no downscale) × 5 runs, `muse-spark-1.3`, prompt-for-JSON asking for
`{ value, unit, confidence }` (Zod-validated per run).

Received, all 5 runs: `{"value":1.24,"unit":"kg","confidence":0.99}`.
Runs saved to `fixtures/display/runs.json`. Latencies (ms):
2121, 3509, 2282, 2673, 2583 → p50 2583, max 3509.
Ground truth (`display.png` key): 1.24 kg → value error 0, fully consistent
(5/5 identical). A first version of the spike looked up the wrong
ground-truth key (`display` instead of `display.png`) and reported
"unavailable"; fixed before the final run.

Verdict: scale-display reading is reliable on this shot (§24 row 6
CONFIRMED for the tested angle). Keep the second-angle/manual-entry
fallback for unreadable cases — one photo cannot prove the overhead angle.

## Spike 4 — Spanish STT (`spikes/04-stt.ts`) — OK (realtime CONFIRMED)

Input: `spikes/inputs/es-10s.wav` — 273,706 bytes; header walk finds the
`data` chunk at offset 4096 (JUNK-padded, `WAVE_FORMAT_EXTENSIBLE` tag
65534); 269,610 PCM16 mono 16 kHz bytes ≈ 8.4 s. Reference text (24 words):
"Listo, ya metí las dos bandejas de pollo y una de arroz. Me faltan los
tenedores y cuatro vasos. ¿Cuántas ensaladas lleva este pedido?"
WER is computed normalized (lowercase, punctuation stripped).

Follow-up run 2026-10-26 (`pnpm spike:4`, live through the sandbox proxy):
realtime `wss://api.meta.ai/v1/asr/realtime` works with the confirmed
protocol — no auth header (the `ws` package; Node's global WebSocket
failed with close 1006 on this endpoint), first client frame
`{"mode":"ENDPOINTING","authorization":{"accessToken":"…"},
"audioEncoding":"PCM_24KHZ","model":"muse-voice-transcribe-1.0",
"partialMode":"CUMULATIVE","emitAudioProgress":false,
"languageBias":[…],"keywords":[…]}`; audio starts only after the
`{sessionId}` reply (a `type:"error"` reply means the handshake failed);
raw PCM16 mono 24 kHz in 4,800-byte (100 ms) binary frames paced in real
time (the 16 kHz input is resampled in Node with linear interpolation,
header stripped by RIFF chunk walk); end with `{"type":"endStream"}`;
the server closes `1000 "No more transcript segments"`.

Observed event sequence per run: `{sessionId}` → `speechStart` → 20–21
CUMULATIVE `transcript` partials (growing text; a last `final:true`
arrives with empty text) → `speechEnd` → `speechComplete {transcript}`
(the final utterance text) → close 1000. Two spike bugs found and fixed
the same day: the first version kept the FIRST partial as the running
transcript instead of the latest, and typed `turnId` as string-only
(the server sends number `0`), which dropped `speechEnd`/`speechComplete`
from Zod parsing.

Two runs, same 8.4 s input, full runs saved to `fixtures/stt/result.json`
with per-run latencies in `calls.jsonl` (never the key):

- no-bias (`languageBias:[]`, `keywords:[]`): "Listo, ya metí las dos
  bandejas de pollo y una de arroz. Me faltan los tenedores y cuatro
  cuatro vasos. ¿Cuántas ensaladas llevaste pedido?" → WER 0.125 (3/24:
  duplicated "cuatro"; "llevaste pedido" vs "lleva este pedido").
  Handshake 4,592 ms, first partial 2,272 ms, `speechComplete` 7,699 ms,
  close 8,741 ms (audio-start based).
- es-bias (`languageBias:["es"]`,
  `keywords:["bandejas","tenedores","vasos","ensaladas"]`): "Listo, ya
  metí las dos bandejas de pollo y un arroz. Me faltan los tenedores y
  cuatro vasos. ¿Cuántas ensaladas lleva este pedido?" → WER 0.083
  (2/24: "un arroz" vs "una de arroz"). Handshake 3,112 ms, first
  partial 1,864 ms, `speechComplete` 7,617 ms, close 8,739 ms.

So: first partial ≈ 2 s after the audio starts, partials trail the audio
by ~0.2–0.5 s, `speechComplete` ≈ 0.7 s after the speech ends
(`audioProcessedMs` ≈ 6.9 s). Handshakes are proxy-inflated here (~400 ms
direct per the manual run). This run's no-bias transcript beat the manual
run's poor no-bias one ("…dobandada…"), so quality varies run to run;
the es-bias transcript matches the manual run's (one small error).
Per the manual run, `"spanish"` and `"es-US"` performed slightly worse
than `"es"`.

File `POST /v1/asr/transcribe` (Bearer auth accepted — errors are
400-shape validation, never 401): earlier, the server's own errors had
mapped the partial shape over 6 probe rounds (probes were throwaway
scripts under `/tmp`):

1. `file` + `model` + `language` parts → 400 (568 ms):
   `"Both a 'request' and an 'audio' part are required"`.
2. `request` (JSON blob `{model, language:'es', audioEncoding:'LINEAR16',
sampleRateHertz:16000}`) + `audio` (original WAV) → 400:
   `"Malformed request"` (also with `es-ES`, without `model`, with
   snake_case → those revert to `You must specify the 'audioEncoding'
field`, proving `request` is parsed as JSON with camelCase keys).
3. Same `request` + canonical 44-byte-header WAV rebuilt in pure Node
   (standard PCM tag, same PCM bytes) and raw-PCM variants → 400
   `"Malformed request"` (252–6,542 ms; the ~6 s ones suggest the server
   got as far as audio processing before rejecting).

File `POST /v1/asr/transcribe`: retained as one `request`+`audio`
attempt → still 400 `"Malformed request"` (2,117 ms) — not needed,
realtime works. The earlier probes had mapped the partial shape
(`request` + `audio` parts, camelCase `audioEncoding`) over 6 rounds.

Flakiness notes: one intermediate run lost its second socket at DNS
(close 1006, 90 s overall timeout) while an identical config succeeded
minutes apart; one sandbox file fetch stalled 301 s before failing.
Client hardening from this: `socket.terminate()` (not `close()`) on
teardown so a dead socket cannot keep the process alive, and a 30 s
timeout on the file fetch.

Verdict: §24 row 4 CONFIRMED. Fixed `languageBias:["es"]` per station +
`keywords` from the catalog item names; no language auto-detection (no
detected language is returned).

## Spike 5 — Baseten (`spikes/05-baseten.ts`) — SKIPPED

`SKIPPED: 05-baseten: missing env key(s): BASETEN_BASE_URL, BASETEN_API_KEY`
(exit 0). The script tries `{BASETEN_BASE_URL}/chat/completions` then
`/v1/chat/completions` with `{model: BASETEN_MODEL, messages, max_tokens}`
once keys exist. → §24 row 5 fallback chosen: `IDENTIFIER_PROVIDER=meta`.

## Spike 6 — ElevenLabs TTS (`spikes/06-tts.ts`) — SKIPPED

`SKIPPED: 06-tts: missing env key(s): ELEVENLABS_API_KEY,
ELEVENLABS_MODEL_ID, ELEVENLABS_VOICE_ID_ES` (exit 0). The script streams
`POST https://api.elevenlabs.io/v1/text-to-speech/{voice}/stream`,
saves MP3 to `fixtures/tts/sample-es.mp3`, and reports TTFB + total.

## Summary table (final full run)

| spike       | status  | key evidence                                                                                                          |
| ----------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| 01-sam      | OK      | 24/24 HTTP 200; p50 1,253 ms, max 6,927 ms; counts err ≤ 1 except 02-fork −3, 03-cup −4 (lidded); 05 exact            |
| 02-identify | OK      | `text.format`+`json_schema` works first try; cup 0.99; 3.0 s                                                          |
| 03-display  | OK      | 5/5 `1.24kg`; p50 2,583 ms, max 3,509 ms; err 0                                                                       |
| 04-stt      | OK      | realtime 2/2 close 1000; WER 0.125 no-bias, 0.083 es-bias; first partial ~2 s, complete ~7.7 s; file 400 (not needed) |
| 05-baseten  | SKIPPED | keys empty                                                                                                            |
| 06-tts      | SKIPPED | keys empty                                                                                                            |

## VERIFY + §24 resolutions

| #        | item                                        | resolution                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1/§24-1 | SAM base85 alphabet + bit packing           | DIFFERENT: alphabet is a custom 85-char set (recorded exactly; closest Z85 Δ3 `'`, `_`, backtick); `!`=`one_bit`, `~`=`lossless` confirmed; packing is not plain base85-of-bitmap → fallback: boxes+confidences for overlays, mask decode deferred |
| V2/§24-2 | SAM latency per image per concept           | CONFIRMED: p50 ≈ 1.25 s, max ≈ 6.9 s (cold); parallelize ≤4 concepts/frame; stage-photo fallback stays                                                                                                                                             |
| V3/§24-3 | Muse Spark structured-output field          | CONFIRMED: `text.format` + `json_schema` (+ `strict`) on Responses                                                                                                                                                                                 |
| V4/§24-4 | STT realtime + language detection           | CONFIRMED: realtime handshake/audio/`endStream`/events live (2/2 close 1000); es-bias WER 0.083 → fixed `languageBias` per station + catalog `keywords`; no auto-detection (nothing returned)                                                      |
| V5/§24-5 | Baseten endpoint for `muse-spark-open-1026` | UNTESTED (no keys) → fallback chosen: Meta API only                                                                                                                                                                                                |
| §24-6    | Scale displays from overhead                | CONFIRMED on tested shot (5/5 exact); fallback stays for unreadable cases                                                                                                                                                                          |
| §24-7    | Covered trays                               | OBSERVED: lidded cups missed by `cup` (0/4) while trays found 2/2 → capture-before-lidding + lid-label reading stays the plan                                                                                                                      |
| §24-8    | Real pricing                                | No usage/pricing returned anywhere → budget via `ProviderCallLog` call counts                                                                                                                                                                      |

## Spec changes made (`docs/MUSE_CODE_SPEC.md`, git-ignored)

1. §10.2 SAM streaming: exactly one full-text `response.output_text.delta`
   per response; `.done`/`response.completed` repeat the text (parse deltas
   only); zero matches emit no delta event.
2. §10.2 base85: replaced the plain-base85 assumption with the observed
   85-char set, `!`/`~` markers, same-box-across-encodings, and the failed
   decode attempts → boxes+confidences now, mask decode in Phase 5.
3. §10.2 Muse Spark: `text.format` + `json_schema` confirmed (kept
   prompt-JSON+Zod+repair as fallback).
4. §10.2 STT: realtime protocol CONFIRMED (token handshake JSON,
   24 kHz PCM16 100 ms frames, `endStream`, event names, per-station
   `languageBias` + catalog `keywords`, no auto-detection); file endpoint
   kept as not-needed (`request`+`audio`, still 400s). §13 updated to match.
   Also §10.1 `SpeechToTextPort`: 24 kHz + bias/keywords instead of
   `language` + auto-detection.
5. §10.3 Baseten: still VERIFY (untested); Meta-only default confirmed.
6. §11.2: added measured SAM numbers (p50 ≈ 1.25 s/concept) under the
   existing targets.
7. §24: updated all eight rows with the resolutions above.
