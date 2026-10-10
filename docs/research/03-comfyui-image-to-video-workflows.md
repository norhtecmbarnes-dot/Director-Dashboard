# 03 — ComfyUI Image-to-Video Workflows for a "Script → Stills → Curate → Animate" Pipeline

**Research report for the Director Dashboard (Next.js/TypeScript, `C:\ai\proposal genie\Director-Dashboard`)**
**Date:** October 2026 · **Status:** local-first, ComfyUI-driven

---

## 0. Scope and how to read this

The Director Dashboard today goes **prompt → video in one hop**: the Auteur persona writes a
structured script (`src/lib/director/auteur.ts`) and `src/lib/comfyui/minimax-graph.ts` turns each
`### SHOT n` block into a ComfyUI graph that renders directly to video with MiniMax H3.

The target pipeline is **keyframe-first**:

```
LLM markdown plan  →  generate ONE still per shot  →  HUMAN APPROVES the still  →  animate it (I2V)  →  post (upscale + interpolate)
                                                                                ↳ characters stay consistent across shots
```

This report answers five questions:

1. Canonical I2V workflows in ComfyUI in 2025–2026 (which base models people actually animate stills with).
2. **Consistency across shots** (IPAdapter, InstantID, PuLID, Redux, Kontext, reference-only, character LoRAs, seeding, first/last-frame chaining).
3. The **keyframe-first pipeline architecture** + how the **ComfyUI HTTP API** is driven programmatically.
4. Practical **building blocks**: upscalers, frame interpolation, detailers, post passes.
5. **Published workflow templates worth copying** (with links).

> **Citation discipline:** every node name, filename and workflow name below is either quoted from a
> primary source (ComfyUI docs, Hugging Face model card, GitHub repo) or explicitly flagged as
> "unverified". Where a claim could not be confirmed against a primary source it is marked
> **[UNVERIFIED]**.

---

## 0.1 Verified local state (this machine)

Confirmed on this box before writing:

- ComfyUI installed at `C:\ComfyUI\ComfyUI`.
- `models/diffusion_models/minimax_h3_fl2va_pruned_fp8_scaled.safetensors` (~19.5 GB) — a
  **first-last-frame / video-to-audio** MiniMax H3 variant (existing one-hop renderer).
- A video VAE **and** a separate audio VAE for MiniMax H3.
- `models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` — the MiniMax H3 text encoder.
- **Nothing else.** `models/checkpoints`, `models/loras`, `models/controlnet`, `models/upscale_models`
  are all **EMPTY**.

**Consequence:** to do image generation *and* I2V at all, this box must install a full new model
stack (image model + image VAE/text-encoder + a dedicated I2V video model + its VAE/text-encoder,
plus upscale + interpolation support models). Section 6 is the install shopping list.

Minimax H3 is **not** an image-to-video model in the WAN/LTX/Hunyuan sense — it is a
first-last-frame-to-video+audio model. It can animate *between two approved stills* (which is
actually useful for the keyframe-first plan — see §3.4), but it is not the general "animate one
still" driver. The general driver should be **WAN 2.2 14B I2V** or **LTX-Video**.

---

## 1. Canonical I2V workflows in ComfyUI (2025–2026)

### 1.1 The short answer

For animating a **curated still** with a real reference image and motion control, the 2025–2026
working consensus is:

| Rank | Model | Why |
|---|---|---|
| **1 (default)** | **WAN 2.2 I2V-A14B** (fp8/GGUF + Lightx2v LoRA) | Best photorealistic humans, best physics, biggest LoRA ecosystem, native ComfyUI templates. The de-facto standard in 2026. |
| **2 (speed / audio)** | **LTX-Video (LTX-2.x)** | Fastest, lowest VRAM floor (8 GB GGUF), native synchronized audio. Trails WAN on quality/prompt adherence. |
| **3** | **HunyuanVideo (1.5) I2V** | Solid on 24 GB consumer GPUs, 5–10 s clips, but no longer leads any category. |
| **Legacy** | **WAN 2.1 I2V, CogVideoX I2V, SVD (Stable Video Diffusion)** | Older; SVD is largely superseded for new work. |
| **Newer** | **LongCat, OVI 11B** | Emerging alternatives; LongCat claims longer/unlimited duration, OVI ~10 s with audio — **[quality not independently verified here]**. |

> Note the model-name churn: sources written at different times in 2025–2026 call Lightricks'
> model **LTX-Video** (2B), then **LTX-2 / LTX-2.3**, then **LTX-2.5**. ComfyUI's native templates
> as of the most recent source ship **LTX-2.5** workflows. Treat "LTX-Video" as the family
> name and pin the exact build in your install.

---

### 1.2 WAN 2.2 — the one to build around

**Architecture (primary source: ComfyUI official Wan 2.2 tutorial, `docs.comfy.org/tutorials/video/wan/wan2_2`):**
Wan 2.2 is a **MoE (Mixture of Experts)** model with a **high-noise expert** and a **low-noise
expert**. ComfyUI loads them **sequentially**, dividing denoising timesteps between them, which
keeps peak VRAM lower than loading one giant model. Three family variants:

| Variant | Params | Function | HF repo (per ComfyUI docs) |
|---|---|---|---|
| **Wan2.2-TI2V-5B** | 5B | Unified text **and** image→video, single dense checkpoint | `Wan-AI/Wan2.2-TI2V-5B` |
| **Wan2.2-I2V-A14B** | 14B | Image→video (animate a still) | `Wan-AI/Wan2.2-I2V-A14B` |
| **Wan2.2-T2V-A14B** | 14B | Text→video | `Wan-AI/Wan2.2-T2V-A14B` |

**Files (verbatim from ComfyUI docs, 14B I2V):**

```
ComfyUI/
├── models/
│   ├── diffusion_models/
│   │   ├── wan2.2_i2v_low_noise_14B_fp16.safetensors
│   │   └── wan2.2_i2v_high_noise_14B_fp16.safetensors
│   ├── text_encoders/
│   │   └── umt5_xxl_fp8_e4m3fn_scaled.safetensors
│   └── vae/
│       └── wan_2.1_vae.safetensors
```

The **5B TI2V** variant uses instead: `wan2.2_ti2v_5B_fp16.safetensors` +
`umt5_xxl_fp8_e4m3fn_scaled.safetensors` + `wan2.2_vae.safetensors` (docs.comfy.org).

**VRAM (sourced, with quotes):**

- **Wan 2.2 5B TI2V:** ComfyUI docs: *"The Wan2.2 5B version should fit well on 8GB vram with the
  ComfyUI native offloading."* → **~8 GB floor** with native offloading.
- **Wan 2.2 14B I2V:** community reports **12 GB minimum with GGUF Q4**, **16–24 GB recommended**;
  comfortable at **24 GB** (RTX 4090) with fp8 and no offload.
- **Wan 2.1 T2V-1.3B:** Wan's own README: *"requires only 8.19 GB VRAM"* (legacy, not I2V).

**Speed:** A full 14B render at 20+ steps can take **40–50 minutes** for a 5-second clip at full
settings; with the distilled **Lightx2v / Lightning LoRA** (≈6 steps, high-noise strength ~3,
low-noise ~1.5 per community reports) this drops to roughly **1–3 minutes**. A tested 480×480,
81-frame clip ran ~**181 s** (3 min) warm on an 8 GB card.

**Strengths:** best-in-class photorealistic skin/hair consistency frame-to-frame, strongest natural
physics (water/smoke/cloth), largest LoRA ecosystem, richest prompt vocabulary (accepts lens words,
camera moves, lighting, emotion). **Weaknesses:** slow without distillation LoRAs; no native audio;
14B needs real VRAM or GGUF quantization.

**The one rule people repeat (multiple sources):** in I2V the text prompt is a **MOTION prompt** —
describe what *happens*, not what the scene *looks like*. The image already carries appearance.
E.g. *"the woman slowly turns to look at the camera,"* *"the water begins to ripple."*

**Frame/cadence gotchas (sourced):**
- 14B runs at **16 fps**; clip length must be a multiple of 16 **plus 1** → **81 frames ≈ 5 s**.
- One creator reported Wan 2.2 misbehaves at 24 fps and reverted to 16 fps.
- 5B TI2V runs **720p at 24 fps** via the native path.
- FLF/720p docs warn **720p models give poor results at small sizes** — don't shrink too far.

**Resolution sweet spots (community, 24 GB):** portrait 720×1280 / 832×1216 / 1024×1536;
landscape 1280×720 / 1216×832; ultra-wide 21:9 1392×592. On 8 GB: 480×480 or 832×480.

---

### 1.3 LTX-Video (Lightricks) — fastest, only one with native audio

- **Native ComfyUI templates** as of the latest source: **LTX-2.5** ships **three** workflows —
  T2V, **I2V**, and **FLF2V** (first-last-frame interpolation between two keyframes).
- **Files (per source, note these are `int8_convrot` Comfy builds, not Lightricks' BF16):**

```
ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors   → models/diffusion_models/
gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors        → models/text_encoders/
ltx-2.5-video-vae-bf16.safetensors + ltx-2.5-audio-vae-bf16.safetensors → models/vae/
ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors            → models/latent_upscale_models/
```

- **VRAM:** **8 GB+ with GGUF** (lowest realistic floor of the three), 16 GB+ for FP8 quality.
- **Speed:** fastest — a 5 s clip in **20–40 s** on an RTX 4090 with the FP8 distilled model at 8 steps.
- **Strengths:** speed, low VRAM, **only major open model with synchronized audio+video in one pass**,
  strong camera-motion accuracy, good for stylized/anime. Distilled runs ~8 steps.
- **Weaknesses:** trails WAN 2.2 on raw quality and prompt adherence; VAE shows softness in extreme
  close-ups; a 22B model despite "small" reputation (older 2B LTX-Video is the fast one).

> **Model evolution caution:** the older `Lightricks/ComfyUI-LTXVideo` GitHub repo (2B LTX-Video)
> still exists and is referenced widely. The 2B model is *fast* and good for prototyping but is
> **not** the quality tier you want for final shots. Pin "LTX-2.x/2.5" for real work.

---

### 1.4 HunyuanVideo (1.5) I2V

- **Tencent**, **8.3B** (down from the original 13B HunyuanVideo, which is what made single-GPU
  generation practical).
- **VRAM:** Tencent docs: *"Minimum GPU Memory: 14 GB (with model offloading enabled)"*; ComfyUI
  frames it as 24 GB consumer-GPU territory. 720p native, 1080p with a super-resolution model.
- **Files (source):** `hunyuanvideo1.5_720p_i2v_fp16.safetensors` (diffusion_models) +
  `sigclip_vision_patch14_384.safetensors` (clip_vision) + `qwen_2.5_vl_7b_fp8_scaled.safetensors`
  and `byt5_small_glyphxl_fp16.safetensors` (text_encoders) + `hunyuanvideo15_vae_fp16.safetensors`.
- **I2V gotcha (source):** the I2V branch requires a **CLIP Vision** path —
  `CLIPVisionLoader` + `CLIPVisionEncode` must be wired into the
  `HunyuanVideo15ImageToVideo` node, or **ComfyUI still renders a video that ignores your photo.**
- **Strengths:** smoother motion than WAN for portrait/character animation (per one source);
  good texture consistency. **Weaknesses:** 24 GB-ish VRAM, no audio, and 2026 sources say it
  **no longer leads any category**. Community license (not Apache) — more restrictive.

---

### 1.5 Legacy and newer entrants

- **CogVideoX I2V** (THUDM) — early I2V, 5B, superseded. Still works, not competitive on motion.
- **Stable Video Diffusion (SVD)** — Stability AI. Historically the *first* popular I2V in ComfyUI,
  now **largely superseded**; keep in mind only for compatibility with old workflows.
- **WAN 2.1 I2V** — older WAN; its **speedup LoRAs still work on WAN 2.2**, which is why 2.1
  artifacts matter even on a 2.2 build.
- **LongCat** — claims unlimited duration, WAN-compatible; **[quality UNVERIFIED]**.
- **OVI 11B** — ~10 s, audio via MMAudio; **[quality UNVERIFIED]**.
- **Wan 2.2 S2V** — "still + audio line → talking shot"; 16 fps, each extend chunk adds 77 frames
  (~4.8 s). Useful once you have a talking character (relevant to the avatars research).
- **Wan 2.2 Animate** — **Mix mode** swaps a character into footage; **Move mode** drives a
  character with a performer's motion. Warning from source: *"start small in size the first time
  to avoid running out of VRAM."*

---

## 2. Consistency across shots (the hard part)

Keeping the *same character* recognizable across every approved still is the make-or-break
requirement. There are two families of techniques: **identity adapters** (no training) and
**character LoRAs** (training), plus **seed/first-frame chaining** for temporal continuity.

### 2.1 Identity adapters — what they are and which work in ComfyUI

| Method | Trains? | Works on | Identity similarity (per aiofm.info 2026) | Style/pose flexibility | ComfyUI status |
|---|---|---|---|---|---|
| **IP-Adapter FaceID (Plus v2)** | No | **SDXL / SD1.5 only** | ~0.62 | Medium (pull weight to ~0.5, `weight_type=linear`) | **Mature / stable** — the oldest ecosystem |
| **InstantID** | No | **SDXL only** (Flux ports unstable as of 2026) | **~0.78 (best raw)** | **Locks pose/expression** (KPS ControlNet side-effect) | Works, but "quirky" |
| **PuLID** | No | **SDXL *and* Flux** (official PuLID-Flux) | ~0.69 (SDXL) / **~0.72 (Flux)** | **Best** — trained to ignore style | **Actively maintained; the 2026 default** |
| **FLUX.1-dev-IP-Adapter** (InstantX) | No | Flux | n/a (not a face tool) | Broad strokes only | Loader = `IPAdapterFluxLoader` (Shakker Labs pack). **Model card explicitly says NOT for tight character consistency.** |
| **FLUX Redux** | No | Flux | style/variation tool | n/a | BFL's own style/variation adapter — good for look, not identity |
| **FLUX Kontext** | No | Flux | prompt-driven edit | n/a | Strong prompt-adherence; used with PuLID for character workflows |

**Key findings, sourced:**

- The **2026 default for new pipelines is PuLID** — it is the only method with a mature **Flux**
  build, is the most actively maintained, and has the best identity-vs-flexibility ratio. Use
  **InstantID** only for **SDXL-locked** pipelines that need the single highest similarity number
  and can tolerate pose-lock (pair with a Canny/Depth/OpenPose ControlNet to override pose).
  Use **IP-Adapter FaceID Plus V2** when you want the most forgiving, most-documented, oldest node
  ecosystem (start here if new to adapter stacks).
- **PuLID's unique knob:** a `method` parameter with `"fidelity"` (max similarity), `"style"`
  (preserve target style harder), `"neutral"` (default), plus `weight` and `start_at`/`end_at`
  timestep-range control (`start_at=0, end_at=0.5` = structural influence; `0.5→1` = detail only).
- **InstantID drags the reference's lighting/expression/head-angle** into outputs (because of its
  face-keypoint ControlNet). **PuLID drags the least** — you can go from a flat-lit ID photo to
  cinematic lighting without fighting it.
- **VRAM:** all three add **~1–2 GB** on SDXL at 1024×1024 (PuLID is leanest, InstantID heaviest
  due to its ControlNet). **PuLID-Flux on FLUX.1[dev] needs ~16 GB** comfortably; **GGUF/Q8 builds
  drop that to ~10 GB**.

> **Critical caveat for our Flux decision:** `ComfyUI-nunchaku`'s PuLID nodes only support
> **Nunchaku Flux** models (not Z-Image or Qwen-Image), and its IPAdapter nodes are described as
> **"mentioned but not currently implemented."** So PuLID-on-Flux is real but **wiring-specific** —
> verify the node pack matches your Flux loader before committing.

### 2.2 Character LoRAs (the trained path)

When you need the *deepest, most repeatable* fidelity, a **trained character LoRA** beats adapters.
Best practice from the sources:

- **Stack a face LoRA with an adapter** — the LoRA carries texture/micro-detail (skin, freckles,
  scars) that embedding-based methods smooth away.
  - FaceID + face LoRA: FaceID 0.7 / LoRA 0.6 (most flexible).
  - **PuLID + face LoRA: PuLID 0.7 / LoRA 0.7** (PuLID doesn't fight the LoRA). ← best default.
  - InstantID + face LoRA: InstantID 0.8 (drop ControlNet to 0.5) / LoRA 0.4.
  - PuLID-Flux + Flux face LoRA: 0.8 / 0.6 (Flux LoRAs are strong — balance carefully).
- Train a LoRA only **after** the adapter path proves insufficient. Adapters "bias toward the
  reference but do not guarantee identity… hard angles, extreme expressions, and big style changes
  still cause drift."

### 2.3 Seed control and FaceDetailer re-anchoring

- **Fix the seed** across a character's stills. Multiple sources stress: use a **fixed seed** on
  the base, upscale and face-detail passes; only the *prompt* should change between shots.
- **FaceDetailer** (the node lives in **Impact Pack**) is the standard final re-anchor: it crops,
  re-diffuses and sharpens the face region at full resolution, fixing "melting eyes/mouth" SDXL
  produces at distance. **Keep FaceDetailer denoise ~0.4** — enough to sharpen, not enough to
  invent a new face. Reuse the same reference face + fixed seed.
- Standard recipe (SDXL world, `flick.art`): RealVisXL/Juggernaut checkpoint at 1024, **DPM++ 2M
  Karras, 25–30 steps**, IPAdapter FaceID weight **0.7–0.8** (below 0.7 the prompt takes over and
  the face drifts; 1.0 looks burned-in/stiff), ControlNet OpenPose for body, Canny/Depth at
  0.3–0.5 for composition, total ControlNet strength **under ~1.0** so it doesn't fight IPAdapter.

> **Honest limitation:** adapters still **drift on hard angles and expressions**. For a multi-shot
> film the robust answer is the **keyframe-first + first/last-frame chaining** approach in §3, not
> adapters alone.

### 2.4 First-frame / last-frame chaining (the strongest cross-shot continuity tool)

The published "core rule" for chained shots (GegenDenTag FLF workflow README):

> **"Every video must begin where the previous one ends — in composition, perspective, light, and
> narrative state."**

Checklist before generating **Video n+1**:
- Is its **first frame identical to the last frame** of Video n?
- Is the direction of motion consistent?
- Does the mood remain intact?
- Does the composition (zoom, framing, perspective) stay stable?

**How to wire it (verified against primary sources):**
- **`WanFirstLastFrameToVideo`** is a **core** node (lives in `comfy_extras/nodes_wan.py`). Inputs:
  `positive, negative, vae, width, height, length, batch_size` (required); `start_image, end_image,
  clip_vision_start_image, clip_vision_end_image` (optional). Outputs: `positive, negative,
  latent`. **With `end_image` unconnected it degrades to plain I2V** — one node handles both.
- **There is NO separate FLF checkpoint for Wan 2.2 14B** (unlike Wan 2.1 which shipped
  `wan2.1_flf2v_720p_14B`). You **reuse the standard I2V models.** The CLIP-vision sockets are
  vestigial from the 2.1 model — leave unconnected.
- The generated clip's **literal final frame equals the supplied `end_image`** → you can chain:
  feed Video n's last frame as Video n+1's `start_image`.
- **Loop color-drift caveat (sourced):** when `start_image == end_image`, the low-noise expert can
  drift color/contrast and make the seam visible. Mitigate: **keep loop clips ≤49 frames**, keep
  `shift` moderate (3.0 @ 480p), add an output color-match pass.
- **Community chaining pack:** `Well-Made/ComfyUI-Wan-SVI2Pro-FLF` — combines **SVI 2 Pro** motion
  continuity with FLF end-control; ships workflows for **up to 7 clips** (duplicate a group to
  extend). Node `WanImageToVideoSVIProFLF` takes `anchor_samples`, optional `prev_samples` (motion
  tail) and `end_samples`; utility `WanCutLastSlot` trims the last latent slot (4 frames) to avoid
  artifacts where hard-locked end frames clash with SVI steering. Seam caveat: the VAE split can
  misalign; there is an `overlap` slider (adjust by one or two steps).

This is the mechanism that should back the Director Dashboard's cross-shot continuity: **approve
still n → animate → take last frame → seed still n+1.**

---

## 3. Keyframe-first pipeline architecture

### 3.1 The shape

```
┌─ AUTEUR (LLM) ─────────────────────────────────────────────────────────────┐
│ Writes markdown plan: SCENE HEADING / NARRATIVE CONTEXT / ### SHOT n        │
│ each with visual prompt + sound design + dialogue  (already exists)        │
└───────────────────────────────┬────────────────────────────────────────────┘
                                ▼
┌─ STILL PASS (image gen) ───────────────────────────────────────────────────┐
│ Per shot: FLUX/SDXL + character identity (PuLID or IP-Adapter + LoRA) +    │
│ fixed seed → ONE keyframe image per shot.  Human reviews in dashboard.     │
└───────────────────────────────┬────────────────────────────────────────────┘
                                ▼
                    ┌─ HUMAN CURATION GATE (approve / regenerate / edit) ─┐
                    │  ← this is the new step the user wants              │
                    └───────────────────────┬─────────────────────────────┘
                                            ▼
┌─ ANIMATE PASS (I2V) ───────────────────────────────────────────────────────┐
│ Approved still → Wan 2.2 14B I2V (motion prompt) → clip                    │
│ Optional: chain last frame into next shot's start_image (FLF2V)            │
└───────────────────────────────┬────────────────────────────────────────────┘
                                ▼
┌─ POST PASS ────────────────────────────────────────────────────────────────┐
│ temporal upscale (SeedVR2) → frame interpolation (RIFE) → VHS encode       │
│ (+ MiniMax H3 for FLF-with-audio, or MMAudio/Wan S2V for talk)             │
└────────────────────────────────────────────────────────────────────────────┘
```

**Two separate ComfyUI graphs are the right decomposition:** an **image graph** (still pass) and a
**video graph** (I2V pass). Do not try to fuse them — the curation gate is a human pause, so the
two passes are naturally two HTTP submissions of two different graphs.

### 3.2 Why keyframe-first (from the sources)

- *"Start most shots from a still you've approved, not from text. A keyframe is that still. It
  locks the face, the outfit and the framing, so the video model only has to add motion."*
- The I2V **text prompt becomes a motion prompt** — describe action, not appearance.
- It cleanly separates the two failure modes: **look** failures are caught at the still gate (cheap
  to regenerate), **motion** failures are caught at the clip gate.

### 3.3 Driving ComfyUI from the app (HTTP API) — verified endpoints

The dashboard already calls ComfyUI over HTTP. The **authoritative route list** (ComfyUI docs,
`docs.comfy.org/development/comfyui-server/comms_routes`):

| Path | Method | Purpose |
|---|---|---|
| `/prompt` | **POST** | Submit a prompt (API-format graph). Returns `prompt_id` + queue number, or `error` / `node_errors` if validation fails. |
| `/prompt` | GET | Current queue status + execution info |
| `/history` | GET | Full queue history |
| `/history/{prompt_id}` | GET | History for one job (contains `outputs`) |
| `/history` | POST | Clear history / delete an item |
| `/queue` | GET | Current execution queue state |
| `/queue` | POST | Manage queue (clear pending/running) |
| `/interrupt` | POST | Stop the current execution |
| `/view` | GET | Fetch an output image (`?filename=…&subfolder=…&type=…`) |
| `/upload/image` | POST | Upload an input image (this is how you push an approved still / reference into a graph — **[endpoint listed via server.py; exact path per docs is `/upload/image`]**) |
| `/object_info` / `/object_info/{class}` | GET | Node schemas (use to **validate node names** at build time) |
| `/system_stats` | GET | Python version, devices, **VRAM** |
| `/ws` | **WebSocket** | Real-time progress + execution status + errors + latent previews |

**Minimal submit (from `script_examples/basic_api_example.py`):**

```python
import json, urllib.request
def queue_prompt(prompt):
    p = {"prompt": prompt}
    data = json.dumps(p).encode('utf-8')
    req = urllib.request.Request("http://127.0.0.1:8188/prompt", data=data)
    return json.loads(urllib.request.urlopen(req).read())  # -> {"prompt_id": ..., "number": ...}
```

**The recommended completion pattern (docs, `websockets_api_example.py`):**
1. Generate a `client_id = str(uuid.uuid4())`.
2. `POST /prompt` with `{"prompt": graph, "client_id": client_id, "prompt_id": prompt_id}`.
3. Open `ws://127.0.0.1:8188/ws?clientId={client_id}`.
4. Loop `ws.recv()`; parse JSON messages; when `message['type'] == 'executing'` and
   `data['node'] is None` and `data['prompt_id'] == prompt_id` → **execution done**.
5. `GET /history/{prompt_id}`, read `history[prompt_id]['outputs'][node_id]['images']`.
6. `GET /view?filename=…&subfolder=…&type=…` to download each output.

WebSocket message types include `status`, `execution_start`, `executing` (and progress/preview
messages). Binary frames after the `executing` marker are latent previews.

**Notes that matter for our implementation:**
- **Export the graph in API format** ("Save (API Format)" / "Export (API)"). Node IDs are the JSON
  keys; each node is `{"class_type": "...", "inputs": {...}}` where a link to another node's output
  is `["<node_id>", <output_index>]`. This is exactly what `minimax-graph.ts` already does.
- **Security gotcha (server.py):** ComfyUI rejects POSTs whose `Host` and `Origin` hostnames
  mismatch — a guard against random websites queuing workflows on 127.0.0.1. A server-side caller
  (our Next.js backend) is unaffected; a browser caller must set correct headers/CORS.
- **`/object_info`** is the API to call at build time so we never invent a node name — validate the
  graph's `class_type`s against the live server.
- **Cloud variant differs:** Comfy Cloud uses `POST /api/prompt` with an `X-API-Key` header and
  `/api/job/{prompt_id}/status` polling. Our local path uses the plain `/prompt` above.

### 3.4 Where MiniMax H3 fits (this machine's existing model)

MiniMax H3 (`minimax_h3_fl2va_pruned_fp8_scaled.safetensors`, "fl2va" = **first-last → video +
audio**) is **not** a general "animate one still" driver. It is a **first-last-frame** model. That
makes it a **complement**, not a replacement: once two approved stills exist for a shot
(start + end), H3 can generate a clip **with synchronized audio** between them — which the
no-audio Wan/LTX path cannot. Keep the general animate-one-still path on **Wan 2.2 I2V** and use
H3 where a shot needs generated audio in the same pass.

---

## 4. Building blocks: upscalers, interpolation, detailers

### 4.1 The correct order

> **Spatial restore+upscale → frame interpolation → encode.**
> **Do the spatial pass on the real frames FIRST, then interpolate.** Interpolating before
> upscaling means the interpolator works on smaller frames (faster, slightly less clean).

### 4.2 Spatial upscalers

- **Per-frame ESRGAN** (quick, local, no big download): `ImageUpscaleWithModel` with a 4× ESRGAN
  model, then `ImageScale` **back down to ~2×** — a **4×→2× supersample**, described as "the single
  biggest quality lever" because it averages out per-frame noise. Known-good models:
  **`4x_foolhardy_Remacri`** (best for realistic footage/water/skin), **`4x-ClearRealityV1`**
  (clean/sharp). **Tradeoff: per-frame upscalers _flicker_** (shimmer on water/fine detail) because
  each frame is sharpened independently.
- **Temporal-aware restorers** (flicker-free, the 2026 recommendation):
  - **SeedVR2** — diffusion-transformer restorer, "the proven workhorse." Node pack
    `numz/ComfyUI-SeedVR2_VideoUpscaler` (4 nodes: `SeedVR2 (Down)Load DiT Model`, `(Down)Load VAE
    Model`, optional `Torch Compile Settings`, `SeedVR2 Video Upscaler`). Models auto-download to
    `models/SEEDVR2/`: 3B/7B, fp16/fp8/GGUF. Key param **`batch_size` must be `4n+1`** (1,5,9,…);
    **higher = less temporal flicker**. `resolution` = target **short edge** in px (default 1080).
  - **FlashVSR** — newer one-step streaming VSR, faster; pack `1038lab/ComfyUI-FlashVSR`.
- **The load-bearing trick: DOWNSCALE FIRST** (e.g. 0.5×) before the restorer. The restorer
  *regenerates* detail; feeding it a clean small frame forces synthesis of sharp detail instead of
  magnifying compression artifacts. Rule of thumb: downscale to 0.5× (or ~360–480p short side) for
  messy/AI-gen footage; skip the downscale for already-clean sources.

### 4.3 Frame interpolation (VFI)

- **Built-in (ComfyUI 0.26+):** core nodes **`FrameInterpolationModelLoader`** + **`FrameInterpolate`**
  (RIFE/FILM). They auto-detect checkpoints in **`models/frame_interpolation/`** (empty by default →
  why the dropdown looks blank). Core-compatible weights live at HF **`Comfy-Org/frame_interpolation`**:
  - **`rife_v4.26.safetensors`** (~22 MB) — RIFE, newest/most accurate, default for smooth small-motion fps-doubling.
  - **`film_net_fp16.safetensors`** (~66 MB) — FILM, better on **large motion gaps**.
  - Drop the file in and **restart** so the dropdown populates.
- **Custom pack (pre-0.26 or extra methods):** **`Fannovel16/ComfyUI-Frame-Interpolation`**.
  Primary node **`RIFE VFI (4.0 - 4.9)`**, `ckpt_name` `rife47`/`rife49` recommended, `multiplier`
  = target_fps / source_fps (2 for standard doubling). Also ships `FILM VFI`, `GMFSS Fortuna VFI`,
  `STMFNet VFI`/`FLAVR VFI` (these need ≥4 input frames), `IFRNet`, `M2M`, `AMT`.
  **There is no "GIMM-VFI" node in this pack** — GIMM-VFI is a *separate* pack.
- **GIMM-VFI** — pack **`kijai/ComfyUI-GIMM-VFI`**, node `GIMMVFI_interpolate` / loader
  `(Down)Load GIMMVFI Model`. Models from **`Kijai/GIMM-VFI_safetensors`**. It models motion as a
  continuous function of time (`interpolation_factor` up to 100 — arbitrary-time, not just power-of-2
  doubling). **Quality win on hard motion** (fast pans, occlusion, chaotic action) **at real cost:
  community timing put RIFE ~9 s vs GIMM ~25–53 s on a matched clip.** Needs `cupy` (pinned
  `cupy-cuda12==13.3.0`); **NVIDIA-only, no documented CUDA fallback.** Use it only for the shot that
  needs it; RIFE/FILM for calm motion.
- **Classic failure mode:** interpolation adds frames, it does **not** change playback fps. If you
  stretch a 16 fps clip ×2 and leave the encode at 16 fps you get **slow-motion**, not smoother.
  **Set the encode fps = source_fps × multiplier.**
- **VHS** (`Kosinkadink/ComfyUI-VideoHelperSuite`) provides `VHS_VideoCombine` (FFmpeg mux,
  audio passthrough) and video load/save; also `CreateVideo` / `SaveVideo` in newer core.

### 4.4 Detailers and post passes

- **FaceDetailer** (Impact Pack) — per-shot face re-anchor (§2.3). Denoise ~0.4.
- **UltimateSDUpscale** — tiles a diffusion upscale; useful for stills, but **flickers on video**
  (per-frame) — prefer temporal restorers for clips.
- **Color-match pass** — matters for FLF loops (drift); `loop_color_match` exists in one community
  animation writer; an `Adjust Contrast` node (~1.2) is used in the SVI-Pro-FLF pack for washed-out
  frames.

---

## 5. Published workflow templates worth copying

### 5.1 Official ComfyUI templates (built in — "Workflow → Browse Templates → Video")

Per `docs.comfy.org/tutorials/video/wan/wan2_2` and the template library:

| Template (search name) | Use |
|---|---|
| **"Wan2.2 5B video generation"** | Fast T2V/I2V drafts, 720p, ~8 GB with native offload |
| **"Wan2.2 14B I2V"** | The workhorse **animate-a-still** template (high+low noise pair) |
| **"Wan2.2 14B T2V"** | Final-quality text-to-video |
| **"Wan2.2 14B FLF2V"** | **First-last-frame** — set start+end, fill the move (same model files as I2V) |
| Wan 2.2 S2V | still + audio line → talking shot |
| Wan 2.2 Animate | Mix/Move modes for character replacement / motion drive |
| **LTX-2.5 T2V / I2V / FLF2V** | Three native workflows; I2V + first-last-frame |
| **HunyuanVideo 1.5 T2V / I2V** | 5–10 s clips on consumer GPUs |

Each official template can be **downloaded as JSON** from the ComfyUI docs page or found by name in
the Template Library. Preview images live under
`raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/`.

### 5.2 Specific published graphs / repos to copy

- **`GegenDenTag/comfyui-wan-video-2.2-t2v-first-last-frame-workflow`** (Hugging Face) — minimal
  Wan 2.2 14B FLF2V graph: two `LoadImage` → `WanFirstLastFrameToVideo` → high/low noise 4-step
  Lightning LoRAs → VAE decode → optional `4x` UltimateSharp → RIFE 2× → `VHS_VideoCombine` →
  optional `LoadAudio`. Includes the **"every video begins where the previous ends"** chaining
  checklist. Tested 24 GB (3090/4090); portrait/landscape/21:9 resolutions listed.
- **`Well-Made/ComfyUI-Wan-SVI2Pro-FLF`** (GitHub) — multi-clip chaining with SVI 2 Pro motion
  continuity + FLF end control (workflows for up to 7 clips). See §2.4.
- **`SciensOne/comfyui-workflow-generator`** (GitHub) — **parametric batch generator**: describe
  characters/poses/locations once in data files, build script emits ready ComfyUI JSON. Routes:
  **SDXL/Illustrious + PuLID** and **Flux/GGUF + PuLID-Flux**, with **matching I2V videos**
  (`longvideo.json` = Wan 2.2 I2V GGUF block-swap). This repo is the closest published match to
  "consistent character across stills → then I2V" and its `docs/VRAM-Saving.md` documents Wan
  block-swap for limited VRAM. **Directly worth copying.**
- **Mickmumpitz "Consistent Character Creation with Flux"** (write-up via
  `learn.thinkdiffusion.com`) — FLUX + `flux_shakker_labs_union_pro` ControlNet + `4x-ClearRealityV1`
  + `face_yolov8m` Ultralytics detector; fixed seed on upscale/face passes. Good reference for the
  Flux still-pass graph.
- **Official ComfyUI API example scripts** (source, do not re-invent):
  `Comfy-Org/ComfyUI/script_examples/basic_api_example.py` and
  `.../websockets_api_example.py` (mirrored widely).
- **ComfyUI docs API pages:** `docs.comfy.org/development/comfyui-server/api-examples` and
  `.../comms_routes`.
- **`runcomfy.com` "Flux Kontext Pulid | Consistent Character Generation"** — a published Flux +
  Kontext + PuLID character graph (single reference face → consistent chars across scenes, with
  weight + `start_at`/`end_at` identity control and a Redux second-pass highres).
- **`comfy.icu` node references** (useful for exact node names/schemas): `IPAdapterFluxLoader`,
  `GIMMVFI_interpolate`, `CoachBateUpscaleRifeTensorRT`, `WanVideoEnhancer_F2`.

> **Node-name caution:** the exact `class_type` strings must be verified against a live
> `/object_info` call or the `comfy.icu` node pages before being baked into `minimax-graph.ts`-style
> code. Several community packs wrap core nodes under new names (e.g. `Wan Animation Conditioning`
> wraps `WanFirstLastFrameToVideo`) — copy the *wiring*, not the wrapper name.

---

## 6. Install shopping list for THIS machine

Given `models/checkpoints`, `loras`, `controlnet`, `upscale_models` are **empty**, here is the full
stack the keyframe-first pipeline needs.

### 6.1 Image generation (the still pass) — you must add an image model

- **FLUX.1-dev** (recommended base for character work — PuLID-Flux, Kontext, Redux all target it):
  - `flux1-dev-fp8.safetensors` → `models/diffusion_models/` (or `unet/`)
  - `t5xxl_fp8_e4m3fn.safetensors` + `clip_l.safetensors` → `models/text_encoders/` (or `clip/`)
  - `ae.safetensors` → `models/vae/`
  - *(Alternative: an SDXL checkpoint like RealVisXL/Juggernaut if you prefer the older, most-mature
    IPAdapter/InstantID ecosystem, or Chroma for NSFW-tuned work.)*
- **Identity:** **PuLID** (SDXL + Flux) as the default; keep **IP-Adapter FaceID Plus V2** installed
  as the fallback; **InstantID** only if you lock to SDXL. PuLID-Flux needs `EVA02_CLIP_L_336` and
  an InsightFace provider (CUDA).
- **Optional but useful:** FLUX **Redux** (look/style) and **Kontext** (prompt-driven edits),
  `flux_shakker_labs_union_pro` ControlNet.

### 6.2 Video generation (the animate pass) — you must add an I2V driver

- **Wan 2.2 14B I2V (primary):**
  - `wan2.2_i2v_high_noise_14B_fp16.safetensors` (or `_fp8_scaled`) → `models/diffusion_models/`
  - `wan2.2_i2v_low_noise_14B_fp16.safetensors` (or `_fp8_scaled`) → `models/diffusion_models/`
  - `umt5_xxl_fp8_e4m3fn_scaled.safetensors` → `models/text_encoders/`
  - `wan_2.1_vae.safetensors` → `models/vae/` (14B path uses the **2.1** VAE, not the 2.2 5B VAE)
  - **Lightx2v/Lightning I2V LoRA** (rank 32/64/128) → `models/loras/` (cuts steps to ~6; makes 8 GB viable)
  - *(Optional: GGUF quants for the 14B experts if VRAM is tight — Q4/Q5 for 8 GB, Q5_K_M ≈10.8 GB, Q6_K ≈12 GB; needs `ComfyUI-GGUF`.)*
- **Optional quick draft:** `wan2.2_ti2v_5B_fp16.safetensors` + `wan2.2_vae.safetensors` (~8 GB).
- **Optional audio / speed:** **LTX-2.5** (`ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors`,
  `gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors`,
  `ltx-2.5-video-vae-bf16.safetensors`, `ltx-2.5-audio-vae-bf16.safetensors`,
  `ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors`).

### 6.3 Post-processing support models

- **Upscale:** `4x_foolhardy_Remacri` and/or `4x-ClearRealityV1` → `models/upscale_models/`;
  optional temporal restorer **SeedVR2** (3B fp8 default) → `models/SEEDVR2/`.
- **Interpolation:** **`rife_v4.26.safetensors`** (+ `film_net_fp16.safetensors`) →
  `models/frame_interpolation/` for the **built-in** nodes.

### 6.4 Custom nodes to install (via ComfyUI Manager)

- **ComfyUI-GGUF** (GGUF quant loaders) · **ComfyUI-VideoHelperSuite (VHS)** · **ComfyUI-KJNodes**
- **PuLID** / **PuLID-Flux** + **IPAdapter** (cubiq `ComfyUI_IPAdapter_plus`) + **InstantID** (optional)
- **Impact Pack** (FaceDetailer) · **ComfyUI-Frame-Interpolation** (Fannovel16, optional on 0.26+)
- **ComfyUI-GIMM-VFI** (kijai, optional) · **ComfyUI-SeedVR2_VideoUpscaler** (numz, optional)
- *(Everything for the existing MiniMax H3 path stays.)*

### 6.5 Concrete recommendation

- **Still pass:** FLUX.1-dev fp8 + **PuLID-Flux** (+ a face LoRA once trained), fixed seed, 1024-ish.
- **Animate pass:** **Wan 2.2 14B I2V** + Lightx2v LoRA; **chain last frame → next start** for
  continuity (`WanFirstLastFrameToVideo`).
- **Audio shots:** MiniMax H3 (existing, FLF+audio) or LTX-2.5 / Wan S2V.
- **Post:** SeedVR2 (3B fp8, batch 4n+1) → RIFE (`rife_v4.26`) → VHS encode at multiplied fps.
- **App integration:** image graph and video graph as two API-format JSON graphs; submit still graph
  → wait on `/ws` → download via `/history`+`/view` → human gate → submit video graph with the
  approved still uploaded to `/upload/image` → wait → download.

---

## 7. Open questions / unverified

- **Exact `/upload/image` path** — the docs route table lists `/upload/mask` explicitly; the image
  upload route is present in `server.py` but I did not quote its exact string from a primary source.
  **Verify against the running server's `/object_info` or the source before coding.** [UNVERIFIED string]
- **LTX-2.5 vs LTX-2.3 naming** — sources conflict; the most recent says ComfyUI ships **LTX-2.5**
  templates. Confirm the exact file list against `docs.comfy.org` at install time.
- **LongCat / OVI quality claims** — not independently verified. [UNVERIFIED]
- **GIMM-VFI on this box** — NVIDIA-only and needs `cupy`; verify CUDA version compat before adopting.
- **PuLID node pack vs your Flux loader** — `ComfyUI-nunchaku` PuLID is Nunchaku-Flux-only; if you
  load plain FLUX.1-dev, use a **non-nunchaku** PuLID node pack and verify `class_type` names live.

---

## Sources

Primary:
- ComfyUI Wan 2.2 official tutorial — https://docs.comfy.org/tutorials/video/wan/wan2_2
- ComfyUI Server routes — https://docs.comfy.org/development/comfyui-server/comms_routes
- ComfyUI API examples — https://docs.comfy.org/development/comfyui-server/api-examples
- ComfyUI basic API example — https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/basic_api_example.py
- ComfyUI `server.py` — https://github.com/Comfy-Org/ComfyUI/blob/master/server.py
- Comfy Cloud API overview — http://docs.comfy.org/development/cloud/overview

Secondary (community, cited inline):
- Local AI video 2026 (Wan 2.2 / HunyuanVideo 1.5 / LTX-2.5) — https://bestfreewebresources.com/comfyui-video-generation-local-guide-2026
- Best local AI video model 2026 (LTX-2.3 vs WAN 2.2 vs HunyuanVideo 1.5) — https://earngenix.com/workflows/best-local-ai-video-model-2026
- ComfyUI I2V workflows (OnePlaceForAI) — https://oneplaceforai.com/learn/lesson/image-to-video-workflows
- Micro-drama ComfyUI templates/recipes — https://openmicrodrama.com/guides/comfyui-for-micro-drama
- WAN 2.2 I2V on 8 GB VRAM (runflow) — https://www.runflow.io/blog/comfyui-wan-2-2-image-to-video
- ComfyUI image-to-video complete guide 2026 — https://aiimagetovideo.pro/blog/comfyui-image-to-video-2
- Wan 2.2 ComfyUI setup (wan-ai.app) — https://wan-ai.app/wan-comfyui-workflow
- Wan 2.2 TI2V-5B on RTX 3090 (smeltcore) — https://smeltcore.com/recipes/wan-2-2-ti2v-5b-on-rtx-3090-720p-text-image-to-video-in-comfyui
- Wan 2.2 I2V 14B GGUF beginner walkthrough — https://www.youtube.com/watch?v=vwu0KwxVNGo
- Civitai full I2V workflow walkthrough (WAN 2.2) — https://civitai.com/articles/24175/full-image-to-video-workflow-walkthrough
- GegenDenTag FLF2V workflow — https://huggingface.co/GegenDenTag/comfyui-wan-video-2.2-t2v-first-last-frame-workflow
- andyhite/andypack prompting guide (FLF node internals) — https://github.com/andyhite/comfyui-andypack/blob/main/docs/prompting-guide.md
- Well-Made ComfyUI-Wan-SVI2Pro-FLF — https://github.com/Well-Made/ComfyUI-Wan-SVI2Pro-FLF/blob/main/README.md
- PuLID vs InstantID vs IP-Adapter FaceID (2026) — https://aiofm.info/en/guides/pulid-vs-instantid-vs-faceid
- Flux IP-Adapter loader (comfy.icu) — https://comfy.icu/node/IPAdapterFluxLoader
- Flux Kontext PuLID workflow (runcomfy) — https://www.runcomfy.com/comfyui-workflows/flux-kontext-pulid-consistent-character-generation
- Consistent character with Flux (ThinkDiffusion) — https://learn.thinkdiffusion.com/consistent-character-creation-with-flux-comfyui/
- Keep a character consistent (flick.art) — https://flick.art/blog/img2img-consistent-character/comfyui
- SciensOne workflow generator (PuLID stills→I2V) — https://github.com/SciensOne/comfyui-workflow-generator
- Nunchaku PuLID/IPAdapter nodes (DeepWiki) — https://deepwiki.com/nunchaku-ai/ComfyUI-nunchaku/4.4-pulid-and-ipadapter-nodes
- Video upscale/restore/VFI skill (SeedVR2/FlashVSR/RIFE) — https://flowy.sh/listings/artokun-comfyui-mcp/skills/video-upscale
- GIMM-VFI interpolate node (comfy.icu) — https://comfy.icu/node/GIMMVFI_interpolate
- CoachBate Upscale+RIFE TensorRT node (comfy.icu) — https://comfy.icu/node/CoachBateUpscaleRifeTensorRT
- VSRFI-ComfyUI (VSR+VFI) — https://github.com/neilthefrobot/VSRFI-ComfyUI
- Master video creation FLF workflow (comfyui.org) — http://comfyui.org/en/master-video-creation-workflow
- comfyui-cinema-pipeline workflow notes — https://github.com/12georgiadis/comfyui-cinema-pipeline/blob/main/docs/02-cinema-workflows.md
- Wan 2.2 FLF2V workflow page (comfy.org) — https://comfy.org/workflows/video_wan2_2_14B_flf2v-7016f027bcf1/
