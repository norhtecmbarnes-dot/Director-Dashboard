# Images First, Then Animation — the Director Pipeline

*The plan you asked for: take a markdown written in a chat with a powerful LLM, generate the
**images**, curate them, then **animate** the scenes — with avatars and on-screen text — and fix
the image-quality problems (three-legged chickens, three-armed dragons, garbled text).*

**Status:** research complete and assembled. Nothing implemented yet — this is the plan to approve.
**Evidence:** five sourced research reports under `docs/research/`, ~2,350 lines, plus a verified
inventory of this machine. Sources are cited per claim in those reports.

---

## 1. Where the Director is today (verified by reading the code and the disk)

Your pipeline is a **single text→video hop**:

```
plain-English brief
   → the Auteur (Ollama) writes a structured script
       (SCENE HEADING / NARRATIVE CONTEXT / ### SHOT n with MINIMAX PROMPT + SOUND DESIGN + DIALOGUE)
   → src/lib/director/auteur.ts parses it into shots
   → src/lib/comfyui/minimax-graph.ts builds a ComfyUI graph
   → ComfyUI renders video with audio
```

And this is what is actually installed at `C:\ComfyUI\ComfyUI`:

| Location | Contents |
|---|---|
| `models/diffusion_models` | `minimax_h3_fl2va_pruned_fp8_scaled.safetensors` (19.5 GB) |
| `models/text_encoders` | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` (14.6 GB) |
| `models/vae` | `minimax_h3_video_vae_fp16` + `minimax_h3_audio_vae_fp32` |
| `models/checkpoints` | **empty** |
| `models/loras` | **empty** |
| `models/controlnet` | **empty** |
| `models/upscale_models` | **empty** |
| `custom_nodes` | only `ComfyUI-Mickmumpitz-Nodes` |

**Two conclusions fall straight out of that.**

1. **The animate half already exists.** `fl2va` = *first-last-frame-to-video **with audio***. It
   supports image-to-video natively, and `minimax-graph.ts` **already accepts `firstFrameFile` and
   `lastFrameFile`**. The animate step needs no architectural change.
2. **The still half does not exist.** H3 *animates* images; it does not *generate* them. There is no
   image checkpoint of any kind installed, so the app literally cannot make a still to animate.
   That — not the prompt — is why it is a text→video hop.

There is also a code-level bug worth fixing: `models/loras` is empty, so the turbo LoRA the graph
references is **not downloaded**, and the graph applies it at strength `1.0` where the LoRA author
recommends **~0.75**.

---

## 2. The core decision: split the pipeline in two

Your instinct is right, and the reason is worth stating precisely: **generating a still and
animating a still are different problems with different failure modes.** Text-to-video asks one
model to invent anatomy, composition and motion at once, with no chance to intervene. Splitting
lets you:

- get anatomy and text right **where the tools for that live** (image models + repair passes),
- **look at it** before spending minutes of GPU time on motion,
- keep the video model's job to *moving pixels that are already correct*.

```
MARKDOWN (from a chat with a powerful LLM)
        │
        ▼
STILL PASS ── image model + repair passes ──► one image per shot
        │
        ▼
CURATION GATE ── you look at it; re-roll, edit or accept
        │
        ▼
ANIMATE PASS ── image-to-video, chained for continuity ──► scenes
        │
        ▼
OVERLAY PASS ── text, captions, graphics composited on top ──► final video
```

The markdown is the contract. It should carry, per shot: the visual prompt, the negative prompt,
sound design, dialogue/narration, and (later) an approved still path. That maps onto your existing
`AuteurShot` shape almost exactly — it needs a stable `shot id` and a `stillImagePath`, nothing more.

---

## 3. Stage 1 — the still pass

### 3.1 Which image model

| Tier | Pick | Licence | Notes |
|---|---|---|---|
| **Text in the image** | **Qwen-Image 1.0** | Apache-2.0 | The open-weight text-rendering leader. fp8 ~20 GB, GGUF Q4 ~12 GB. |
| **Anatomy / photoreal** | **FLUX.2 [klein] 4B** or **Z-Image-Turbo** | Apache-2.0 | The commercial-safe quality picks. `[klein]` ~8–13 GB; Z-Image-Turbo 16 GB, 8 steps. |
| **Character work** | **FLUX.1-dev** (fp8) | non-commercial | The choice that **matters here** — PuLID-Flux, Kontext and Redux all target it. |
| **8–12 GB cards** | SDXL family, or FLUX.1-dev GGUF Q4 | OpenRAIL++-M | Not text specialists — composite text instead. |

**Recommendation: FLUX.1-dev fp8 as the base for character work**, because you need cross-shot
character consistency and the entire identity-adapter ecosystem targets FLUX. Pair with
**PuLID-Flux** for identity. *(Licence caveat: FLUX.1-dev weights are non-commercial. For
commercial-safe work, use FLUX.2 [klein] 4B or Qwen-Image 1.0 — but then verify the identity-adapter
support for those before committing.)*

### 3.2 The anatomy fix — this is not a prompt problem

Three-legged chickens and three-armed dragons will **not** be fixed by re-rolling or by adding
"two legs" to the prompt. The research is blunt about why: a detailer re-draws a region using text
guidance, and text cannot correct a wrong *count*. The fix is a **repair pass**:

1. **Impact Pack FaceDetailer** with **`hand_yolov8s.pt`**, **BBOX-only mode** (not segmentation),
   `denoise ~0.5`, `bbox_crop_factor ~2.5` — run at **low resolution, before upscaling**.
2. Escalate genuinely wrong geometry (five fingers that should be four) to **MeshGraphormer /
   HandRefiner** depth-ControlNet inpainting.
3. Negative embeddings that are verified to exist: `BadHands`, `badhandv4`, `verybadimagenegative`.

Two settings that quietly cause extra limbs and are worth fixing permanently:
**over-high CFG**, and **off-bucket resolutions**. Stay inside the model's trained resolution
buckets, and match CFG to the family (**1.0 for distilled FLUX/FLUX.2/Qwen/Z-Image; 7–8 for SDXL**).

### 3.3 The text fix — stop generating text

Garbled text has four stacked causes: the CLIP token ceiling, diffusion's locality bias, the **8×
VAE compression floor** (small glyphs are high-frequency detail that does not survive compression),
and simply too few pixels.

**The correct answer, unconditionally: generate the plate text-free, and composite text on top.**
You are already set up for that — see §7. If text genuinely must be *in* the image (a shop sign, a
book cover), use **Qwen-Image 1.0** and give it real pixels. Diagnose a text failure by
**encode→decode round-trip first**: if the VAE is eating it, no sampler setting will save you.

---

## 4. The curation gate

A real pause between the two passes, in the UI: show the still per shot with **Accept / Re-roll /
Edit**, and only then queue the animate pass. This is the whole point of splitting the pipeline —
it is where your judgement enters, cheaply, before GPU minutes get spent.

---

## 5. Stage 2 — the animate pass

### 5.1 Your existing MiniMax H3 — and the licence problem

H3 is real, verified, and capable: a 33B omni-modal model that generates video **and stereo audio in
one pass**. All four model files your code references exist in `Comfy-Org/MiniMax-H3`.

**But read this before building on it.** The **MiniMax H3 Community Licence excludes the US, EU, UK
and South Korea for local use.** Free for non-commercial; commercial permitted only under $20M
revenue; **local commercial use requires a paid licence** (sold through Comfy). For a US
government-contracting business, that is a licensing decision, not a footnote — and it applies to
the model you already have installed.

Also, from the LoRA research: apply the turbo LoRA at **~0.75, not 1.0**; and **FL2VA and Ref2VA
LoRAs are not interchangeable** — your graph treats the LoRA name generically, which will bite.

### 5.2 The open default: WAN 2.2 I2V

For a licence-clean animate pass, **WAN 2.2 I2V (A14B)** is the 2026 default — Apache-2.0, best
photoreal humans and physics, the richest LoRA ecosystem, native ComfyUI templates, and it lives in
the same Wan family your `local-avatar-graph.ts` already drives.

- `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` + `_low_noise_` variant (two experts)
- `umt5_xxl_fp8_e4m3fn_scaled.safetensors` text encoder · `wan_2.1_vae.safetensors` (**2.1** VAE)
- **Lightx2v/Lightning I2V LoRA** → cuts to ~6 steps, which is what makes 8 GB viable

**Recommendation: build the animate pass on WAN 2.2 I2V** for licence clarity and ecosystem, and
keep MiniMax H3 for the shots where you specifically want its **native synced audio** — or if you
resolve the licence.

---

## 6. Consistency across shots — the hard part

Locking a character's face across many shots is what separates a demo from a film. In 2026:

| Tool | Verdict |
|---|---|
| **PuLID** (Flux) | **The default.** Only mature Flux identity adapter; best identity-vs-style balance. |
| **IP-Adapter FaceID Plus V2** | Most mature and forgiving — keep installed as the fallback. |
| **InstantID** | Highest raw similarity, but **SDXL-only and pose-locked**. |
| **Face LoRA** (trained) | The strongest result once you have a character worth locking. |

And the single most powerful continuity tool, which costs nothing extra: **first/last-frame
chaining**. In WAN 2.2 there is **no separate FLF checkpoint** — use the core
**`WanFirstLastFrameToVideo`** node: the final frame of shot N becomes the supplied end image that
seeds shot N+1. Faces and lighting then carry across cuts.

---

## 7. Stage 3 — text and graphics on screen

You asked for something "VSL-like" — text on screen. **You already have the pieces**, and this is
the one area needing no new install:

- **Remotion** — already integrated at `src/lib/integrations/remotion.ts` + `/api/remotion`. Text,
  lower-thirds, cards and captions are just React components over the video plate. *(Note: it is a
  REST client to an external Remotion render server on `:3001`, not in-process.)*
- **FFmpeg** — your bundled `ffmpeg-static` is **6.1.1 with `drawtext`, `subtitles`, `ass` and
  `libass` verified present on this machine**. No extra install. Proven already in
  `src/app/api/duix/clone/route.ts`.
- **Captions**: transcribe locally (`@remotion/install-whisper-cpp` or faster-whisper) → word
  timings → Remotion captions, or an `.srt`/`.ass` burned by FFmpeg.

Doing it properly: title-safe area **90%** (legacy 80%), 9:16 safe zones, sans-serif, **4.5:1**
contrast, **~42 characters per line** and **17–20 characters per second** for readability.

---

## 8. Avatars — replacing the closed piece

Your `avatar-graph.ts` uses **`HeyGenTalkingPhotoNode`** — a commercial cloud service, and **the
only closed component left**. Meanwhile `local-avatar-graph.ts` is already fully open
(Qwen-Image → `WanInfiniteTalkToVideo`).

| Goal | Pick | Licence | Why |
|---|---|---|---|
| **Photo + audio → talking head** (first integration) | **EchoMimic V3** | Apache-2.0 | Native image+audio→video, 1.3B, **12 GB VRAM**, mature ComfyUI node — drops into the existing graph pattern. |
| **High-quality character performance** | **Wan2.2-S2V-14B** | Apache-2.0 | Native ComfyUI, cinematic full-body. 24 GB+, slow. |
| **Fast re-lipsync pass** | **MuseTalk 1.5** | MIT | Real-time, ~4 GB. Video-driven refinement. |

**Avoid**: Wav2Lip (non-commercial, LRS2) and Sonic (CC-BY-NC-SA). **Caveat**: LivePortrait's code is
MIT but its InsightFace/X-Pose detection models are non-commercial — swap to MediaPipe if you ship.

---

## 9. Install shopping list (for THIS machine)

Because `checkpoints`, `loras`, `controlnet` and `upscale_models` are empty, this is the gap to close:

**Still pass** — `flux1-dev-fp8.safetensors` → `diffusion_models/`; `t5xxl_fp8_e4m3fn` + `clip_l` →
`text_encoders/`; `ae.safetensors` → `vae/`; **PuLID-Flux** (+ `EVA02_CLIP_L_336`, InsightFace CUDA).

**Animate pass** — `wan2.2_i2v_high_noise_14B_fp8_scaled` + `wan2.2_i2v_low_noise_14B_fp8_scaled` →
`diffusion_models/`; `umt5_xxl_fp8_e4m3fn_scaled` → `text_encoders/`; `wan_2.1_vae` → `vae/`;
Lightx2v I2V LoRA → `loras/`.

**Post** — `4x_foolhardy_Remacri` and/or `4x-ClearRealityV1` → `upscale_models/`;
`rife_v4.26.safetensors` → `frame_interpolation/`; optional SeedVR2 3B fp8.

**Custom nodes** — ComfyUI-GGUF · VideoHelperSuite · KJNodes · PuLID/PuLID-Flux ·
`ComfyUI_IPAdapter_plus` · Impact Pack (FaceDetailer) · optional Frame-Interpolation, GIMM-VFI,
SeedVR2.

**Also fix**: download the MiniMax turbo LoRA (it's missing) and change its strength `1.0 → 0.75`.

---

## 10. Phased roadmap

**Phase 0 — correctness (hours).** Fix the LoRA strength; install the turbo LoRA; verify the graph
against the installed ComfyUI version (there's a node-name mismatch to check:
code's `MiniMaxH3SigmaShift` vs docs' `ModelSamplingMiniMaxH3`).

**Phase 1 — the missing half (days).** Install an image model. Add a **still graph** builder
alongside `minimax-graph.ts`. Extend `AuteurShot` with `shotId` + `stillImagePath`. Build the
pipeline as **two separate API-format graphs** split by the human gate: submit still graph → poll
`/ws` → fetch via `/history` + `/view` → **you approve** → upload the still to `/upload/image` →
submit the video graph with it as `first_frame`.

**Phase 2 — quality (days).** Add the FaceDetailer + `hand_yolov8s` repair pass to the still graph.
Add the upscale→interpolate post chain. This is the phase that kills the three-legged chicken.

**Phase 3 — continuity (week).** PuLID-Flux for identity; `WanFirstLastFrameToVideo` chaining so
shot N's last frame seeds shot N+1.

**Phase 4 — the avatars and the overlay.** Swap EchoMimic V3 in for the HeyGen node. Add the
Remotion/FFmpeg overlay pass for titles and captions.

**Phase 5 — the licence decision.** Decide MiniMax H3's fate (keep for audio, buy a licence, or
move the animate pass to WAN 2.2). Do this deliberately, not by accident.

---

## 11. Evidence and honesty

The five reports are at `docs/research/` and every substantive claim above traces to a cited source in
one of them:

| Report | Lines |
|---|---|
| `01-image-models-and-render-quality.md` | 458 |
| `02-minimax-models-and-loras.md` | 196 |
| `03-comfyui-image-to-video-workflows.md` | 660 |
| `04-open-source-avatars.md` | 374 |
| `05-text-on-screen-and-overlay.md` | 666 |

**Explicitly unverified — do not treat as fact:**

- Qwen-Image 2.0 / 2512 / "2.1" **licences** — the official repo confirms they exist, but the
  licences could not be confirmed on a primary source. Community sources claim they moved away from
  Apache-2.0. **Verify the model card before commercial use.**
- Specific **hand-fix LoRA filenames** beyond the verified tooling (FaceDetailer + `hand_yolov8s.pt`,
  MeshGraphormer/HandRefiner, BadHands/badhandv4/verybadimagenegative).
- Exact `POST /upload/image` path string, LTX-2.3-vs-2.5 naming, and some node-pack compatibility.
- All **VRAM figures** are community-measured ranges, cited per source — they vary with quantisation
  and build.
- **Wan2.2-S2V / Animate licences** conflict between sources (Apache base vs OpenRAIL claim) —
  verify before shipping commercially.
