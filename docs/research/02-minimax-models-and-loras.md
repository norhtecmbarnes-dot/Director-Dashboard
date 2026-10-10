# MiniMax Video Models & Their ComfyUI / LoRA Ecosystem

**Purpose:** research for the Director Dashboard (`C:\ai\proposal genie\Director-Dashboard`), which builds MiniMax video graphs in `src/lib/comfyui/minimax-graph.ts` and is moving to a *generate-image → curate → animate* workflow.

**Date:** October 2026. All filenames below were verified directly against the Hugging Face API (file listings), not inferred. Where a name could **not** be verified it is called out explicitly.

**Verified against the current code** (`minimax-graph.ts`): it uses `CLIPLoader` type `minimax`, two `VAELoader`s (video + audio), `UNETLoader`, optional `LoraLoader` defaulting to `minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors`, and nodes `MiniMaxH3ImageToVideo`, `MiniMaxH3ReferenceToVideo`, `MiniMaxH3SigmaShift`. All four default model files it references **exist** in the `Comfy-Org/MiniMax-H3` repo (verified below).

---

## 1. What MiniMax video models exist, and which are usable

MiniMax's video line has two very different halves: a **hosted-API-only** family (Hailuo 01/02/2.3, abab-video) and the **open-weight** model that the code actually integrates (MiniMax H3). Only **H3** is a ComfyUI *local* model; everything else is a cloud API node.

| Model | Released | Open weights? | T2V | I2V | First-last-frame (FL2V) | Native audio | Notes |
|---|---|---|---|---|---|---|---|
| **abab-video-1** | Aug 2024 | ❌ API/app only | ✅ | – | – | ❌ | MiniMax's first video model; 1280×720, 25 fps, ≤6 s. Legacy. ([source](https://news.aibase.com/news/11465)) |
| **Hailuo 01 (T2V-01 / I2V-01 / S2V-01 / *-Director)** | 2024–2025 | ❌ API only | ✅ | ✅ | – (S2V via subject reference) | ❌ | Camera-control `[command]` syntax on Director variants. ([source](https://comfy.icu/node/Comfly_MiniMax_video)) |
| **Hailuo 02** | Jun 2025 | ❌ API only | ✅ | ✅ (first-frame) | – | ❌ | 768P (6s/10s), 1080P (6s). ComfyUI cloud node `MinimaxHailuoVideoNode`. No HF weights repo (`MiniMaxAI/MiniMax-Hailuo-02` returns HTTP 401). ([source](https://www.minimax.io/news/minimax-hailuo-02), [node](https://docs.comfy.org/built-in-nodes/MinimaxHailuoVideoNode)) |
| **Hailuo 2.3 / 2.3-Fast** | Oct 28 2025 | ❌ API only | ✅ (2.3) | ✅ | – | ❌ | IDs `MiniMax-Hailuo-2.3`, `MiniMax-Hailuo-2.3-Fast`. 768P (6/10s), 1080P (6s). Now listed as **Legacy**; ~$0.28/call (768P, 6s). ([release notes](https://platform.minimax.io/docs/release-notes/apis), [spec](https://minimax-ai.chat/models/minimax-hailuo-23)) |
| **MiniMax H3 (a.k.a. Hailuo 3.0 / Hailuo 03)** | API 31 Jul 2026; **open weights 3 Aug 2026** | ✅ **open weights** | ✅ | ✅ | ✅ | ✅ **stereo** | The model the code integrates. 33B omni-modal, 768p native (≈1 MP) → 2K via hosted regenerate, 24 fps, 4–15 s. ([HF card](https://huggingface.co/MiniMaxAI/MiniMax-H3), [ComfyUI guide](https://docs.comfy.org/tutorials/video/minimax/minimax-h3)) |

**What "MiniMax H3" refers to specifically in a ComfyUI context** (this is what makes the code's shape make sense):

- H3 is a **33B-parameter dense, single-stream "omni" transformer** that generates **video and stereo audio in one sampling pass** — audio is not a separate model. ([ComfyUI guide](https://docs.comfy.org/tutorials/video/minimax/minimax-h3), [HF card](https://huggingface.co/MiniMaxAI/MiniMax-H3))
- Its pipeline components map **1:1 onto the code's node graph**:
  - **Text encoder = Qwen3-VL-32B** (hidden states from layer 50) → this is the `CLIPLoader type: 'minimax'`. ComfyUI treats it as a minimax-type CLIP. (`qwen3vl_32b_minimax_h3_*.safetensors`)
  - **Visual VAE** = temporally causal video autoencoder, compression f16t4d24 (16× spatial, 4× temporal, 24 latent channels) → the code's `vae`.
  - **Separate Audio VAE** = 32 kHz stereo, 40 Hz latent rate, DAC-style → the code's `audioVae`.
  - **Transformer (DiT)** = the `UNETLoader`.
  - The latent is an **NestedTensor pair** (video `[B,24,T,H/16,W/16]`, audio `[B,32,2,T·40]`), which is why the code decodes video and audio separately (`VAEDecode` + `VAEDecodeAudio`) and recombines via `CreateVideo`.
- H3 ships as **two task-specific checkpoints**, and this matters for LoRAs:
  - **H3-Base FL2VA** → `t2va` (text-to-video), `i2va` (first-frame), `l2va` (last-frame), `fl2va` (first+last) — **video + audio**.
  - **H3-Base Ref2VA** → `ref2va` reference-driven generation (≤9 images, ≤3 videos, ≤3 audio clips).
  - In ComfyUI these are exposed by `MiniMaxH3ImageToVideo` (t2v/i2v/fl2v family) and `MiniMaxH3ReferenceToVideo` (ref2va family) — exactly the two node types the code branches between.

---

## 2. The LoRA ecosystem for MiniMax video in ComfyUI

### 2a. The code's LoRA: `minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors`

**This file is real and verified.** It lives at `Kijai/MiniMax-H3_comfy/loras/` at **1,956,171,984 bytes (~1.96 GB)**. ([HF repo file listing](https://huggingface.co/Kijai/MiniMax-H3_comfy)) It is Kijai's ComfyUI-format conversion of LightX2V/ModelTC's `minimax_h3_fl2v_turbo_4step_v0.1.safetensors` (1.38 GB, in `lightx2v/Minimax-h3-Turbo`).

**What it does — "LightX2V turbo distillation":** the LightX2V team (ModelTC) distilled H3's FL2V generation from ~20 sampling steps down to **4**, so the sampler converges in a few big jumps instead of a long trajectory. Kijai's test notes recommend **4 steps, ~0.75 LoRA strength, `er_sde` or `sa_solver` sampler**; the alpha is not confirmed, and lowering strength helps noisy output. ([comfyui-wiki release note](https://comfyui-wiki.com/en/news/2026-08-07-minimax-h3-turbo-lightx2v), [Kijai repo](https://huggingface.co/Kijai/MiniMax-H3_comfy)) v0.1 is explicitly a **preview focused on FL2V**; a Ref2V distillation was on the roadmap.

> Note: the code bakes `strength_model/clip = 1.0` and steps = 4. Kijai's own guidance is **0.75 strength** — worth testing, since 1.0 can produce noisier output.

### 2b. What "fl2v" (first-last-frame to video) means

**FL2V / FL2VA = "first-last-frame → video"**, and in H3 naming it labels the **checkpoint family** (the FL2VA base), which covers:
- **no image** → text-to-video (t2va)
- **first frame only** → image-to-video (i2va)
- **last frame only** → l2va
- **first + last frame** → first-last-frame-to-video (fl2va)

So the turbo LoRAs named `*_fl2v_*` are trained for the **FL2VA base checkpoint** — which is exactly what the code loads (`minimax_h3_fl2va_pruned_fp8_scaled.safetensors`). **A critical compatibility rule:** FL2VA LoRAs and Ref2VA LoRAs are **not interchangeable** — match the LoRA family to the checkpoint family. ([HF card](https://huggingface.co/MiniMaxAI/MiniMax-H3), [ComfyUI docs](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native))

### 2c. Other LoRAs that actually exist (verified filenames)

**Speed / turbo distillations** (all verified in the HF file listings):

| Repo | Verified file(s) | Notes |
|---|---|---|
| `Comfy-Org/MiniMax-H3` (loras/) | `minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors` (1.96 GB), `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` (1.96 GB), `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` (1.96 GB) | The **official** repacks. The 8-step one is wired to the workflow's `turbo_mode` toggle. |
| `lightx2v/Minimax-h3-Turbo` | `minimax_h3_fl2v_turbo_4step_v0.1.safetensors`; `..._4step_v1.0_768p{,_comfyui}_bf16`; `..._4step_v1.1_768p{,_comfyui}_bf16` + `_fp8`; `..._4step_v1.2_768p{,_comfyui}_bf16`; `..._8step_v1.0{,_768p}{,_comfyui}_bf16`; `..._ref2v_turbo_4step_v0.1{,_comfyui}_bf16`; `..._ref2v_turbo_8step_v1.0_768p{,_comfyui}_bf16` | The **source** of the Turbo line. **v1.1/v1.2 are audio-quality refreshes** (same 4-step; v1.2 specifically reduces audio artifacts). ComfyUI bf16 weights are published side-by-side — no conversion needed. |
| `lightx2v/Minimax-h3-Turbo-SLA` | `minimax_h3_fl2v_turbo_4step_v0.1_768p_sla_bf16.safetensors`, `..._sla_comfyui_bf16.safetensors` | 4-step FL2V distillation **+ SLA (Sparse-Linear Attention, 85% sparsity)**; ~2.5× speedup on an RTX 5090. |
| `Kijai/MiniMax-H3_comfy` (loras/) | + `..._4step_v0.1_comfy_resized_avg_rank_21_bf16.safetensors` (315 MB), `..._4step_v1.0_768p_resized_avg_rank_31_bf16.safetensors` (441 MB), `..._8step_v1.0_resized_avg_rank_24_bf16.safetensors` (365 MB), `minimax_h3_ref2v_lightx2v_turbo_4step_v0.1_resized_avg_rank_20_bf16.safetensors` (307 MB), `minimax_h3_taomate_3step_lora_avg_rank_19_bf16.safetensors` (182 MB) | Kijai's **resized low-rank** conversions (much smaller, easier to fit). |
| `larryvrh/MiniMax-H3-Turbo-Lora` | `minimax_h3_turbo_4step{,_ckpt500,_ckpt850}{,_ema,...}.safetensors` (~780 MB each) | Independent community turbo line; referenced as an alternative (6–10 steps). |
| `FastVideo/FastVideo-FastH3-Comfy` | FastH3 **DMD2 8-step** distilled **checkpoint** (~22 GB) | Not a LoRA — a separate student checkpoint. Native ComfyUI node `FastH3` needs **ComfyUI 0.36.0+**. ([FastH3 docs](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fastvideo)) |
| `barelymining/ComfyUI-MiniMax-H3-FastVideo` | `fasth3_vsa_v5.safetensors` (2.05 GB, LoRA) + `fasth3_vsa_gate.safetensors` (3.6 GB) | Experimental 4-step VSA; **requires a companion custom node** (a normal LoRA loader cannot add the `to_gate_compress` layers it needs). |

**Style / character / camera / motion LoRAs:**

- `fal/MiniMax-H3-Realism-People-LoRA` — **verified** HF repo (`pipeline_tag: image-text-to-video`), file `h3-realism-people-t2v-i2v-r2v.safetensors`, trigger word `r34l1sm`. Improves faces, skin texture, handheld documentary feel. Standard H3 key layout, loads as-is. ([HF page](https://huggingface.co/fal/MiniMax-H3-Realism-People-LoRA))
- `camera_motion_h3` (Civitai) — a camera-movement LoRA trained to compensate for weak camera control in base H3; recommend `strength_model` 0.8–1.0. ([CivArchive listing](https://civitaiarchives.com/models/2914784))
- `Minimax-h3_Third_person_view` (Civitai) — third/first-person camera + game-HUD LoRA. ([Civitai](https://civitai.com/models/2945172/minimax-h3thirdpersonview))
- `InstantX/MiniMax-H3-Turbo-Lora-Diffusers` — verified HF repo (Diffusers-format turbo).
- **Embeddings** (not LoRAs, but the intended mechanism for "effects"): `Comfy-Org/MiniMax-H3/embeddings/` ships `minimaxh3_kiss_camera`, `minimaxh3_bullet_time`, `minimaxh3_blooming_flowers`, `minimaxh3_art_is_explosion`, `minimaxh3_fire_breath`, `minimaxh3_four_seasons`, `minimaxh3_spiral_ascent`, `minimaxh3_dark_magic`, `minimaxh3_storm_magic`, `minimaxh3_truman_show` (all verified). Used as `embedding:minimaxh3_<name>` in a text prompt.

**⚠ Honesty caveat on "style / character / motion" categories:** a directory site (`minimax3.org/minimax-h3-lora`) lists generic *archetypes* — "H3 Character Consistency LoRA", "H3 Motion Enhancement LoRA", "H3 Camera Behavior LoRA" — with recommended strengths/steps. I could **not** verify any specific downloadable file bearing those exact names; treat that page as a **category directory**, not a list of confirmed models. For **character consistency**, H3's intended mechanism is **Ref2VA reference conditioning** (reference images carry identity across frames), often combined with the *ref2v* turbo LoRA — not a dedicated character LoRA. Example: the "H3 Look Sheets" workflow uses `MiniMaxH3ReferenceToVideo` + the 4-step turbo LoRA for character/outfit sheets. ([Civitai](https://civitai.com/models/2966775/h3-look-sheets))

**⚠ Unverified name:** a repo `MiniMaxAI/MiniMax-H3-Turbo-Lora` is referenced by a third-party repo, but it returned **HTTP 401 (not publicly accessible)** when queried. I **cannot confirm it exists**. The verifiable official turbo LoRA is `lightx2v/Minimax-h3-Turbo`.

---

## 3. Do I2V / first-last-frame variants exist? (yes — this is the workflow you want)

**Yes, and this is exactly the mode built for "generate a still, curate it, then animate it":**

- **H3 FL2VA checkpoint** supports **first-frame-only I2V** (`i2va`), so a single curated still can be the opening frame.
- In ComfyUI, connect an image to **`first_frame`** on `MiniMaxH3ImageToVideo` → I2V; connect a second to **`last_frame`** → first-last-frame interpolation; leave both empty → T2V. **This is already how the code is wired** (`shot.firstFrameFile` / `shot.lastFrameFile`).
- **`MiniMaxH3AddGuide`** (ComfyUI PR #15439) lets you anchor an image (or short clip + audio) at **any frame index** on a continuous timeline, not just the ends — useful for keyframe-driven curation. ([native docs](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native))
- Via the **hosted API v2** (`platform.minimax.io`), I2V and first-last-frame are first-class: pass `image_url` with `role: "first_frame"` / `"last_frame"`, model `MiniMax-H3`. ([API reference](https://platform.minimax.io/docs/api-reference/video-generation-v2-create))

**Implication for the pipelined workflow:** H3 does **not** ship an image *generator* — H3 only *animates* images. To "generate a still then animate it," you pair an image model (Flux / SDXL / Qwen-Image, any ComfyUI image graph) with H3's I2V/FL2V as the second stage. The existing `minimax-graph.ts` already accepts `firstFrameFile`, so the animate step needs no architectural change — just feed it the curated still.

---

## 4. Practical requirements

**Model files (verified in `Comfy-Org/MiniMax-H3`, sizes are exact from the HF API):**

```
ComfyUI/models/
├── diffusion_models/   minimax_h3_fl2va_pruned_int8_convrot.safetensors   20.97 GB   ← recommended
│                       minimax_h3_fl2va_pruned_fp8_scaled.safetensors     20.96 GB   ← code default (fallback)
│                       minimax_h3_fl2va_pruned_w6a8.safetensors           15.98 GB
│                       minimax_h3_fl2va_pruned_bf16.safetensors           40.23 GB
│                       minimax_h3_fl2va_int8_convrot.safetensors          34.04 GB
│                       minimax_h3_fl2va_bf16.safetensors                  66.28 GB
│                       (matching minimax_h3_ref2va_* set for reference mode)
├── text_encoders/      qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors       15.69 GB   ← code default
│                       qwen3vl_32b_minimax_h3_int8_convrot.safetensors    27.14 GB
│                       qwen3vl_32b_minimax_h3_bf16.safetensors            51.51 GB
├── vae/                minimax_h3_video_vae_fp16.safetensors                5.21 GB   ← code default
│                       minimax_h3_video_vae_int8_convrot.safetensors        2.81 GB
│                       minimax_h3_audio_vae_fp32.safetensors                0.61 GB   ← code default
├── loras/              (the turbo LoRAs in §2c)
├── model_patches/      minimax_h3_fun_controlnet_union_*.safetensors                 (ControlNet Union)
└── embeddings/         minimaxh3_*.safetensors                                       (effect embeddings)
```

**Every default filename in the current code is a real file** — including `minimax_h3_video_vae_fp16.safetensors` (5.21 GB; the int8 variant is 2.81 GB). Source: [Comfy-Org/MiniMax-H3 file tree](https://huggingface.co/Comfy-Org/MiniMax-H3).

**VRAM (MiniMax publishes no single official minimum; these are verified community measurements):**

| VRAM | Feasibility | Setup |
|---|---|---|
| 12 GB (RTX 3060) | Yes, **heavy offloading** | pruned int8 + nvfp4 encoder, low megapixels, short duration |
| 16 GB | Yes | same stack; **NVFP4 DiT fits comfortably** on RTX 50-series (Blackwell) |
| 24 GB (3090/4090) | **Comfortable** | pruned int8 DiT, offload text encoder after encoding |
| 32 GB (5090) | Comfortable | pruned int8 resident, or NVFP4 for headroom |
| 48 GB+ | Full-quality | full int8 (34 GB) resident; bf16 (66 GB) = datacenter |

- Measured staged VRAM (RTX PRO 6000): **pruned int8 DiT ≈ 20.0 GB** @ 2.17 s/it; **pruned NVFP4 DiT ≈ 11.9 GB** @ 1.90 s/it. ([awesome-minimax-h3](https://github.com/iSk2y/awesome-minimax-h3))
- Official framing: full-precision footprint **123.6 GB → 42.5 GB** with the pruned int8 release (+ nvfp4 encoder + both VAEs), and with dynamic offloading H3 can "run locally on a GPU like the RTX 3060." ([comfyui-wiki 2026-08-03](https://comfyui-wiki.com/en/news/2026-08-03-minimax-h3-open-weights-comfyui))
- **Real RTX 4090 test:** ~46 GB peak for a 20 s / 608×352 clip, ~6 min per 20 s clip; run **one H3 job at a time** on a 24 GB card. ([minimaxh3.co](https://minimaxh3.co/open-source/comfyui))
- **Known failure mode:** very short clips (1–2 s) can OOM because ComfyUI's VRAM estimate is optimistic; mitigation is launching with **`--reserve-vram 1`** (or a larger value). ([ComfyUI issue #15663](https://github.com/Comfy-Org/ComfyUI/issues/15663))
- **ComfyUI version:** 0.30.0+ for the base T2V/I2V/R2V templates; 0.34.0 for Multiframe Reference; 0.35.0 for Fun ControlNet Union / sparse attention / attention backend; **0.36.0 for FastH3**. ([ComfyUI guide](https://docs.comfy.org/tutorials/video/minimax/minimax-h3))

**Where models are distributed:**
- **Official (Diffusers format):** `MiniMaxAI/MiniMax-H3` on Hugging Face (33B; `FL2VA/` and `Ref2VA/` subfolders, each self-contained with processor/tokenizer/text_encoder/transformer/visual VAE/audio VAE). Mirrored on **ModelScope**. ([HF card](https://huggingface.co/MiniMaxAI/MiniMax-H3))
- **ComfyUI repacks:** `Comfy-Org/MiniMax-H3` (the repo the templates pull from).
- **Distillations:** `lightx2v/Minimax-h3-Turbo` (+ `-SLA`), `Kijai/MiniMax-H3_comfy`, `FastVideo/FastVideo-FastH3-Comfy`, `larryvrh/MiniMax-H3-Turbo-Lora`.
- **ControlNet Union:** `alibaba-pai/MiniMax-H3-Fun-Controlnet-Union` (verified, 11k+ downloads), repacked in Comfy-Org as `model_patches/`.
- **License:** **MiniMax H3 Community License** — free non-commercial; commercial allowed for companies under **$20M annual revenue**; **excludes the US, EU, UK, and South Korea** for local use. Local **commercial** use requires a paid MiniMax commercial license, sold through **Comfy** (the only official reseller); Comfy Cloud generations already include commercial rights. ([docs](https://docs.comfy.org/tutorials/video/minimax/minimax-h3), [license Q&A](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/QA-about-License.md))

---

## 5. Honest comparison for the "animate a curated still" step

All of these are **open-weight I2V-capable** alternatives to MiniMax H3 for stage 2 of the workflow. VRAM figures are community/official-repo ranges, not vendor marketing.

| Model | Params | I2V? | Native audio | Practical VRAM | Licence | License/quality notes |
|---|---|---|---|---|---|---|
| **MiniMax H3 (I2V/FL2V)** | 33B | ✅ (first / last / both) | ✅ stereo | ~12 GB w/ heavy offload → 24 GB comfortable; ~46 GB peak measured at 20s on a 4090 | MiniMax H3 Community (excludes US/EU/UK/KR for local use) | Strongest instruction-following + **only one here with native synced audio**; heaviest (≈42 GB disk). |
| **WAN 2.2 I2V-A14B** | 27B MoE (~14B/expert) | ✅ | ❌ | **24 GB** (or 14–16 GB with sequential offload); GGUF Q4 ~12 GB | **Apache 2.0** | Best balance of quality/speed/licence; Lightning 4-step LoRA cuts a 480p 5 s clip to ~1–3 min on a 4090. ([ComfyUI Wan2.2](https://docs.comfy.org/tutorials/video/wan/wan2_2), [Lightning](https://huggingface.co/lightx2v/Wan2.2-Lightning)) |
| **WAN 2.2 TI2V-5B** | 5B | ✅ | ❌ | **~8–12 GB** | Apache 2.0 | Lowest-friction WAN option; fits comfortably on consumer cards with offloading. |
| **LTX-Video (2.x / 2.3)** | ~2B → 22B | ✅ | ✅ (LTX-2 generation) | 2B: ~6–8 GB (FP8+tiling); 13B: 14–18 GB; 22B: 16–32 GB | LTX-2 Community / OpenRAIL | Fastest per clip; native audio from the LTX-2 line. Best speed-per-VRAM. ([comparison](https://loremotion.com/blog/best-open-source-ai-video-models-2026)) |
| **HunyuanVideo 1.0 (13B)** | 13B | ✅ | ❌ | **60–80 GB** (OOM risk at exactly 80 GB) | Tencent Community | Top single-GPU motion realism, but datacenter-class hardware. ([guide](https://www.spheron.network/blog/ai-video-generation-gpu-guide/)) |
| **HunyuanVideo 1.5 (8.3B)** | 8.3B | ✅ | ❌ | **~14 GB** (FP8 + text-encoder offload) | Tencent Community (excludes EU/UK/KR) | The "runs on a 4090" Hunyuan; step-distilled I2V <75 s on a 4090. ([thundercompute](https://www.thundercompute.com/blog/best-open-source-ai-video-generation-models)) |
| **CogVideoX-1.5-5B** | 5B | ✅ | ❌ | ~16–24 GB (FP8); 2B ~8–12 GB | Apache 2.0 | Cheapest/lowest-VRAM floor, best prompt adherence, but lowest motion quality; ~6 s clips. |

**Recommendation for this pipeline (honest read):**
- If the goal is **visual quality + native synchronized audio** and the machine/licence permits, **H3 I2V** stays the target — feed the curated still as `first_frame`. Budget for the ≈42 GB disk footprint and run one job at a time on a 24 GB card.
- If you want the **least VRAM/effort for the animate step** with a permissive licence, **WAN 2.2 I2V** (A14B with Lightning LoRA, or TI2V-5B) is the pragmatic default and is genuinely competitive on still-image animation. No audio, though — pair with a separate audio stage (which the Director Dashboard already separates conceptually).
- **LTX-Video** is the pick when speed matters most and you still want audio.

**Architectural note:** the code's separate video-VAE + audio-VAE + `VAEDecodeAudio` path is **H3-specific** — the WAN/LTX/Hunyuan/CogVideoX alternatives are video-only (except LTX-2) and would need a different graph, not an H3 graph with different weights. So a swap of the animate model is a graph change, not a filename change.

---

## 6. Caveats / things I could NOT verify (do not treat as fact)

1. **`MiniMaxAI/MiniMax-H3-Turbo-Lora`** — referenced by third-party repos, but **HTTP 401** on the HF API; **unverified**. Use `lightx2v/Minimax-h3-Turbo` instead.
2. **"H3 Character Consistency LoRA" / "H3 Motion Enhancement LoRA" / "H3 Camera Behavior LoRA"** — listed as *archetypes* on a directory site with suggested strengths (character 0.6–0.9; motion 0.5–0.8; camera 0.4–0.7), but **no specific downloadable file with those names was verified**. Treat as categories. For identity locking, use **Ref2VA reference conditioning**.
3. **Node-name drift:** the code uses `MiniMaxH3SigmaShift`, while the LightX2V wiki and ComfyUI docs reference `ModelSamplingMiniMaxH3` for the video/audio shift. Verify the exact node id against your installed ComfyUI version — sigma-shift node naming has varied across releases.
4. **VRAM numbers are community-measured** — MiniMax publishes no single official consumer minimum; ComfyUI's offloading means "runs" ≠ "runs at usable speed."
5. **Version/quality:** the LightX2V turbo line moved fast (v0.1 → v1.0 → v1.1 → v1.2). v1.2 traded some visual quality for cleaner audio per early testers; if video quality outweighs audio, v1.1 was preferred in the release discussion.

---

### Primary sources
- MiniMax H3 official model card — https://huggingface.co/MiniMaxAI/MiniMax-H3
- Comfy-Org/MiniMax-H3 (ComfyUI repack) — https://huggingface.co/Comfy-Org/MiniMax-H3
- ComfyUI H3 guide — https://docs.comfy.org/tutorials/video/minimax/minimax-h3
- ComfyUI H3 native workflows — https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native
- FastH3 — https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fastvideo
- Kijai converted LoRAs — https://huggingface.co/Kijai/MiniMax-H3_comfy
- LightX2V turbo LoRAs — https://huggingface.co/lightx2v/Minimax-h3-Turbo / -SLA
- Hailuo 02 — https://www.minimax.io/news/minimax-hailuo-02 ; Hailuo 2.3 — https://minimax.io/news/minimax-hailuo-23
- MiniMax API release notes — https://platform.minimax.io/docs/release-notes/apis
- Model naming (H3 = Hailuo 3.0/03) — https://huggingface.co/blog/ResterChed/minimax-h3-hailuo-3-0
- WAN 2.2 ComfyUI — https://docs.comfy.org/tutorials/video/wan/wan2_2 ; Wan Lightning — https://huggingface.co/lightx2v/Wan2.2-Lightning
- Open-model VRAM comparison — https://www.spheron.network/blog/ai-video-generation-gpu-guide/ ; https://loremotion.com/blog/best-open-source-ai-video-models-2026
