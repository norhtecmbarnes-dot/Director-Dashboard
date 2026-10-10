# 04 — Open-Source Talking-Head / Avatar / Lip-Sync Software for a Local AI Video Pipeline

**Project:** Director Dashboard (Next.js/TypeScript, `C:\ai\proposal genie\Director-Dashboard`)
**Prepared:** October 2026
**Scope:** Open-source (or source-available) talking-head / avatar / lip-sync engines that could replace or supplement the current `HeyGenTalkingPhotoNode` (HeyGen is a commercial, closed service) in a **local-first, ComfyUI-driven** video pipeline on **Windows + consumer NVIDIA GPU**.

> This report deliberately separates **verified** licence facts (cited to the repo/model card that states them) from **unverified / conflicting** ones. Where a licence could not be confirmed, it is called out explicitly rather than guessed.

---

## 0. TL;DR — the recommendation

| Goal | Pick this first | Why |
|---|---|---|
| **"A photo + an audio track → a talking head video"** (fast, commercial-safe, consumer GPU, drives like the existing ComfyUI graphs) | **EchoMimic V3** (Ant Group) | Native *image + audio → video*, Apache-2.0 (commercial OK), 1.3B model runs at **12 GB VRAM** (768×768, 8 steps), actively maintained (released Aug 2025), and has a mature ComfyUI node (`smthemex/ComfyUI_EchoMimic`). Drops straight into the `buildLocalAvatarGraph` pattern. |
| **High-quality character performance** (cinematic, full-body, slower) | **Wan2.2-S2V-14B** (Alibaba Tongyi) | Apache-2.0, **native ComfyUI support**, "cinematic" speech-to-video (face + body + camera), and it is already in the same model family the app drives (`WanInfiniteTalkToVideo`). Heavy (24 GB+ realistically) and slow, but the strongest open, commercial-safe quality tier in 2025–2026. |
| **Fast real-time lip-sync polish on an existing video** (lightest tier) | **MuseTalk 1.5** (Tencent Music) | MIT (fully commercial-clean), genuinely real-time (**30+ FPS**, ~4 GB fp16), single-step latent inpainting. *Video-driven* — used as a refinement pass, not a photo→head generator. |

**The core trade-off** the user must weigh:
- **Fast / low-latency tier (< 10–12 GB, seconds-to-minutes):** LivePortrait, MuseTalk, Wav2Lip, SadTalker, EchoMimic V3, LatentSync 1.5. Most are **video-driven** (they re-dub or animate an existing face), which means a two-stage pipeline: generate/track a face first, then lip-sync.
- **High-quality tier (24 GB+, minutes per clip):** Wan2.2-S2V, HunyuanVideo-Avatar, FantasyTalking, InfiniteTalk/MultiTalk, EchoMimic V2, Hallo3. Diffusion-transformer based; photoreal and full-body, but slow and VRAM-hungry.

---

## 1. How the app drives avatars today (integration context)

Two ComfyUI graph builders exist in the repo, plus a standalone REST client:

- `src/lib/comfyui/avatar-graph.ts` — builds a graph whose single node is **`class_type: 'HeyGenTalkingPhotoNode'`** (photo + text/audio → video). **HeyGen is a commercial cloud service — this is the node the user wants to replace.**
- `src/lib/comfyui/local-avatar-graph.ts` — a **fully local** two-stage graph: Qwen-Image (or an uploaded photo) → `WanInfiniteTalkToVideo` (Wan based, Kijai WanVideoWrapper) + audio encoder → video. This is already an **open-source path** (InfiniteTalk is Apache-2.0), just heavy.
- `src/lib/duix/client.ts` + `components/minimax-h3/ClonePanel.tsx` — a **"Duix.Avatar clone" mode** that talks to a local Duix.Avatar Docker stack over REST (`/v1/invoke` TTS, `/easy/submit` video), fully offline.

**Implication:** anything that ships a **ComfyUI custom node** can be driven exactly the way the app already drives ComfyUI (build a graph, POST to `/prompt`, poll history). So ComfyUI-node availability is the single biggest integration lever, and it is a column in every entry below.

---

## 2. Detailed options

### 2.1 LivePortrait

- **What it does:** Video-driven portrait animation (implicit-keypoint / FOMM lineage). Transfers expression, pose, eye-gaze and lip motion from a **driving video** onto a still portrait or video, with a stitching module and eye/lip retargeting MLPs. **Not natively audio-driven** — to go audio→head you pair it with an audio-to-motion front end (see **JoyVASA**, §2.15) or a driving clip.
- **Licence:** **MIT** for code and weights — **but** it uses InsightFace `buffalo_l` detection models, which are **non-commercial research only**, and the animals mode uses **X-Pose** (also non-commercial). The repo's own LICENSE says: for commercial use you must remove/replace InsightFace detection models (e.g. MediaPipe / FaceAlignment). **Commercial use is therefore permitted only after swapping the detection models.**
- **Quality:** Very high for expression/pose fidelity; extremely light and fast. Video-driven motion, so realism depends on the driver.
- **VRAM/hardware:** ~522 MB fp32 weights (~261 MB fp16 resident); a single stream fits in **< 4 GB**. `speed.py` on RTX 4090 ≈ **14.77 ms/frame (~68 FPS pure model)**; **FasterLivePortrait** (TensorRT) hits **30+ FPS on RTX 3090** including pre/post. Windows caveat: the repo warns CUDA 12.4/12.6 on Windows cause problems — drop to **CUDA 11.8**.
- **ComfyUI or standalone:** Both. ComfyUI: **`kijai/ComfyUI-LivePortraitKJ`** (+ `Quasimondo` fork). Standalone Gradio app + `FasterLivePortrait`.
- **Maturity:** Very high — one of the most-starred avatar projects; battle-tested, though the core model is stable rather than fast-moving (2024-era).
- **Commercial use:** Yes, with the InsightFace/X-Pose replacement caveat.

Sources: https://github.com/KlingAIResearch/LivePortrait · https://github.com/KlingAIResearch/LivePortrait/blob/main/LICENSE · https://github.com/kijai/ComfyUI-LivePortraitKJ · https://github.com/warmshao/FasterLivePortrait · https://github.com/KwaiVGI/LivePortrait/issues/150

### 2.2 EchoMimic V1 / V2 / V3 (Ant Group / Alipay)

- **What it does:**
  - **V1** (AAAI 2025): audio-driven portrait animation with editable **landmark conditioning** — photo + audio (+ optional pose) → talking face.
  - **V2** (CVPR 2025): "striking, simplified, semi-body" human animation — head **and hands**, audio-driven, with reference-image + pose conditioning. Accelerated inference is ~9× faster than v1-era.
  - **V3** (Aug 2025): unified multi-modal/multi-task human animation with only **1.3B parameters**; image + audio → video, 768×768.
- **Licence:** **Apache-2.0** (all three repos and the HF model card). Commercial use permitted; the V3 card explicitly claims no rights over generated content.
- **Quality:** Strong, especially V3 which is trained on **Wan 2.1-Fun** and is competitive with far larger models. V2 adds hand/gesture motion.
- **VRAM/hardware:** **V3 is the consumer sweet spot** — the project states **12 GB VRAM** generates video (768×768 at 8 steps, needs `block_offload` on); 768×512 works in **6.5 GB**. The ComfyUI node reports V3 running on 8 GB+ with `mmgp`/low-VRAM and `partial_video_length` chunking. V2 on Windows ~8 GB with sharded inference. Tested GPUs: A100, RTX 4090D, V100.
- **ComfyUI or standalone:** Both. ComfyUI: **`smthemex/ComfyUI_EchoMimic`** (supports V1/V2/V3; official repo links it for V3 on 16 GB); also `AIFSH/EchoMimicV2-ComfyUI` and `lieding/ComfyUI_EchomimicV3_DL` (V3-flash).
- **Maturity:** Actively maintained (V3 shipped Aug 2025; V2 accepted at CVPR 2025). The **single most actively developed "photo+audio→head" family** here.
- **Commercial use:** Yes (Apache-2.0).

Sources: https://github.com/antgroup/echomimic · https://github.com/antgroup/echomimic_v2 · https://github.com/antgroup/echomimic_v3 · https://github.com/antgroup/echomimic_v3/blob/main/README.md · https://github.com/smthemex/ComfyUI_EchoMimic · https://comfy.icu/node/ComfyUI_EchoMimic_DL_LoadModel

### 2.3 Hallo 1 / 2 / 3 (Fudan + Baidu)

- **What it does:** Hierarchical audio-driven portrait animation. **Hallo (v1)** — audio-driven visual synthesis, photo + audio → talking face. **Hallo2** (ICLR 2025) — long-duration, high-resolution (up to 4K; demoed a 23-min clip). **Hallo3** (CVPR 2025) — highly dynamic portrait animation built on a **Video Diffusion Transformer** (fine-tuned from CogVideoX-5B I2V).
- **Licence:**
  - **Hallo v1:** **MIT** (repo LICENSE file).
  - **Hallo2:** **MIT** (repo LICENSE), **except** the high-resolution module which is a modified CodeFormer under **S-Lab License 1.0**.
  - **Hallo3:** Repo LICENSE is **MIT**, **but** the weights are a **derivative of CogVideoX-5B I2V**, so their use/distribution is governed by the **CogVideoX License** — which permits free commercial use **only after registering for a basic commercial licence**, and only up to **1M visits/month** (contact the team beyond that). So Hallo3 is *not* a clean Apache/MIT commercial path.
- **Quality:** High; Hallo3 is very dynamic (head motion + background). Historically A100-class in practice.
- **VRAM/hardware:** Hallo/Hallo2 tested on **A100 (80 GB)** in the official setup; community Windows/ComfyUI builds run lower but expect 16–24 GB+. Hallo3 built on CogVideoX-5B (which itself runs on a 3060 with quantisation, but not at avatar scale).
- **ComfyUI or standalone:** Both. ComfyUI: **`hay86/ComfyUI_Hallo`**, **`AIFSH` Hallo/JoyHallo** nodes, **`ShmuelRonen/ComfyUI-JoyHallo_wrapper`** (for the JoyHallo Chinese variant). No well-maintained Hallo3 ComfyUI node as of writing.
- **Maturity:** v1/v2 stable but slowing; Hallo3 (2025) active research, less tooling.
- **Commercial use:** v1/v2 yes (MIT, watch CodeFormer module); **Hallo3 — conditional (CogVideoX License, registration + volume cap)**.

Sources: https://github.com/fudan-generative-vision/hallo/blob/main/LICENSE · https://github.com/fudan-generative-vision/hallo2/blob/main/LICENSE · https://github.com/fudan-generative-vision/hallo3/blob/main/LICENSE · https://huggingface.co/fudan-generative-ai/hallo3 · https://github.com/THUDM/CogVideo/blob/main/LICENSE · https://huggingface.co/vdo/CogVideoX-5b/blob/main/LICENSE

### 2.4 MuseTalk (Tencent Music / TMElyralab)

- **What it does:** **Real-time, high-quality lip-sync via single-step latent-space inpainting** (not diffusion). Re-syncs the lower face / mouth region of an existing face video to a new audio track; a frozen `sd-vae-ft-mse` + `whisper-tiny` + an SD1.4-derived UNet (~0.85B) do the work in **one forward pass per frame**. Also used for image→talking-head when paired with an animator/MuseV.
- **Licence:** **MIT** — and this is the cleanest licensing story of the whole list. All components are commercial-compatible: MuseTalk MIT, SD-VAE-ft-MSE CreativeML Open RAIL-M, Whisper MIT, DWPose Apache-2.0, face-parse-bisent MIT, ResNet18 BSD-3.
- **Quality:** High for the 256×256 face region; excellent sync accuracy and identity preservation; multi-language.
- **VRAM/hardware:** ~3.6–4 GB in fp16; **8 GB recommended** for 30+ FPS real-time. Officially **30+ FPS on a Tesla V100**; runs on a laptop RTX 3050 Ti 4 GB in fp16. Windows supported (needs the mmcv/mmpose ecosystem: `mmengine`, `mmcv==2.0.1`, `mmdet`, `mmpose`).
- **ComfyUI or standalone:** Both. ComfyUI: **`chaojie/ComfyUI-MuseTalk`**, **`kijai/ComfyUI-MuseTalk-KJ`** (native implementation), **`AIFSH/ComfyUI-MuseTalk_FSH`**.
- **Maturity:** Very active and widely deployed; MuseTalk 1.5 is the recommended version.
- **Commercial use:** **Yes (MIT)** — the safest commercial lip-sync option.

Sources: https://github.com/TMElyralab/MuseTalk · https://huggingface.co/TMElyralab/MuseTalk · https://github.com/TMElyralab/MuseTalk/blob/main/LICENSE · https://github.com/kijai/ComfyUI-MuseTalk-KJ · https://github.com/chaojie/ComfyUI-MuseTalk

### 2.5 LatentSync (ByteDance)

- **What it does:** End-to-end **audio-conditioned latent-diffusion lip-sync** (no intermediate motion representation). Whisper → audio embeddings → cross-attention into a Stable-Diffusion-derived U-Net. Re-syncs an existing video's lips to new audio (video-driven). Includes TREPA temporal consistency and a full data/processing toolchain + training code.
- **Licence:** **Apache-2.0** (repo LICENSE).
- **Quality:** High; v1.6 specifically targets the earlier "blurriness" criticism. Strong for live-action; currently **does not do anime/cartoon faces** well (per the Windows ComfyUI node).
- **VRAM/hardware:** **8 GB with LatentSync 1.5**, **18 GB with LatentSync 1.6**. ~6.5 GB cited for inference in some community docs. Community node auto-adjusts batch size by VRAM.
- **ComfyUI or standalone:** Both. ComfyUI: **`ShmuelRonen/ComfyUI-LatentSyncWrapper`** (1.6, Windows/WSL), **`GeekyGhost/ComfyUI-Geeky-LatentSyncWrapper`** (1.5, optimised), **`iVideoGameBoss/ComfyUI-LatentSync-Node`**. Note 1.6 models require **manual** download from a gated HF repo.
- **Maturity:** Active (Dec 2024 → 2025 iterations; 6k+ stars).
- **Commercial use:** Yes (Apache-2.0).

Sources: https://github.com/bytedance/LatentSync · https://github.com/bytedance/LatentSync/blob/main/LICENSE · https://github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper · https://comfyui-wiki.com/en/news/2025-01-04-latentsync-bytedance-lipsync-tool

### 2.6 SadTalker

- **What it does:** The classic **single portrait image + audio → talking head video** (CVPR 2023), via 3D motion coefficients. Includes a `--still` full-image mode and GFPGAN face enhancement.
- **Licence:** **Apache-2.0** — the repo explicitly **removed the earlier non-commercial restriction** ("The license has been updated to Apache 2.0, and we've removed the non-commercial restriction"). Commercial use permitted.
- **Quality:** Good but dated (2023). Smoother/less dynamic than 2025 diffusion models; best on real human portraits.
- **VRAM/hardware:** Low — runs comfortably on ~4–6 GB; historically runs on modest GPUs. Windows has a `start.bat` path.
- **ComfyUI or standalone:** Both. ComfyUI: **`haomole/Comfyui-SadTalker`**, plus third-party nodes (e.g. `sonukkc1312/comfyui-sadtalker`). Standalone Gradio/CLI.
- **Maturity:** Stable/mature but **no longer fast-moving** — largely superseded by EchoMimic/LatentSync/Hallo. Still the safest "it just works" baseline.
- **Commercial use:** Yes (Apache-2.0).

Sources: https://github.com/OpenTalker/SadTalker · https://github.com/OpenTalker/SadTalker/blob/main/LICENSE · https://github.com/haomole/Comfyui-SadTalker

### 2.7 Wav2Lip

- **What it does:** The original 2020 lip-sync model (lip expert discriminator); re-syncs an existing face video to audio. Low-res (96×96), ~5 FPS.
- **Licence:** **NOT open for commercial use.** Trained on the LRS2 dataset; the repo states results "should only be used for research/academic/personal purposes only… any form of commercial use is strictly prohibited." A commercial HD model exists but is only available by contacting the authors / Sync.so.
- **Quality:** Dated and visibly low-res compared with MuseTalk/LatentSync.
- **VRAM/hardware:** Very light (< 2–4 GB).
- **ComfyUI or standalone:** Both; many ComfyUI wrappers exist.
- **Maturity:** Effectively frozen (2020).
- **Commercial use:** **NO.** Included here only because it is commonly cited — **do not ship it commercially.**

Sources: https://github.com/Rudrabha/Wav2Lip · https://github.com/Rudrabha/Wav2Lip/blob/d07fc4d8/README.md?plain=1

### 2.8 Sonic (Tencent)

- **What it does:** Audio-driven portrait animation that "shifts focus to global audio perception" — intra-/inter-clip audio perception, time-aware position-shift fusion for long audio. Photo + audio → vivid portrait animation (CVPR 2025).
- **Licence:** **CC-BY-NC-SA-4.0 — NON-COMMERCIAL.** The repo states: "our license is non-commercial. If commercialization is required, please use Tencent Cloud Video Creation Large Model" (a paid API). The ComfyUI wrapper (MIT) does not change the model licence.
- **Quality:** Strong portrait animation and lip-sync for its size.
- **VRAM/hardware:** Community reports ~10 GB+ (diffusion-based).
- **ComfyUI or standalone:** Both. ComfyUI: **`smthemex/ComfyUI_Sonic`** (MIT, 1.1k stars).
- **Maturity:** Active research (2025); ComfyUI node maintained by a third party.
- **Commercial use:** **NO** (non-commercial licence) — commercial only via Tencent Cloud.

Sources: https://github.com/jixiaozhong/Sonic · https://github.com/jixiaozhong/Sonic/blob/main/README.md · https://github.com/smthemex/ComfyUI_Sonic

### 2.9 FantasyTalking (Alibaba AMAP)

- **What it does:** Realistic talking-portrait generation via coherent motion synthesis — audio-driven lip + expression + head/pose, built on **Wan2.1-I2V-14B** with Wav2Vec audio encoding (ACM MM 2025).
- **Licence:** **Apache-2.0** (HF card + community trackers). Commercial use permitted.
- **Quality:** High (photo/character; uses the strong Wan 2.1 14B backbone).
- **VRAM/hardware:** 14B backbone → realistically **24 GB+** for full precision (quantised GGUF paths exist but a community GGUF fork notes the FantasyTalking model **couldn't be quantised**, so that repo "doesn't work" — treat low-VRAM quantisation as unproven).
- **ComfyUI or standalone:** Both. ComfyUI: integrated into **`kijai/ComfyUI-WanVideoWrapper`** (`fantasytalking/` nodes); standalone `infer.py`. (`kael558/ComfyUI-GGUF-FantasyTalking` is broken.)
- **Maturity:** New (2025), active.
- **Commercial use:** Yes (Apache-2.0).

Sources: https://github.com/Fantasy-AMAP/fantasy-talking · https://huggingface.co/acvlab/FantasyTalking · https://github.com/kael558/ComfyUI-GGUF-FantasyTalking

### 2.10 Duix.Avatar (Duix.com) — **already integrated in the app**

- **What it does:** A full **offline AI avatar / digital-human toolkit**: clone appearance + voice, then drive the avatar with **text or speech** to produce videos. Electron desktop app + Docker stack, ASR via fun-asr, TTS via fish-speech-ziming. Designed for **Windows** (and Ubuntu 22.04) with NVIDIA acceleration. The app already talks to it via `src/lib/duix/client.ts` (REST: TTS `/v1/invoke`, video `/easy/submit` + `/easy/query`) — the "Duix.Avatar clone" mode in `ClonePanel.tsx`.
- **Licence:** **DUIX.COM Community License** (not an OSI licence). Free for use/modification/distribution **including commercial use below a user threshold** — but the **thresholds conflict across documents**: the LICENSE file text says commercial licence required above **1,000 monthly active users**, while the repo README/v1.0.3-Lite notes say free commercial use up to **100,000 users / $10M annual revenue**. **Models are governed by a separate agreement** (two PDFs, "Duix.Avatar model community Licensing Agreement", EN + ZH) — so **code and models are not under the same terms**. Attribute "Built with DUIX.COM". **Verify the model agreement before commercial deployment.**
- **Quality:** Production-grade for non-real-time talking-head video synthesis (its core competency).
- **VRAM/hardware:** Runs as a Docker service on Windows + NVIDIA GPU; **fully offline**. (Specific VRAM not stated in the repo; it is a heavier multi-container stack.)
- **ComfyUI or standalone:** **Standalone** (Docker + Electron + REST API). No ComfyUI node.
- **Maturity:** High — ~15k GitHub stars, 2.5k forks, active.
- **Commercial use:** Yes, **within the community-licence thresholds and subject to the separate model agreement** (flagged — not a clean permissive licence).

Sources: https://github.com/duixcom/Duix-Avatar · https://github.com/duixcom/Duix-Avatar/blob/main/LICENSE · https://github.com/duixcom/Duix-avatar/tree/main (README) · https://hysenlabs.com/projects/duixcom-duix-avatar · https://github.com/duixcom/Duix.Avatar/tree/v1.0.3-Lite

### 2.11 SadTalker successors — AniTalker, PD-FGC, JoyVASA

- **AniTalker** (`X-LANCE/AniTalker`, ACM MM 2024): identity-decoupled facial motion encoding — single portrait + audio → talking video with diverse expressions/head motion. **Licence: Apache-2.0** (trendshift/repo listing). Repo itself is cautious about production use. No first-class ComfyUI node found.
- **PD-FGC** (`Dorniwang/PD-FGC-inference`): progressive **disentangled** control of lip / head pose / gaze / emotion. **Licence: could not be verified** — treat as unknown; check before any use.
- **JoyVASA** (`jdh-algo/JoyVASA`): **MIT** — an audio-to-motion (wav2vec2/HuBERT) front end that drives the **LivePortrait** renderer, i.e. it turns LivePortrait into an **audio-driven** talking-head. This is the pragmatic way to make LivePortrait respond to audio. Caveat: inherits LivePortrait's **InsightFace non-commercial detection models** (swap to MediaPipe) and downloads ~8 GB+ of checkpoints. ComfyUI: available via `FasterLivePortrait`/community wrappers rather than a dedicated node.

Sources: https://github.com/X-LANCE/AniTalker · https://github.com/jdh-algo/JoyVASA · https://github.com/jdh-algo/JoyVASA/blob/main/LICENSE · https://github.com/warmshao/FasterLivePortrait/blob/master/README.md

### 2.12 NEW 2025–2026: Wan2.2-S2V-14B (Alibaba Tongyi)

- **What it does:** **Speech-to-video** — one identity image + audio (+ optional prompt and pose video) → lip + face + **body** + camera motion. Explicitly benchmarked above Hunyuan-Avatar and OmniHuman.
- **Licence:** **Apache-2.0** (repo + HF model card).
- **Quality:** Current open SOTA for cinematic, full-body character performance.
- **VRAM/hardware:** Official single-GPU floor is **80 GB**; ComfyUI/quantised builds run far lower but it is still a 14B MoE model — expect **24 GB+** realistically and slow inference.
- **ComfyUI or standalone:** Both — **native ComfyUI support** (inference, checkpoints, ComfyUI integration all ticked in the repo roadmap). Diffusers integration too.
- **Maturity:** New (Aug 2025), official and active.
- **Commercial use:** Yes (Apache-2.0).

Sources: https://github.com/Wan-Video/Wan2.2 · https://huggingface.co/Wan-AI/Wan2.2-S2V-14B · https://wan2.video/wiki/speech-to-video

### 2.13 NEW 2025–2026: HunyuanVideo-Avatar (Tencent)

- **What it does:** MM-DiT audio-driven human animation — dynamic, **emotion-controllable**, and **multi-character** talking avatar video (single or multiple people). Character image injection + Audio Emotion Module + Face-Aware Audio Adapter.
- **Licence:** **Tencent Hunyuan Community License Agreement** — free use/derivatives including commercial, with two big caveats: (1) it **does not apply in the EU, UK or South Korea** (territory-limited), and (2) a licence is required above **100M MAU**. So it is "open weights" but **not a permissive OSI licence** and is **region-restricted**.
- **Quality:** Very high; strong multi-character and emotion control.
- **VRAM/hardware:** Officially heavy; a community **Wan2GP** path claims **single-GPU at 10 GB** without quality loss.
- **ComfyUI or standalone:** Standalone officially; **ComfyUI is still unchecked/planned**. Third-party wrappers exist.
- **Maturity:** Active (May 2025); 2k+ stars.
- **Commercial use:** Yes **within the Territory (excludes EU/UK/South Korea)** and under 100M MAU.

Sources: https://github.com/Tencent-Hunyuan/HunyuanVideo-Avatar · https://github.com/Tencent-Hunyuan/HunyuanVideo-Avatar/blob/main/LICENSE · https://huggingface.co/tencent/HunyuanVideo-Avatar · https://arxiv.org/html/2505.20156v1

### 2.14 NEW 2025: OmniAvatar (Zhejiang Univ. + Alibaba)

- **What it does:** Efficient audio-driven avatar video with **adaptive body animation** — image + audio + text prompt → full/upper-body talking avatar. Built on **Wan2.1** (1.3B and 14B variants) with Wav2Vec audio encoding.
- **Licence:** **Apache-2.0** (repo `LICENSE.txt`).
- **Quality:** Good; the **1.3B variant is the consumer-friendly one**, 14B for quality.
- **VRAM/hardware:** ComfyUI node lists a **~4 GB base footprint (8 GB tier)**; 1.3B is the low-VRAM path.
- **ComfyUI or standalone:** Both. ComfyUI: **`CallMe1101/ComfyUI_OmniAvatar`** (all-in-one 14B + 1.3B). Standalone `scripts/inference.py`.
- **Maturity:** New (June 2025), community-wrapped.
- **Commercial use:** Yes (Apache-2.0).

Sources: https://github.com/Omni-Avatar/OmniAvatar · https://vramdb.com/nodes/callme1101/comfyui_omniavatar · https://comfy.icu/node/OmniAvatar-All-in-One-14B

### 2.15 NEW 2025: InfiniteTalk / MultiTalk (MeiGen-AI) — **partly already wired**

- **What it does:** Audio-driven talking-head generation built on **Wan** — **MultiTalk** (multi-speaker, up to 4 audio tracks) and its successor **InfiniteTalk** (long, continuous talking video via windowed sampling, past Wan's 81-frame limit). This is the family the app's `WanInfiniteTalkToVideo` node already uses.
- **Licence:** **Apache-2.0** (MultiTalk/InfiniteTalk on top of Apache-2.0 Wan).
- **Quality:** Widely rated above Wan's own S2V for continuous talking-head; strong lip-sync.
- **VRAM/hardware:** 14B Wan backbone → **24 GB+** and **slow** (community reports an InfiniteTalk clip "pushing well past an hour on a 4090" for a decent length). Runs on a 16 GB laptop with offload experiments, but not comfortably.
- **ComfyUI or standalone:** Both. ComfyUI: **`kijai/ComfyUI-WanVideoWrapper`** (`MultiTalkModelLoader`, `MultiTalkWav2VecEmbeds`, `WanVideoImageToVideoMultiTalk` — the app already emits the latter). Also `xuhongming251/ComfyUI-InfiniteTalk-MultiImage`.
- **Maturity:** Active; the de-facto open long-form talking-head path.
- **Commercial use:** Yes (Apache-2.0).

Sources: https://github.com/kijai/ComfyUI-WanVideoWrapper/blob/main/multitalk/nodes.py · https://comfy.icu/node/MultiTalkModelLoader · https://comfy.icu/node/WanVideoImageToVideoMultiTalk

### 2.16 NEW 2025: Wan2.2 Animate-14B (character animation/replacement)

- **What it does:** **Video-driven** character animation and replacement — animate any character from a performer's video, reproducing facial expressions/body motion; or swap a character into a video preserving lighting/motion. Native ComfyUI (Sep 2025).
- **Licence:** Wan base is **Apache-2.0**; the Animate-14B model is listed by a workflow repo as **OpenRAIL** — **conflicting with the Apache-2.0 base, so treat the exact Animate licence as unverified** and confirm on its model card before commercial use.
- **Quality:** High; best-in-class for *motion transfer* (not text-to-video).
- **VRAM/hardware:** **GGUF** builds run as low as **4 GB (Q4, 25 frames)**; comfortable at 12 GB.
- **ComfyUI or standalone:** **Native ComfyUI** (`WanAnimateToVideo`, workflow ships in ComfyUI).
- **Commercial use:** Likely yes, but **licence unverified — flag**.

Sources: https://blog.comfy.org/p/wan22-animate-and-qwen-image-edit-2509 · https://github.com/Thefrizzy1/The_frizzy1-Workflows/blob/main/workflows/wan2.2/animate/README.md

### 2.17 NEW 2025: SkyReels-A1 / A2 / Audio (Skywork / Kunlun)

- **What it does:** A1 — expressive portrait animation via video-diffusion transformer (CogVideoX-5b-I2V base); expression transfer from a driving video plus an **audio-driven pipeline** (Mar 2025). A2 — controllable multi-element video assembly (Apr 2025). SkyReels-Audio — omni audio-conditioned talking portraits (Jun 2025).
- **Licence:** **Conflicting** — the GitHub repo LICENSE is `other` (Skywork Community License), the HF model card says **Apache-2.0**. The Skywork Community License states commercial use is supported (registration/terms apply). **Treat the exact terms as unverified** and read the model card before commercial use.
- **Quality:** Good; human-centric foundation models.
- **VRAM/hardware:** CogVideoX-5B-class → **16–24 GB+** in practice.
- **ComfyUI or standalone:** Standalone (inference scripts). No first-class ComfyUI node confirmed.
- **Commercial use:** Supported per the Skywork Community License (verify).

Sources: https://github.com/SkyworkAI/SkyReels-A1 · https://huggingface.co/Skywork/SkyReels-A1 · https://huggingface.co/Skywork/SkyReels-A1/blob/main/LICENSE.txt

### 2.18 Other 2025–2026 entrants worth a bookmark

- **NanoAvatar** (2026) — on-device audio-driven talking avatars for Android + local NVIDIA GPUs. https://github.com/wpydcr/NanoAvatar
- **OpenAvatarChat** (HumanAIGC-Engineering) — modular interactive avatar chat (replaceable ASR/LLM/TTS/avatar backends). https://github.com/HumanAIGC-Engineering/OpenAvatarChat
- **AnyTalker** (HKUST, 2025) — multi-person talking video with interactivity refinement. https://github.com/HKUST-C4G/AnyTalker
- **OmniHuman / VASA-1 / Hunyuan-Avatar-API / HeyGen** — **closed/cloud**; deliberately excluded from the recommendation (the task is open-source, local-first).

Source for the survey: https://github.com/Kedreamix/Awesome-Talking-Head-Synthesis

---

## 3. Comparison table

| Tool | What it does | Licence (verified source) | Commercial OK? | ComfyUI node | Consumer GPU? | Speed tier | Maintained |
|---|---|---|---|---|---|---|---|
| **LivePortrait** | Video→portrait anim (not natively audio) | MIT, **InsightFace/X-Pose models non-commercial** | Yes* (swap detectors) | ✅ kijai/KJ | ✅ <4 GB | ⚡ real-time | Stable |
| **EchoMimic V1** | Photo+audio→head (AAAI'25) | Apache-2.0 | ✅ | ✅ smthemex | ✅ ~8–12 GB | balanced | Active |
| **EchoMimic V2** | Semi-body head+hands (CVPR'25) | Apache-2.0 | ✅ | ✅ AIFSH/smthemex | ✅ ~8–16 GB | balanced | Active |
| **EchoMimic V3** | Photo+audio→head, 1.3B (2025) | Apache-2.0 | ✅ | ✅ smthemex | ✅ **12 GB** | balanced | **Active (Aug'25)** |
| **Hallo v1** | Photo+audio→head | MIT | ✅ | ✅ hay86/AIFSH | ⚠ 16–24 GB | slow | Stable |
| **Hallo2** | Long/high-res head | MIT (+S-Lab for hires) | ✅* | ✅ | ⚠ 16–24 GB | slow | Stable |
| **Hallo3** | Dynamic head (VDT) | MIT code / **CogVideoX License weights** | ⚠ register + volume cap | ✗ (weak) | ⚠ 16–24 GB | slow | Active |
| **MuseTalk 1.5** | Real-time lip-sync (video) | **MIT (all components clean)** | ✅ | ✅ chaojie/KJ/FSH | ✅ **~4 GB** | ⚡ real-time | Very active |
| **LatentSync** | Diff. lip-sync (video) | Apache-2.0 | ✅ | ✅ ShmuelRonen/Geeky | ✅ 8 GB (1.5) / ⚠18 GB (1.6) | balanced | Active |
| **SadTalker** | Photo+audio→head (CVPR'23) | Apache-2.0 | ✅ | ✅ haomole | ✅ ~4–6 GB | balanced | Legacy |
| **Wav2Lip** | Lip-sync (video) | **Non-commercial (LRS2)** | ❌ | ✅ many | ✅ <4 GB | fast | Frozen |
| **Sonic** | Photo+audio→head (CVPR'25) | **CC-BY-NC-SA-4.0** | ❌ | ✅ smthemex | ⚠ ~10 GB | balanced | Active |
| **FantasyTalking** | Photo+audio→head (Wan14B) | Apache-2.0 | ✅ | ✅ WanVideoWrapper | ⚠ 24 GB+ | slow | Active |
| **Duix.Avatar** | Offline clone + text/speech→video | **DUIX.COM Community License** (models separate) | ⚠ thresholds | ✗ (standalone REST) | ⚠ heavy Docker | slow | Very active |
| **JoyVASA** | Audio→motion for LivePortrait | MIT (+InsightFace caveat) | Yes* | ~ (community) | ✅ | ⚡ fast | Active |
| **AniTalker** | Photo+audio→head (ACM'24) | Apache-2.0 | ✅ | ✗ | ✅ low | balanced | Stable |
| **PD-FGC** | Fine-grained control | **unverified** | ❓ | ✗ | ✅ | balanced | Legacy |
| **Wan2.2-S2V-14B** | Cinematic speech-to-video | Apache-2.0 | ✅ | ✅ native | ⚠ 24 GB+ | slow | Active (2025) |
| **HunyuanVideo-Avatar** | Multi-char emotion avatar | **Tencent Hunyuan Community** (not EU/UK/KR) | ⚠ territory | ✗ (planned) | ⚠ 10 GB (Wan2GP) | slow | Active |
| **OmniAvatar** | Audio→avatar + body | Apache-2.0 | ✅ | ✅ CallMe1101 | ✅ 8 GB (1.3B) | balanced | Active (2025) |
| **InfiniteTalk/MultiTalk** | Long talking-head on Wan | Apache-2.0 | ✅ | ✅ WanVideoWrapper | ⚠ 24 GB+ | slow | Active |
| **Wan2.2 Animate-14B** | Character anim/replace (video) | Apache (base) / OpenRAIL (claim) | ⚠ unverified | ✅ native | ✅ 4 GB GGUF | slow | Active |
| **SkyReels-A1/Audio** | Expressive portrait anim | GH `other` / HF Apache (conflict) | ⚠ verify | ✗ | ⚠ 16–24 GB | slow | Active |

`*` = commercial permitted **only after** swapping the non-commercial face-detection models.
`⚡` = real-time/low-latency · `balanced` = minutes · `slow` = heavy diffusion, many minutes per clip.

---

## 4. Recommendation

### 4.1 First integration — *"a photo + an audio track becomes a talking head video"*

**Integrate `EchoMimic V3` first.**

- **Task fit:** It natively takes *image + audio → video* (not a driving video), which is exactly the requested "photo + audio" workflow — no second animator stage needed.
- **Licence:** Apache-2.0, clean commercial path.
- **Runs locally on a consumer GPU:** **12 GB VRAM** for 768×768 @ 8 steps (768×512 in ~6.5 GB), 1.3B params.
- **Drives like the existing app:** `smthemex/ComfyUI_EchoMimic` gives a ComfyUI graph (LoadModel → Predata → Sampler) that slots into the same `buildLocalAvatarGraph` pattern the app already uses — swap `WanInfiniteTalkToVideo` for the EchoMimic sampler nodes.
- **Fast enough to iterate:** 8-step sampling on a 1.3B model, not a 14B/50-step diffusion.

*Pragmatic alternative if the goal is a **lip-sync polish pass on already-generated video** (rather than photo→head):* use **MuseTalk 1.5** — MIT, real-time, ~4 GB, the lightest commercial-safe option. For a single "best-seller" combo: **EchoMimic V3** to create the head, **MuseTalk** (or **LatentSync 1.5**) to tighten the lips.

### 4.2 High-quality character performance

**Integrate `Wan2.2-S2V-14B`** (with `InfiniteTalk` as the long-form alternative and `HunyuanVideo-Avatar` as the multi-character alternative).

- It is the strongest **open, Apache-2.0, ComfyUI-native** model for cinematic, full-body, camera-aware character performance in 2025–2026, and it lives in the same **Wan** family the app already drives.
- Trade-off: 14B MoE → 24 GB+ realistically, minutes-to-tens-of-minutes per clip. Quality is the payoff.

### 4.3 The fast-vs-quality trade-off (explicit)

| | Fast / low-latency | Balanced | High-quality / slow |
|---|---|---|---|
| **Examples** | LivePortrait(+JoyVASA), MuseTalk | EchoMimic V3, OmniAvatar 1.3B, LatentSync 1.5, SadTalker | Wan2.2-S2V, FantasyTalking, InfiniteTalk, HunyuanVideo-Avatar, Hallo3 |
| **Latency** | real-time → seconds | tens of seconds → ~1 min | many minutes per clip |
| **VRAM** | < 8 GB | 8–12 GB | 24 GB+ (some 10 GB optimised) |
| **Motion realism** | lips/expression only; limited body | good head motion | full body + camera, most photoreal |
| **Best role** | interactive / preview / dubbing | production talking-head | hero shots / character performance |

**Rule of thumb for the pipeline:** use a **balanced** model (EchoMimic V3) as the default render, a **fast** model (MuseTalk/LivePortrait) for previews and re-lipsync passes, and a **slow** model (Wan2.2-S2V / InfiniteTalk) only for hero shots where VRAM/time are justified.

### 4.4 Consumer-GPU-on-Windows reality check

- **Comfortable on an 8–12 GB card (Windows):** LivePortrait, MuseTalk, Wav2Lip, SadTalker, **EchoMimic V3**, OmniAvatar 1.3B, LatentSync 1.5, Wan2.2 Animate (GGUF).
- **Needs 16–24 GB+:** LatentSync 1.6 (18 GB), FantasyTalking, Wan2.2-S2V, InfiniteTalk/MultiTalk, HunyuanVideo-Avatar, Hallo/Hallo2/Hallo3, SkyReels.
- **Windows-specific snags:** LivePortrait warns against CUDA 12.4/12.6 on Windows (use 11.8) and needs a custom CUDA op for its animals mode; MuseTalk needs the mmcv/mmpose stack; LatentSync 1.6 models sit behind a gated HF repo (manual download); Duix.Avatar is natively Windows but ships as a Docker + Electron stack.
- **ComfyUI = integration accelerator:** every model with a ✓ above can be driven by the app's existing "build a graph → POST `/prompt` → poll" loop. **No new client code pattern is required** — only new graph builders and model files.

---

## 5. Which are realistically runnable on a consumer GPU *and* have ComfyUI wrappers

**Both (best integration targets):** EchoMimic V1/V2/V3, MuseTalk, LatentSync, SadTalker, LivePortrait, OmniAvatar, Wan2.2-S2V (native), InfiniteTalk/MultiTalk, Wan2.2 Animate (native), FantasyTalking, Sonic, Wav2Lip.

**ComfyUI wrapper exists but model is heavy:** FantasyTalking, InfiniteTalk, Hallo/Hallo2.

**No practical ComfyUI path (standalone only):** Duix.Avatar (REST API — already integrated), HunyuanVideo-Avatar (planned), SkyReels, AniTalker, PD-FGC.

---

## 6. Licence caveats — read before shipping commercially

1. **LivePortrait** — MIT code/weights, **but** InsightFace `buffalo_l` (and X-Pose for animals) are **non-commercial**. Swap to MediaPipe/FaceAlignment to comply.
2. **Wav2Lip** — **non-commercial** (LRS2). Do not ship.
3. **Sonic** — **CC-BY-NC-SA-4.0**, non-commercial; commercial only via Tencent Cloud.
4. **Hallo3** — MIT *code* but **weights under the CogVideoX License** (free commercial after registration, capped at 1M visits/month).
5. **Duix.Avatar** — DUIX.COM Community License; **thresholds conflict** between the LICENSE text (1k MAU) and the README (100k users / $10M); **models under a separate PDF agreement**. Verify both.
6. **HunyuanVideo-Avatar** — Tencent Hunyuan Community License; **does not apply in the EU, UK or South Korea**; licence required above 100M MAU.
7. **Wan2.2 Animate-14B** — licence **unverified** (Apache base vs OpenRAIL claim). Confirm on the model card.
8. **SkyReels-A1** — **conflicting** licence (GitHub `other`/Skywork Community vs HF Apache-2.0). Verify.
9. **PD-FGC** — licence **not verified**.

**Cleanest commercial licences (verified):** MuseTalk (MIT, all components clean), LatentSync (Apache-2.0), EchoMimic V1/V2/V3 (Apache-2.0), SadTalker (Apache-2.0), OmniAvatar (Apache-2.0), Wan2.2-S2V (Apache-2.0), InfiniteTalk/MultiTalk (Apache-2.0), Hallo v1/v2 (MIT), AniTalker (Apache-2.0), JoyVASA (MIT, +InsightFace caveat).

---

## 7. Primary sources (repos, papers, model cards)

**LivePortrait:** https://github.com/KlingAIResearch/LivePortrait · https://github.com/KlingAIResearch/LivePortrait/blob/main/LICENSE · https://github.com/kijai/ComfyUI-LivePortraitKJ · https://github.com/warmshao/FasterLivePortrait
**EchoMimic:** https://github.com/antgroup/echomimic · https://github.com/antgroup/echomimic_v2 · https://github.com/antgroup/echomimic_v3 · https://github.com/antgroup/echomimic_v3/blob/main/README.md · https://github.com/smthemex/ComfyUI_EchoMimic
**Hallo:** https://github.com/fudan-generative-vision/hallo · https://github.com/fudan-generative-vision/hallo2 · https://github.com/fudan-generative-vision/hallo3 · https://huggingface.co/fudan-generative-ai/hallo3 · https://github.com/THUDM/CogVideo/blob/main/LICENSE
**MuseTalk:** https://github.com/TMElyralab/MuseTalk · https://huggingface.co/TMElyralab/MuseTalk · https://github.com/kijai/ComfyUI-MuseTalk-KJ · https://github.com/chaojie/ComfyUI-MuseTalk
**LatentSync:** https://github.com/bytedance/LatentSync · https://github.com/bytedance/LatentSync/blob/main/LICENSE · https://github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper
**SadTalker:** https://github.com/OpenTalker/SadTalker · https://github.com/OpenTalker/SadTalker/blob/main/LICENSE · https://github.com/haomole/Comfyui-SadTalker
**Wav2Lip:** https://github.com/Rudrabha/Wav2Lip
**Sonic:** https://github.com/jixiaozhong/Sonic · https://github.com/smthemex/ComfyUI_Sonic
**FantasyTalking:** https://github.com/Fantasy-AMAP/fantasy-talking · https://huggingface.co/acvlab/FantasyTalking
**Duix.Avatar:** https://github.com/duixcom/Duix-Avatar · https://github.com/duixcom/Duix-Avatar/blob/main/LICENSE
**AniTalker:** https://github.com/X-LANCE/AniTalker · **PD-FGC:** https://github.com/Dorniwang/PD-FGC-inference · **JoyVASA:** https://github.com/jdh-algo/JoyVASA
**Wan2.2 / S2V:** https://github.com/Wan-Video/Wan2.2 · https://huggingface.co/Wan-AI/Wan2.2-S2V-14B
**HunyuanVideo-Avatar:** https://github.com/Tencent-Hunyuan/HunyuanVideo-Avatar · https://huggingface.co/tencent/HunyuanVideo-Avatar · https://arxiv.org/html/2505.20156v1
**OmniAvatar:** https://github.com/Omni-Avatar/OmniAvatar · https://vramdb.com/nodes/callme1101/comfyui_omniavatar
**InfiniteTalk/MultiTalk:** https://github.com/kijai/ComfyUI-WanVideoWrapper · https://comfy.icu/node/MultiTalkModelLoader
**Wan2.2 Animate:** https://blog.comfy.org/p/wan22-animate-and-qwen-image-edit-2509
**SkyReels:** https://github.com/SkyworkAI/SkyReels-A1 · https://huggingface.co/Skywork/SkyReels-A1
**Survey index:** https://github.com/Kedreamix/Awesome-Talking-Head-Synthesis
