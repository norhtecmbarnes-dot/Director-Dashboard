# 05 — Text & Graphics On-Screen Over AI-Generated Video

**Scope:** how to reliably place text and graphics (VSL / presentation style) over AI-generated
video in a **local-first, Windows, Next.js/TypeScript** pipeline (Director Dashboard + ComfyUI),
building on the **Remotion integration that already exists** in this repo.

**Reporter's note on verification.** Every FFmpeg flag, filter and option quoted below was
checked against the **actual `ffmpeg-static` binary this project ships** (see §0.1), not from
memory. Tool capabilities I could not verify this session are flagged as *[unverified]*.
Today's date: October 2026.

---

## 0. TL;DR (the recommendation up front)

*(Full detail in §5.)*

1. **Keep Remotion as the compositor** — it is already the text/graphics engine in this stack,
   and React/TS is exactly what the app is written in. Text, lower-thirds, cards and captions
   are all just React components rendered over the generated video plate.
2. **Use `ffmpeg-static` (already installed) as the fast, deterministic finisher** — burn ASS
   captions, overlay pre-rendered PNG/alpha text cards, mux audio, trim. This is the "one-shot,
   no browser" path and it is already proven in `src/app/api/duix/clone/route.ts`.
3. **Never rely on diffusion models to draw your text** (§3) — the model generates the *plate*
   with no text; text is always composited on top.
4. **Captions**: transcribe locally with `@remotion/install-whisper-cpp` (or `faster-whisper` /
   WhisperX) → word timings → `@remotion/captions` for Remotion, or an `.srt`/`.ass` burned with
   FFmpeg for the non-browser path.

---

## 0.1 What this project already has (so we build on it, not duplicate it)

Read directly from the repo:

| Asset | Where | What it means |
|---|---|---|
| **Remotion service (REST client)** | `src/lib/integrations/remotion.ts` | Thin client to an **external Remotion render server** at `REMOTION_API_URL` (default `http://localhost:3001`). Calls `/render`, `/compositions`, `/templates`, `/preview`, `/ai/render`. It does **not** run Remotion in-process. |
| **Remotion REST route** | `src/app/api/remotion/route.ts` | Next route exposing `create`, `preview`, `ai-generate`, `cancel`, `render-status`. Passes `composition`, `inputProps`, `width/height/fps/durationInFrames`, `audio`. |
| **`ffmpeg-static`** | `package.json` dep `^5.3.0`; used in `src/app/api/duix/clone/route.ts` | A bundled FFmpeg binary is **already in the project** and spawned from a Next route. |
| **`html-to-image`** | `package.json` | Can rasterise DOM → PNG at exact resolution → usable as an overlay plate. |
| **Canvas / presentation features** | `src/app/api/canvas/route.ts`, `src/app/canvas/page.tsx` | LLM-generated HTML/CSS dashboards/slides. Styling conventions already exist (dark theme `#0f172a` bg, accent `#60a5fa`). |
| **ComfyUI** | `src/lib/comfyui/*` | Produces the generated video/image plate. |

**Verified FFmpeg build in this repo** (`node_modules/ffmpeg-static/ffmpeg.exe`):

```
ffmpeg version 6.1.1-essentials_build-www.gyan.dev
configuration: --enable-gpl --enable-libass --enable-freetype ... --enable-libfreetype
               --enable-libfribidi --enable-libharfbuzz --enable-libx264 ...
```

Filters confirmed present on this exact binary:

```
ass        V->V   Render ASS subtitles onto input video using the libass library
drawtext   V->V   Draw text on top of video frames using libfreetype library
subtitles  V->V   Render text subtitles onto input video using the libass library
overlay    VV->V  Overlay a video source on top of the input
drawbox / fade / xfade   (present)
```

**Consequence:** the local FFmpeg already supports `drawtext` (**needs libfreetype + libharfbuzz,
both enabled here**), styled subtitle burn-in via `libass` (`ass` + `subtitles`), and alpha
compositing via `overlay`. No extra FFmpeg install is required for the FFmpeg path. *(Note: some
FFmpeg builds ship without these — e.g. Debian's build broke `drawtext` when harfbuzz was added as
a hard dependency [12]; this project's binary is fine.)*

---

## 1. Programmatic composition options (fair comparison)

### 1.1 Remotion (React/TS — already integrated)

- **What it is.** A framework for writing videos as React components and rendering them to
  MP4/WebM/GIF programmatically. Rendering is a 3-step Node API: `bundle()` →
  `selectComposition()` → `renderMedia()` (also `renderStill()`, `renderFrames()`, `getCompositions()`)
  [1][2]. CLI equivalent: `npx remotion render <entry> <composition-id> <out>` [3].
- **Licence.** Custom **"Remotion Licence" — source-available, not OSI-approved open source** [4][5].
  *Free* for individuals, teams ≤3 people (even incorporated), and non-profits. Larger orgs need a
  **Company Licence**: *Remotion for Creators* $25/seat/mo, or *Remotion for Automators*
  $0.01/render with a $100/mo minimum [4][5][6]. Same functionality regardless of tier [7].
- **Scriptability.** Excellent and first-class: headless Node SSR, plus `@remotion/player` to embed
  a live, scrubable preview in a **plain React app / Next.js** with no server render [8][9].
- **Text quality.** Browser-class: any web font (`@remotion/google-fonts`), full CSS (kerning,
  gradients, letter-spacing, per-glyph transforms, text-shadow), and per-word/per-glyph animation.
  This is the strongest text-quality story of any option.
- **Motion/graphics.** Best-in-class: `interpolate()` with Bézier easing, `spring()`, `<Sequence>`
  for timing, `@remotion/transitions` (`<TransitionSeries>`, slide/fade, `linearTiming()`,
  `springTiming()`), plus WebGL/Three and Lottie via companion packages [10][11].
- **Caveats.** (a) Requires **Chrome Headless Shell** (~downloaded into `node_modules/.remotion/`) —
  `npx remotion browser ensure` / `ensureBrowser()` [13]. (b) Heavier + slower than a bare FFmpeg
  encode. (c) Not a live compositor. (d) In *this* repo it is an **external server** — composition
  code lives in that server, not in the Next app.

### 1.2 FFmpeg (`drawtext`, `subtitles`, `ass`, `overlay` — already installed here)

- **What it is.** The universal muxer/filter engine. Three relevant video filters: `drawtext`
  (graphic text via libfreetype), `overlay` (alpha composite a second input), and `subtitles`/`ass`
  (styled subtitle burn-in via libass) [14][15][16].
- **`drawtext` options (verified on this binary):** `text`, `textfile`, `fontfile`, `font`,
  `fontcolor`, `fontsize`, `box`, `boxcolor`, `boxborderw`, `boxw/boxh`, `borderw`, `bordercolor`,
  `shadowx/shadowy`, `shadowcolor`, `line_spacing`, `text_align`, `y_align`, `fix_bounds`,
  `text_shaping`, and `enable` for timeline gating (e.g. `enable='between(t,3,6)'`).
  *Limitation:* `drawtext` does **not** auto-wrap arbitrary paragraphs — you must pre-wrap text or
  use `textfile`, and multi-word layout/spacing is crude compared with a browser.
- **`subtitles`/`ass` options (verified):** `filename`/`f`, `original_size` (scales fonts),
  `fontsdir` (point at your bundled fonts), `charenc`, `stream_index`, `force_style` (override ASS
  style fields), `alpha`, `wrap_unicode`.
- **Licence.** FFmpeg core is **LGPL v2.1+**, but builds compiled with GPL-only components (`x264`)
  are **GPL**. This repo's binary has `--enable-gpl --enable-libx264` ⇒ treat it as **GPL** [12][17].
  Fine for local-first internal use.
- **Scriptability.** Excellent — pure CLI, trivially `spawn()`ed from Node (already done in the
  Duix route).
- **Text quality.** *Fair* for `drawtext` (one font per call, crude layout, good box/shadow/border);
  *strong* for `subtitles`/`ass` because **libass** gives real styling, positioning, karaoke (`\k`).
- **Motion/graphics.** Weak as a keyframe engine: you get `fade`, `xfade`, animated `overlay`
  (expressions), and moving `drawtext` via `x`/`y` expressions. For anything richer, **pre-render
  graphics elsewhere and `overlay` them**.
- **Best role here:** deterministic burn-in of captions/ASS and compositing of pre-rendered
  text-card PNGs, plus audio mux/trim.

### 1.3 MoviePy (Python)

- **What it is.** Python library for cuts, compositing, title insertions; media become numpy arrays
  [18]. v2 example: `VideoFileClip(...).subclipped(...)`, `TextClip(font=..., text=..., font_size=...).with_position('center')`,
  `CompositeVideoClip([clip, txt]).write_videofile("out.mp4")` [18].
- **Licence.** **MIT** [18].
- **Scriptability.** Good Python API, but **not Node** — needs a Python sidecar in this stack.
- **Text quality.** Good but manual: v2 `TextClip` renders **via Pillow** and now **requires a font
  file path at construction**; layout/wrapping is your job [19][20]. (v1's ImageMagick dependency
  is gone in v2.)
- **Motion/graphics.** Basic — positioning, fades, effects; **slow** (per-frame Python/numpy) though
  export is delegated to FFmpeg [18][21].
- **Caveats.** **v2.0 introduced large breaking changes** (`.set_*` → `.with_*`; renamed methods;
  different `TextClip` signature) and v1 is unmaintained [19][20].

### 1.4 Motion Canvas (TypeScript)

- **What it is.** A TypeScript library + editor for **vector / motion-graphics** animations;
  animations are generator functions (`export default makeScene2D(function* (view){...})`), with a
  real-time preview editor and audio-sync workflow [22][23][24].
- **Licence.** **MIT** — commercial use, closed-source derivatives allowed, output is yours [22][25].
  *(A discussion about switching to GPL exists but MIT is the current licence.)* [26]
- **Scriptability.** Good (TS + Vite), but it's its **own API**, not React, and its headless/batch
  rendering story is less mature than Remotion's SSR API. Ecosystem is small; v3 has had breaking
  changes between minors [25].
- **Text quality.** Strong (HTML/CSS/SVG). **Motion/graphics.** Excellent for *explainer* motion
  graphics, but it is **graphics-first, not a video compositor** — it is not the natural place to
  composite text over a ComfyUI video plate.
- **Best role here:** optional, for isolated "explainer" segments; not the main overlay engine.

### 1.5 OBS Studio + obs-websocket (live compositor)

- **What it is.** A real-time scene compositor. Since **OBS 28**, **obs-websocket v5 is bundled**
  (Tools → WebSocket Server Settings; default `ws://localhost:4455`) [27][31]. Drive it with JSON
  Requests over the WebSocket: `SetCurrentProgramScene`, `SetInputSettings` (e.g. update a **Text
  (GDI+) source**), `StartRecord`/`StopRecord`, `TriggerStudioModeTransition`, and a `RequestBatch`
  (OpCode 8) for atomic multi-op [27][28][29]. Handshake is Hello/Identify with SHA-256 challenge
  auth; **v5 ≠ v4 (v4 is EOL)** [28].
- **Licence.** **GPL-2.0-or-later** (OBS) [30][31].
- **Scriptability.** Good at the protocol level; official Python client is `obsws-python` [29]; for
  Node you talk the raw v5 JSON protocol over a WebSocket.
- **Text quality / motion.** Rich (Text sources, browser sources rendering HTML, transitions,
  filters) but designed for **live output**. **Recordings run in real time (one pass)** — bad for
  deterministic, accelerated offline renders of many videos.
- **Best role here:** a **"live / streaming" mode only**. Not the offline pipeline's compositor.

### 1.6 Blender VSE (Video Sequence Editor)

- **What it is.** Blender's VSE can add text strips and image/movie strips and render out. Python
  API: `scene.sequence_editor.sequences.new_effect(name=..., type='TEXT', channel=..., frame_start=..., frame_end=...)`,
  then set `.text`, `.font_size`, `.color`, `.use_box`, `.box_color`, etc. Adding a movie strip is
  `sequences.new_movie(...)` [32][33][34]. **Gotcha:** the **operator** form
  `bpy.ops.sequencer.effect_strip_add(...)` needs a **context override** (area/region) to run from a
  script — prefer the **data API** `sequences.new_effect(...)` [32][35].
- **Licence.** **GPL** (source default GPLv2+; distributed binaries GPLv3) [36]. Cycles is Apache-2.0,
  but Blender as a whole is GPL [36].
- **Scriptability.** Good (`bpy`) but requires a **full Blender install** and correct context
  handling; text-strip layout is clunky (multi-line via `\n` historically buggy) [33].
- **Text quality / motion.** VSE text strips are basic; richer titles require Blender's 3D Font
  objects / compositor / geometry nodes. Very powerful, **high learning curve**.
- **Best role here:** **not recommended** — overkill; keep as a "generated 3D graphics" niche only.

### 1.7 Comparison table

| Tool | Licence | Learning curve | Text quality | Motion / graphics | Scriptable from Node/TS | In this repo |
|---|---|---|---|---|---|---|
| **Remotion** | Custom (free ≤3 people; $25/seat/mo or $0.01/render) [4][5] | **Low** (React/TS) | **Best** (browser typography) | **Best** (spring/interpolate/transitions) | **Yes** — SSR API + Player | **Yes** (external server) |
| **FFmpeg** (`drawtext`/`ass`/`overlay`) | LGPL, **GPL** for this build [12][17] | Medium | Fair (`drawtext`) / Strong (ASS via libass) | Weak (fade/xfade/overlay only) | **Yes** — CLI `spawn()` | **Yes** (`ffmpeg-static`) |
| **MoviePy** | MIT [18] | Low (Python) | Good (Pillow; manual layout) | Basic; slow | No (Python sidecar) | No |
| **Motion Canvas** | MIT [22][25] | Medium (own API) | Strong (HTML/SVG) | Excellent (explainers) | Partial (weaker SSR) | No |
| **OBS + obs-websocket** | GPL-2.0+ [30][31] | Medium | Rich (Text/Browser sources) | Live switching/transitions | Yes (WS JSON) | No |
| **Blender VSE** | GPL [36] | **High** | Basic (VSE text) | Very powerful (3D) | Yes (bpy, heavy) | No |

---

## 2. Doing it WELL — typography, animation, VSL sequencing

### 2.1 Typography & layout rules for video

- **Safe areas.** Keep text inside the **title-safe area**. Modern HD practice = **SMPTE 90%** of
  frame (5% margin each side); legacy broadcast = **80% title-safe / 90% action-safe** [37][38][39].
  Design once inside the tighter area and it survives cropping on TVs, projectors and phone UIs [39].
- **Vertical (9:16) safe zones** (TikTok/Reels/Shorts): keep captions **below ~220 px from top**,
  **above ~320 px from bottom**, **~120 px clear on the right** for the action rail; the "sweet
  spot" band is **~55–70% of frame height** [40].
- **Font choice.** System sans-serif, weight 400–700: **Arial/Helvetica** (Netflix's generic
  placeholder "proportional sans-serif"), **Roboto**, **Noto Sans** (mandatory for non-Latin script),
  **Inter**; broadcast uses **Tiresias Screenfont** [41][42]. The one test that matters: lowercase
  `l`, uppercase `I`, and digit `1` must look different (inter/noto/roboto pass) [41].
- **Contrast.** White `#FFFFFF` text on a black outline (≈2 px) or a 70–80 % opacity box. White-on-
  black gives ~21:1, comfortably above **WCAG AA 4.5:1** (normal) / **3:1** (large text) [41].
  Over busy footage: put text on a **panel**, or use a **soft shadow**, and **test over the
  brightest/busiest shot** — not the frame you designed on [37].
- **Size.** Think proportionally, not in absolute px: BBC online guidance ≈ **8% of active video
  height** for line height (≈86 px at 1080p); for mobile/social use **≥48 px**, **64 px+** for
  TikTok-style [40][41].
- **Dwell time.** A lower-third with a name+title wants **≥4 s**; the field rule is "**twice as long
  as it takes to read**", capped ~5–10 s [37][43]. If you must rush it, the text is too long [37].
- **Hierarchy.** One idea per card/screen. Left-justify lower-thirds; keep brand colours consistent;
  avoid clashing colours and crowded type [42][43].

### 2.2 Caption standards & readability thresholds

- **Formats / standards.** Broadcast/streaming subtitles are moving on **EBU-TT-D** (EBU Tech 3380,
  XML/TTML-based, percentage layout, UTF-8, `tts:origin`/`tts:extent` regions) and the W3C
  **IMSC** profiles (IMSC 1.0/1.1/1.2/1.3 — a syntactic superset of EBU-TT-D) [44][45][46]. For a
  local pipeline you'll almost always produce **SRT** or **ASS**, which map cleanly (ASS supports
  real styling + karaoke; SRT does not) [14][15][47].
- **Line length.** **42 characters/line** max is the common ceiling (Netflix/Amazon/Apple/TED);
  **BBC/EBU-ESIST** run tighter at **37** [41][48][49]. Max **2 lines** per cue (3 for 9:16
  vertical) [41][48].
- **Reading speed.** **17–20 chars/sec** (Netflix adult 20, children 17; Amazon 17) ≈ BBC
  **160–180 wpm** [41][48][49].
- **Timing.** Min on-screen **~0.83 s** (Netflix 20 frames @24fps) / BBC ~0.3 s per word; max
  **7 s**; leave **≥2 frames** (BBC 1–1.5 s) between cues [41][48][49].
- **Line-breaking.** Break at **phrase boundaries** (after punctuation, before conjunctions/
  prepositions); never split article↔noun, adjective↔noun, verb↔object — this is the rule automated
  wrappers most often get wrong [41][42].

### 2.3 Animation patterns

**(a) Lower-thirds.** Slide-in from the left edge or slide-up + fade; short (~0.3–0.5 s) strong
**ease-out**; hold (≥4 s); fade/slide out. Put the panel in first, then the text. In Remotion this
maps directly to `interpolate()` with a Bézier ease `Easing.bezier(0.16, 1, 0.3, 1)` for a crisp
UI-style entrance, and `spring()` when you want a little overshoot [10][11].

**(b) Full-frame text cards / kinetic text.** Fade + slight scale-up ("pop"), word-by-word reveal,
or **karaoke highlight** (active word in accent colour as it is spoken) [50][51]. Word-by-word
captions create a micro-motion event every **200–400 ms**, which is exactly the cadence short-form
feeds train viewers to expect [50]. Keep the pop subtle (`spring`) — overdone bounce reads amateur.

**(c) Transitions between cards.** `@remotion/transitions`' `<TransitionSeries>` with `slide()`,
`fade()` and `linearTiming({ durationInFrames, easing })` — a transition shortens total duration
because both scenes render during it [11].

**Remotion primitives used above** (all documented): animate only from `useCurrentFrame()` (CSS
transitions **flicker** during render), `interpolate(frame, [in], [out], { easing, extrapolateRight: 'clamp' })`,
`spring({fps, frame})`, and `<Sequence from/durationInFrames>` for time-shifting [10][52].

### 2.4 How a VSL / presentation sequences text with narration

A VSL is a **direct-response sales letter on video**: the copywriter controls the pace, the viewer
can't skip to the price, and the **on-screen text is synchronised to the spoken narration** [53][54].
Structural consensus:

- **Shape:** Hook (first ~30 s, lose the wrong people / stop the scroll) → Problem agitation →
  Mechanism ("the new way") → Proof (screenshots/testimonials on screen *under the claim*) →
  Offer stack → Close [53][54][55]. Length: ~**12–24 min** sweet spot at the classic end, 15–45 min
  for cold traffic; warm leads get a shorter cut of the same script [53][54][55].
- **Text-over-narration rules the pros use:** one claim per card; **on-screen text appears as it is
  spoken** (captions styled to the brand, kept clear of the face); **proof on screen under the claim
  with its timestamp**; the **ask appears on screen when it is spoken**; **light motion graphics
  only where they support the point**; if there's nothing to show, a **cut every few seconds**
  (kinetic text breaks a long VO but costs more edit time per minute) [55].
- **Implementation:** model each script beat as `{ startMs, endMs, onScreenText, emphasisWords }`,
  drive the composition from that array. The same array produces (a) full-frame text cards, (b)
  word-by-word captions, and (c) an `.srt`/`.ass` export — one source of truth for the whole VSL.

---

## 3. Text baked into the image vs composited on top

**The problem is real and remains unsolved for most generative models.** Diffusion models routinely
render text that is **"jumbled, misspelled, or visually fragmented"** [56] and produce
**"unreadable, gibberish"** glyphs [57]. Three verified root causes:

1. **Locality bias / long-range incoherence** — iterative local sampling can't hold global structure
   across a word, so long strings degrade or are dropped entirely (a model asked for a document
   returns an illustration of the topic instead) — STRICT benchmark [56].
2. **Tokenisation destroys orthography** — CLIP-style subword encoders encode *meaning*, not the
   letter sequence `O-P-E-N`; the model "never sees" the ordered characters [57].
3. **Attention diffusion / character fusion** — cross-attention regions for adjacent letters overlap
   and bleed, merging glyphs into blobs [57].

Even 2026's best systems (GPT-4o/Gemini 2.0 image gen, Recraft V3, SeedDream 3.0) only *improve*
accuracy; "most open-source diffusion models still struggle with long-range coherence and instruction
fidelity" [56]. Research fix-frameworks (TextPixs/GCDA, ARTIST, AnyText) exist but are specialised
research pipelines, not something you bolt onto a ComfyUI workflow [57][58].

### The trade-off

| | **Baked into the image** | **Composited overlay** |
|---|---|---|
| Spelling correctness | Unreliable — garbled/misspelled | **Deterministic / correct** |
| Editability | None (part of pixels) | Full — restyle/re-time/re-edit, no re-generation |
| Font/brand fidelity | None (whatever the model invents) | **Exact brand font** |
| Cost to change one word | Re-generate (seconds–minutes, non-deterministic) | Re-render text layer only |
| Localisation | Must re-generate per language | Swap a string |
| When it *is* right | Only for **diegetic** text that must live in the scene's perspective (a sign in the background), and even then overlay a clean version on top | — |

### Why overlay is normally the correct answer

**Generate the plate with text explicitly excluded** (`no text, no letters, no signage` in the
negative prompt), then **composite the text as a separate layer**. This makes text (a) guaranteed
legible, (b) brand-exact, (c) instantly editable/localisable, and (d) independent of the model's
non-determinism — you can re-roll the video without touching the words. Overlay also lets the *same*
text layer serve the Remotion render **and** the FFmpeg burn (one source of truth).

Practical patterns for the overlay itself:
- **Pre-rendered alpha PNG/WebM** text cards (`html-to-image`, or a Remotion `renderStill()`),
  composited with FFmpeg `overlay` — bypasses `drawtext`'s weak layout entirely.
- **libass** (`subtitles`/`ass`) for captions — real styling, positioning and karaoke.
- **`drawtext`** only for simple, short, single-font labels (lower-third names, timestamps).

---

## 4. Captions & subtitles from a voiceover

### 4.1 Whisper-based alignment (word-level)

Segment-level Whisper timestamps **drift by hundreds of ms**; word-level needs alignment [59][60].

| Tool | Licence | Word timing method | Notes |
|---|---|---|---|
| `@remotion/install-whisper-cpp` | Remotion licence | whisper.cpp, `tokenLevelTimestamps: true` | Fully local, no API, `toCaptions()` → `@remotion/captions`. Turnkey for this stack [50][51] |
| `faster-whisper` (CTranslate2) | **MIT** [61] | `word_timestamps=True` (cross-attention + DTW) | Up to 4× faster, int8 CPU, VAD [61][62] |
| **WhisperX** | open-source *(verify on repo)* | wav2vec2 **forced phoneme alignment** → **<100 ms** | Best karaoke accuracy; heavy deps (torch/pyannote) [59][60] |
| `openai-whisper` | MIT | segment only | Baseline |

**WhisperX** is the accuracy king (sub-100 ms) but the README notes alignment **drops numeric tokens/
symbols** (prices, years) and the dependency chain (CUDA/pyannote/torchaudio) is heavy [59][60].
**faster-whisper** is the pragmatic CPU default [61][62]. For a local-first Node app,
`@remotion/install-whisper-cpp` is the least-friction option because it produces `Caption` objects
directly [50][51].

### 4.2 Generating SRT / ASS

- **SRT** = segment-level, numbered cues, no styling. **ASS** = full styling (fonts, colours,
  positioning) **and karaoke** via `{\k<centiseconds>}` tags (note: `\k` = duration in **1/100 s**);
  `\kf`/`\K` sweep-fill, `\ko` outline-only [47][63][64]. A word wrapped as `{\k50}word` = 0.5 s.
- **Convert** SRT→ASS with FFmpeg: `ffmpeg -i captions.srt captions.ass` (produces a
  `[V4+ Styles]` block you can edit), then burn with the `ass` filter [15][65].
- **Aegisub** is the classic tool for hand-authoring/auto-timing ASS and karaoke [47].
- **Remotion path:** `parseSrt()` **or** whisper JSON → `toCaptions()` → `createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds })` → pages with per-word `fromMs`/`toMs` →
  render each page in a `<Sequence>`, colour the token where `nowMs` is inside its window [50][51][66].
  *Remotion's `parseSrt` accepts SRT only — VTT/ASS/plain text are **not** supported; convert to SRT
  first* [66].

### 4.3 Rendering styled captions

- **Remotion** (primary): captions are React — no styling limits. Font size ≥48 px mobile / ≥64 px
  TikTok; white with dark shadow or accent-coloured highlight; keep clear of platform UI [40][50].
- **FFmpeg/`libass`** (fast path): burn with `subtitles=...:force_style='...'` or `ass=...`.
  `force_style` takes **ASS style fields** — `FontName, FontSize, PrimaryColour, OutlineColour,
  Outline, Shadow, Alignment, MarginV` — and **`force_style` colours are `&HAABBGGRR`
  (alpha-blue-green-red, *not* RGB)**; `MarginV` is in the 384×288 ASS reference frame; use
  `fontsdir` for bundled fonts and `original_size` to scale fonts for non-384×288 video [15][65].

---

## 5. Concrete recommendation for THIS stack

**Architecture: Remotion = compositor, FFmpeg = finisher, one shared "text layer" data model.**

Both engines already exist in this repo; they should share a single source of truth so the same
script drives an interactive preview, a server render, and a fast burn.

```
ComfyUI (plate, NO text)  ──┐
Voiceover ─► whisper.cpp ───┼─►  TextLayer[]  ─┬─► Remotion composition  ─► MP4  (rich graphics, VSL cards, captions)
                            │   {t, text,      │
                            │    kind, style}  └─► FFmpeg filter graph   ─► MP4  (fast: burn ASS + overlay PNGs + mux audio)
                            └─► (also exports .srt / .ass)
```

**Primary compositor — Remotion (build on the existing integration):**
- The existing `remotionService.createVideo({ composition, props, width, height, fps, audio })`
  already accepts `props` — pass the `TextLayer[]` + plate URL + audio as `inputProps`. Add a
  **`VSL` / `TextOverlay` composition** to the Remotion render server (the code below).
- Use `@remotion/player` (Next.js `'use client'`) for **in-dashboard live preview** — the exact
  same component that renders, so WYSIWYG [8][9]. Remember: `acknowledgeRemotionLicense` prop [9].
- Captions via `@remotion/captions` + `@remotion/install-whisper-cpp`.
- **Licence check:** free if the org is ≤3 people, else Company Licence [4][5].

**Fast finisher — FFmpeg (`ffmpeg-static`, already in-repo):**
- Spawn it from a Next route exactly like `api/duix/clone/route.ts` does.
- Use it for: burn ASS captions, overlay **pre-rendered text-card PNGs** (from `html-to-image` /
  Remotion `renderStill`), mux the VO, trim. Deterministic, no browser, fast.
- Reserve `drawtext` for simple single-font labels only.

**Do not** add MoviePy (Python sidecar; v2 churn), Blender VSE (GPL + heavy), or Motion Canvas (own
ecosystem) for this job. Keep **OBS + obs-websocket** in reserve for a future *live/streaming* mode.

### 5.1 Example — Remotion composition (the overlay + VSL card + captions)

Add to the Remotion render server. Text is composited over `<OffthreadVideo>`; nothing waits on the
model's glyphs.

```tsx
// remotion/VslOverlay.tsx  (runs in the Remotion render server, driven by this app's inputProps)
import {
  AbsoluteFill, OffthreadVideo, Sequence, staticFile,
  useCurrentFrame, useVideoConfig, interpolate, spring, Easing,
} from 'remotion';
import { createTikTokStyleCaptions, type Caption } from '@remotion/captions';

type TextLayer = {
  startMs: number; endMs: number;
  kind: 'card' | 'lowerThird';
  title?: string; body?: string;
  emphasis?: string[];          // words to keep highlighted
};

export const VslOverlay = ({ plate, audio, layers, captions }:
  { plate: string; audio: string; layers: TextLayer[]; captions: Caption[] }) => (
  <AbsoluteFill style={{ backgroundColor: 'black', fontFamily: 'Inter, Arial, sans-serif' }}>
    {/* 1. the AI-generated plate, no text baked in */}
    <OffthreadVideo src={staticFile(plate)} />
    <audio src={staticFile(audio)} />

    {/* 2. full-frame text cards + lower-thirds, timed from the script beats */}
    {layers.map((l, i) => (
      <Sequence key={i} from={ms2f(l.startMs)} durationInFrames={ms2f(l.endMs - l.startMs)}>
        {l.kind === 'card' ? <TextCard {...l} /> : <LowerThird title={l.title!} body={l.body} />}
      </Sequence>
    ))}

    {/* 3. karaoke captions from the voiceover */}
    <Captions captions={captions} />
  </AbsoluteFill>
);

const ms2f = (ms: number) => Math.round((ms / 1000) * 30); // pass real fps in production

const TextCard = ({ title, body }: TextLayer) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } }); // subtle, no bounce
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <div style={{ opacity, transform: `scale(${0.96 + 0.04 * enter})`, padding: '0 6%' }}>
        <h1 style={{ fontSize: 96, fontWeight: 800, color: '#FFFFFF',
                     textShadow: '0 6px 24px rgba(0,0,0,0.65)' }}>{title}</h1>
        {body && <p style={{ fontSize: 44, color: '#E2E8F0' }}>{body}</p>}
      </div>
    </AbsoluteFill>
  );
};

const LowerThird = ({ title, body }: { title: string; body?: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // 0.3–0.5s slide-up + fade, then hold (title-safe 90% => left/right 5% margin)
  const p = interpolate(frame, [0, 15], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1), extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', padding: '0 5% 8% 5%' }}>
      <div style={{ opacity: p, transform: `translateY(${(1 - p) * 40}px)`,
                    background: 'rgba(15,23,42,0.80)', padding: '20px 28px',
                    borderLeft: '6px solid #60A5FA', borderRadius: 8 }}>
        <div style={{ fontSize: 52, fontWeight: 700, color: '#FFFFFF' }}>{title}</div>
        {body && <div style={{ fontSize: 34, color: '#CBD5E1' }}>{body}</div>}
      </div>
    </AbsoluteFill>
  );
};

const Captions = ({ captions }: { captions: Caption[] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { pages } = createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: 800 });
  const nowMs = (frame / fps) * 1000;
  const page = pages.find(p => nowMs >= p.startMs && nowMs < p.startMs + p.durationMs);
  if (!page) return null;
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '15%' }}>
      <div style={{ fontSize: 64, fontWeight: 800, color: '#FFFFFF', textAlign: 'center',
                    textShadow: '2px 2px 10px rgba(0,0,0,0.85)', maxWidth: '80%' }}>
        {page.tokens.map((t) => (
          <span key={t.fromMs}
                style={{ color: nowMs >= t.fromMs && nowMs < t.toMs ? '#60A5FA' : '#FFFFFF' }}>
            {t.text}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};
```

> API notes: `createTikTokStyleCaptions` returns pages with `tokens` each carrying `fromMs`/`toMs`
> [50][51]. `OffthreadVideo`, `spring`, `interpolate`, `Easing`, `Sequence`, `staticFile` are all
> standard Remotion. `@remotion/player` renders this **same** component in-browser for preview [8][9].

### 5.2 Example — FFmpeg (the fast path, using this project's `ffmpeg-static`)

**(a) Burn styled captions + mux the voiceover** (`force_style` uses ASS fields, colours are
`&HAABBGGRR`) [15][65]:

```bash
ffmpeg -y -i plate.mp4 -i voice.wav -vf \
  "subtitles=captions.ass:fontsdir=./fonts:force_style='FontName=Inter,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,MarginV=40'" \
  -map 0:v -map 1:a -c:v libx264 -crf 20 -preset medium -c:a aac -b:a 192k -shortest out.mp4
```

`force_style` fields, `fontsdir`, `original_size`, `subtitles` and `-c:v libx264` are all verified
options on this binary and in the docs [15][65].

**(b) Overlay a pre-rendered text-card PNG** (with alpha) — bypasses `drawtext` layout limits,
composites a real graphics layer [14]:

```bash
ffmpeg -y -i plate.mp4 -i card_lowerthird.png -filter_complex \
  "[0:v][1:v]overlay=x=80:y=main_h-overlay_h-140:enable='between(t,3,9)'" \
  -c:v libx264 -crf 20 -preset medium -c:a copy out.mp4
```

`overlay` is `VV->V` on this binary; `enable='between(t,a,b)'` gates the overlay to a time window
(the same `enable` timeline option `drawtext` uses) [14].

**(c) Simple `drawtext` label** (short, single font — the one thing `drawtext` is genuinely good for):

```bash
ffmpeg -y -i plate.mp4 -vf \
  "drawtext=fontfile=./fonts/Inter-Bold.ttf:text='ACME CORP':fontcolor=white:fontsize=44:box=1:boxcolor=black@0.5:boxborderw=16:x=80:y=h-160:enable='between(t,2,8)'" \
  -c:a copy out.mp4
```

All `drawtext` options above were **verified against this project's `ffmpeg.exe`**
(`fontfile`, `text`, `fontcolor`, `fontsize`, `box`, `boxcolor`, `boxborderw`, `x`, `y`, `enable`).
Prefer **`fontfile=`** (explicit path) over `font=` (fontconfig name) on Windows, because
fontconfig font lookup is not guaranteed to resolve system fonts.

**(d) Node/TS wrapper** (same pattern as `api/duix/clone/route.ts`):

```ts
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';

export function burnCaptions(plate: string, voice: string, ass: string, out: string) {
  return new Promise<void>((resolve, reject) => {
    const ff = spawn(ffmpegStatic as string, [
      '-y', '-i', plate, '-i', voice,
      '-vf', `subtitles=${ass}:fontsdir=./fonts:force_style='FontSize=22,Outline=2'`,
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-crf', '20', '-preset', 'medium',
      '-c:a', 'aac', '-b:a', '192k', '-shortest', out,
    ]);
    let err = ''; ff.stderr.on('data', d => (err += d)); 
    ff.on('close', c => (c === 0 ? resolve() : reject(new Error(err.slice(-500)))));
    ff.on('error', reject);
  });
}
```

### 5.3 When to use which

| Need | Use |
|---|---|
| VSL cards, lower-thirds, rich motion, brand typography, WYSIWYG preview | **Remotion** (existing integration) |
| Word-by-word / karaoke captions with live preview | **Remotion + `@remotion/captions`** |
| Fast, deterministic burn of captions / simple overlay / audio mux / trim | **FFmpeg (`ffmpeg-static`)** |
| Rasterise an HTML/CSS design to an overlay plate | **`html-to-image`** (already installed) |
| Live streaming / real-time switching | **OBS + obs-websocket** (future "live" mode) |

---

## 6. Sources

1. Remotion — `renderMedia()` API — https://www.remotion.dev/docs/renderer/render-media
2. Remotion — SSR rendering (bundle → selectComposition → renderMedia) — https://cloudrun.remotion.dev/docs/ssr-node
3. Remotion — `npx remotion render` CLI — https://www.remotion.dev/docs/cli/render
4. Remotion — License & Pricing — https://www.remotion.dev/docs/license/pricing
5. Remotion — Terms and Conditions (v5.0) — https://www.remotion.dev/docs/terms
6. Remotion Pro — Licensing — https://www.remotion.pro/license
7. Remotion — License FAQ — https://www.remotion.dev/docs/license/faq
8. Remotion — `<Player>` — https://www.remotion.dev/docs/player/player
9. Remotion — Player integration (Next.js, `acknowledgeRemotionLicense`) — https://remotion.dev/docs/player/integration
10. Remotion — Animating properties (`interpolate`, `spring`) — https://www.remotion.dev/docs/animating-properties
11. Remotion — Transitions (`<TransitionSeries>`, `linearTiming`) — https://www.remotion.dev/docs/transitioning and https://www.remotion.dev/docs/transitions/timings/lineartiming
12. FFmpeg-user — *drawtext filter missing* (harfbuzz dependency) — https://ffmpeg.org/pipermail/ffmpeg-user/2023-November/057239.html
13. Remotion — Installing Chrome Headless Shell / `ensureBrowser()` — https://www.remotion.dev/docs/miscellaneous/chrome-headless-shell and https://www.remotion.dev/docs/renderer/ensure-browser
14. FFmpeg — Filters documentation (`drawtext`, `overlay`, `ass`, `subtitles`) — https://ffmpeg.org/ffmpeg-filters.html
15. FFmpegLab — Add text & subtitles (drawtext, burn SRT/ASS, soft subs) — https://github.com/ffmpeglab/ffmpeglab.com/blob/main/articles/ffmpeg-add-text-subtitles-video.html
16. FFmpeg — `vf_subtitles.c` (libass burn-in) — https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/vf_subtitles.c
17. ffmpeg-static (npm) — bundled FFmpeg version / build sources — https://www.npmjs.com/package/ffmpeg-static
18. MoviePy — PyPI (v2 API, MIT) — https://pypi.org/project/moviepy/
19. MoviePy — Updating to v2 (breaking changes, TextClip font path) — https://github.com/Zulko/moviepy/blob/master/docs/getting_started/updating_to_v2.rst
20. MoviePy — CHANGELOG (TextClip/Pillow changes) — https://github.com/Zulko/moviepy/blob/master/CHANGELOG.md
21. MoviePy — README — https://github.com/Zulko/moviepy/blob/master/README.md
22. Motion Canvas — GitHub (MIT, TypeScript generators) — https://github.com/motion-canvas/motion-canvas
23. Motion Canvas — site — https://motioncanvas.io/ and https://motioncanvas.io/docs/quickstart
24. x-cmd — Motion Canvas overview (v3.17.x, MIT, ecosystem) — https://www.x-cmd.com/install/motion-canvas/
25. (see 24)
26. Motion Canvas discussion #1015 — *Switching to the GNU GPL* — https://github.com/orgs/motion-canvas/discussions/1015
27. OBS — obs-websocket v5 control (bundled in OBS 28+, port 4455) — https://github.com/aaronckj/obs-studio-mcp
28. obs-websocket v5 protocol — handshake/auth, Requests, RequestBatch — https://claudepluginhub.com/skills/damionrashford-media-os/obs-websocket
29. OBS WebSocket control via Python (`obsws-python`) — https://docs.moondogdevelopment.com/programming/python/modules/obs-websocket-control
30. OBS Project — obs-studio (GPL-2.0) — https://github.com/obsproject/obs-studio
31. obs-websocket / OBS licence note (GPL v2) — https://obsframe.com/license
32. Blender SE — Adding a text strip to VSE using Python (data API vs operator) — https://blender.stackexchange.com/questions/338379/
33. Blender SE — Text on a new line in VSE (Python) — https://blender.stackexchange.com/questions/141262/
34. Ojambo — Generate Blender VSE text strip using Python — https://www.ojambo.com/generate-blender-vse-text-strip-using-python-script
35. Blender SE — Add a text strip in VSE (context override) — https://blender.stackexchange.com/questions/262615/
36. Blender — License (GPL v2+/v3) — https://www.blender.org/about/license/
37. Launchframe — Lower-third design rules (title-safe 90%/80%, dwell time, test over bright footage) — https://launchframe.io/guides/lower-third-design-rules/
38. Wikipedia — Safe area (television) — https://en.wikipedia.org/wiki/Safe_area_(television)
39. Dartmouth — Title-Safe Areas — https://services.dartmouth.edu/TDClient/1806/Portal/KB/PrintArticle?ID=171286
40. RenderComp — TikTok-style captions in Remotion (safe zones, font sizes) — https://rendercomp.com/blog/tiktok-style-captions-remotion-whisper
41. ConvertAudioToText — Subtitle styling best practices (42 CPL, CPS, fonts, contrast, break rules) — https://convertaudiototext.com/blog/subtitle-styling-best-practices
42. Adobe — How to make a lower-third graphic — https://www.adobe.com/creativecloud/video/discover/lower-third-graphics.html
43. LibreTexts — Fixing titles and graphics (title-safe, sans-serif, duration, contrast) — https://human.libretexts.org/Courses/City_College_of_San_Francisco/Video_Production_Handbook_I/16%3A_The_Finishing_Process/16.03%3A_Fixing_Titles_and_Graphics
44. W3C — IMSC Text Profile 1.3 (superset of EBU-TT-D) — https://w3.org/TR/2026/REC-ttml-imsc1.3-20260521
45. Limecraft — EBU-TT-D (EBU Tech 3380) explained — https://support.limecraft.com/support/solutions/articles/48001278433-
46. W3C — TTML and derived caption formats (SMPTE-TT, EBU-TT) — https://w3.org/AudioVideo/TT/docs/TTML-Profiles.html
47. Aegisub — ASS Override Tags (karaoke `\k`, colour, positioning) — https://aegisub.org/docs/latest/ass_tags/
48. Meetwave — CPS and line-length limits (2026) — https://meetwave.io/blog/subtitle-reading-speed
49. VideoText — Subtitle CPL/CPS benchmarks by style guide (2026) — https://videotext.io/guides/subtitle-cpl-and-cps-benchmarks-by-style-guide-2026
50. RenderComp / DojoCodingLabs — Remotion captions workflow (`@remotion/captions`, `@remotion/install-whisper-cpp`, `createTikTokStyleCaptions`) — https://github.com/DojoCodingLabs/remotion-superpowers/blob/main/skills/remotion-production/rules/captions-workflow.md
51. SnapCN — TikTok-style captions in Remotion (Caption type, `toCaptions`, pages/tokens) — https://snapcn.dev/remotion-tiktok-captions
52. Remotion — `<Sequence>` — https://www.remotion.dev/docs/sequence
53. Rob Palmer — What Is a VSL (7 stages, pacing control) — https://robpalmer.com/blog/what-is-a-vsl
54. Vimerse — Video Sales Letter (structure, proof on screen, captions to brand, motion graphics) — https://vimerse.com/posts/video-sales-letter
55. Rob Palmer — VSL Copywriter (phases, production handoff, slide-by-slide notation) — https://robpalmer.com/services/vsl-copywriter
56. STRICT — *Stress Test of Rendering Images Containing Text* — https://arxiv.org/abs/2505.18985
57. TextPixs / GCDA — *Glyph-Conditioned Diffusion* (tokenisation, attention diffusion) — https://arxiv.org/abs/2507.06033
58. ARTIST (WACV 2025) — *Text-Rich Images with Disentangled Diffusion* — https://openaccess.thecvf.com/content/WACV2025/papers/Zhang_ARTIST_*.pdf
59. WhisperX — localAIMaster guide (forced alignment, <100 ms, limitations) — https://localaimaster.com/blog/whisperx-guide
60. WhisperX — m-bain/whisperX repo notes — https://github.com/m-bain/whisperX
61. faster-whisper — PyPI / Anaconda (MIT, word timestamps, VAD) — https://anaconda.org/main/faster-whisper
62. faster-whisper — `transcribe.py` (`word_timestamps`) — https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/transcribe.py
63. Subtitle Edit — ASSA override tags reference — https://github.com/SubtitleEdit/subtitleedit/blob/main/docs/reference/assa-override-tags.md
64. libass — ASSv5 override tags wiki — https://github.com/TheOneric/libass/wiki/ASSv5-Override-Tags
65. KinoPipe — FFmpeg burn subtitles (SRT hardcode, `force_style`, `&HAABBGGRR`, soft tracks) — https://kinopipe.com/ffmpeg/add-subtitles
66. CrePal — TikTok-style captions in Remotion (SRT-only `parseSrt`, VTT/ASS unsupported) — https://crepal.ai/blog/aivideo/blog-how-to-create-tiktok-style-captions-remotion/

**Locally verified this session** (not a web source): `node_modules/ffmpeg-static/ffmpeg.exe`
= `ffmpeg version 6.1.1-essentials_build-www.gyan.dev`; `-filters` confirms `ass`, `drawtext`,
`subtitles`, `overlay`, `drawbox`, `fade`, `xfade`; `-h filter=drawtext` and `-h filter=subtitles`
confirm the option lists quoted in §1.2 and §5.2.

---

## 7. Open questions / things to confirm before build

- **Remotion licence eligibility** — if the org exceeds 3 people, budget a Company Licence [4][5].
- **WhisperX licence** — verify on the repo before shipping (not confirmed this session).
- **Text-card rasterisation at scale** — validate `html-to-image` output resolution/alpha for
  overlay use (installed, but not exercised for video this session).
- **Remotion render server** — the in-repo integration is a **client**; the `VslOverlay` composition
  in §5.1 must be added to that server, and `@remotion/captions` + `@remotion/install-whisper-cpp`
  installed there.
