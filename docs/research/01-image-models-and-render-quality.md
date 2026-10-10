# 01 — Image models & render quality (open weights, Windows + ComfyUI)

**Scope.** Which image-generation models available in 2025–2026 render legible text and
get anatomy right; why diffusion output produces three-legged chickens and three-armed
dragons; and the concrete settings, encoders, detailers and repair passes people
actually use. Target: Windows + ComfyUI + Ollama, open weights preferred, still-image
first then animate (image-to-video).

> **Bottom line.** For a still-then-animate pipeline where you *curate* the still, the
> single most effective change is to stop asking one text-to-video model to invent
> scene, anatomy and text in a single hop. Generate the still with a model that is
> genuinely good at the exact thing you need (Qwen-Image for text; FLUX/FLUX.2 or
> Z-Image for anatomy/photorealism), then repair the still (detailers / inpaint / edit
> models) before handing it to an image-to-video node. Anatomy and text are *mostly*
> model-capability problems, but resolution, CFG and the VAE are large secondary
> contributors — and all three are controllable in ComfyUI.

---

## Part A — Model roster (licence, VRAM, strengths, weaknesses)

VRAM numbers below are community/practical figures (quantized builds, ComfyUI offload)
and are cited to the source that states them; they move with quantisation and
resolution, so treat them as tiers, not guarantees.

### A.1 Current open-weight leaders (2025–2026)

**FLUX.2 [dev]** — Black Forest Labs, released 25 Nov 2025. 32B rectified-flow
transformer + a 24B Mistral-3 vision-language text encoder; single model does
text-to-image, single-reference and multi-reference editing, up to ~4 MP.[2][4]
- *Licence:* FLUX Non-Commercial License — free for research/personal, outputs usable,
  but running the weights in a commercial product needs a BFL licence.[2]
- *VRAM:* heavy. Full bf16 wants ~80 GB-class hardware; FP8 ~32 GB; ~18–24 GB quantized
  with offload on a 24 GB card.[2][4][5] Community 4-bit builds exist for RTX 4090-class.
- *Good at:* best open prompt adherence, complex typography/infographics/UI mockups,
  photoreal skin/fabric/hand detail, multi-reference consistency.[4][19]
- *Bad at:* hardware hunger; non-commercial weights; slowest of the family.

**FLUX.2 [klein] 4B / 9B** — BFL, released 15 Jan 2026. 4B and 9B rectified-flow
transformers, unified generation + editing + multi-reference.[5]
- *Licence:* **4B is Apache-2.0** (fully permissive, commercial OK); **9B is
  non-commercial** (FLUX dev terms).[3][5]
- *VRAM:* 4B fits ~8–13 GB (RTX 3090/4070 class); 9B ~20 GB.[3][5]
- *Good at:* sub-second generation on consumer GPUs; Apache-2.0 on the 4B; commercial-safe
  FLUX-flavoured output.[3][5]
- *Bad at:* smaller than FLUX.2 dev, so typography/anatomy are a step down; 9B licence.

**Qwen-Image (1.0) & the 2025-12 refresh (Qwen-Image-2512)** — Alibaba Qwen team,
original released 4 Aug 2025. 20B MMDiT + Qwen2.5-VL (8.3B) vision-language text
encoder; native ~2K output; the model most often cited as the open-weight text-rendering
leader, especially for Chinese.[6][7][8]
- *Licence:* **Apache-2.0** (verified on the model card and repo).[6][7]
- *VRAM:* BF16 ~40 GB [9]; FP8 ~20 GB (ComfyUI reference on an RTX 4090D used ~86% of
  24 GB) [9]; GGUF Q4/Q5 down to ~8–12 GB with the Lightning LoRA.[7][9]
- *Good at:* complex/multi-line text in English **and** Chinese/Japanese/Korean, posters,
  signage, UI mockups; prompt literalness; strong editing via Qwen-Image-Edit.[7][8][9]
- *Bad at:* big and slow at full quality (Lightning distillation trades quality for
  speed); large-model RAM pressure.
- *Note:* Alibaba shipped **Qwen-Image-2512** (31 Dec 2025) and **Qwen-Image-2.0**
  (10 Feb 2026) per the official repo news.[7] I could **not** verify the licence of the
  2.0/2512 checkpoints on a primary source — see "Unverified items" below. The
  Apache-2.0 claim above is verified for **Qwen-Image 1.0** only.[6][7]

**Z-Image-Turbo (and Z-Image base)** — Alibaba Tongyi-MAI, ~Nov 2025. 6B single-stream
diffusion transformer, distilled to **8 NFEs**, sub-second on enterprise GPUs and
comfortable in **16 GB** consumer VRAM.[15]
- *Licence:* **Apache-2.0**.[15]
- *VRAM:* ~16 GB (fits a 16 GB card in bf16; GGUF ladder exists).[15][21]
- *Good at:* speed/throughput, photorealism and skin detail, bilingual English/Chinese
  text rendering, small enough to LoRA-train.[15]
- *Bad at:* text rendering weaker than Qwen-Image/FLUX.2; occasional anatomy slips; needs
  sampler/scheduler tuning; less creative breadth.[15]

**FLUX.1 [dev] / [schnell]** — BFL, 2024. 12B rectified-flow transformer, CLIP-L + T5-XXL
encoders.[1]
- *Licence:* [dev] = FLUX.1 Non-Commercial; **[schnell] = Apache-2.0**.[1][18]
- *VRAM:* FP8 ~12–16 GB; GGUF Q4 ~7 GB; full ~33 GB.[1][20]
- *Good at:* prompt adherence on mid-range cards, good short-text and hands *relative to
  SDXL* (the model's own materials and ComfyUI's guide emphasise text/hands as strengths
  of the family).[20]
- *Bad at:* weaker than FLUX.2/Qwen on long or multi-line text; [dev] licence.

**FLUX.1 Kontext [dev]** — BFL, Jun 2025. 12B **editing** model (image + instruction →
image), strong identity/consistency across successive edits; used for text-in-image edits
and targeted repair.[18]
- *Licence:* FLUX.1 [dev] Non-Commercial.[18]
- *VRAM:* FP8 ~12–16 GB; GGUF Q4 ~8 GB.[18]
- *Good at:* precise in-context edits, "change the colour / remove the object / fix the
  sign" without redrawing the whole frame — a key *repair* tool.
- *Bad at:* not a text-to-image model; non-commercial weights.

**FLUX.1 Krea [dev]** — BFL + Krea, an aesthetic re-tune of FLUX.1 dev; ComfyUI ships an
fp8_sclaled build and workflow.[20] Same non-commercial terms as FLUX.1 dev.

### A.2 Other open weights worth knowing

| Model | Maker / approx date | Params | Licence | Practical VRAM | Verdict |
|---|---|---|---|---|---|
| **Stable Diffusion 3.5 Large** | Stability, Oct 2024 | 8.15B | Stability Community (free <$1M revenue) [10] | ~16 GB fp8 [10][46] | Better text than SDXL, "often legible for a few words"[24]; still weak hands/长 text; thin LoRA ecosystem (~50 vs SDXL's thousands) |
| **HiDream-I1 (Full/Dev/Fast)** | HiDream.ai, Apr 2025 | 17B sparse MoE DiT | **MIT** (encoders keep own licences: T5-XXL Apache, Llama-3.1 community) [11][12] | 16 GB quantized (fp8/nf4) [12] | Strong GenEval composition/counting [11]; overtaken by Qwen/FLUX.2 by 2026 |
| **SDXL + fine-tunes (Illustrious, NoobAI, Pony)** | Stability / community 2024–25 | ~3.5B | SDXL: CreativeML OpenRAIL++-M; **Illustrious: Fair AI Public License 1.0-SD (share-alike)**; **NoobAI: adds non-commercial restriction** [16][17] | 6–8 GB [45] | Deepest LoRA/ControlNet ecosystem by far [45]; anime/illustration king; **text is poor** |
| **Lumina-Image 2.0 / Neta Lumina** | Alpha-VLLM (Shanghai AI Lab), ICCV 2025 | 2.6B Next-DiT | Apache-2.0 backbone, but Gemma-2-2B text encoder is under Google's Gemma terms [21] | ~10.8 GB bf16 (DiT+encoder+VAE) [21] | Interesting small model; anime fine-tunes (Neta Lumina) are the popular part; not a text specialist |
| **Chroma / Chroma1-HD** | LodestoneRock, 2025 | 8.9B (pruned FLUX.1-schnell) | **Apache-2.0**, uncensored [13][14] | ~10–19 GB [14] | Community fine-tune base with *true CFG and negative prompts*; not a text or flagship-quality model |

### A.3 Closed / hosted models — for comparison only

These are useful as a **quality ceiling** and as a fallback, not as a local pipeline.

- **GPT-4o / GPT-image (OpenAI)** — repeatedly the top performer on text *accuracy* and
  instruction following in independent tests; renders long text that open models cannot.[29][50]
  On the Artificial Analysis arena, GPT Image 2.5 leads the field by Elo (2026).[49]
- **Ideogram 3.0** (Mar 2025) — built its reputation on typography and layout; the vendor
  claims top ELO across capabilities, and independent reviews praise its posters/logos.[48][50]
  But a 2026 blind benchmark did **not** reproduce the reputation — Ideogram 3.0 ranked
  mid-pack and lost the typography prompts to the Seedream line, a caution that
  "best at text" claims age fast.[52]
- **Seedream 3.0 / 4.0 / 5.0 (ByteDance)** — strong Chinese and English text rendering;
  the vendor reports ~94% text availability and top Artificial Analysis placement at
  launch.[51] Successors (Seedream 4.5/5.0) continue the line.
- **Recraft (V3/V4.x)** — vector/SVG-oriented, strong brand-typography and logo control;
  a raster/vector hybrid rather than a pure diffusion image model.[53]
- **Gemini / "Nano Banana"** and **Imagen** also rank near the top of the text and
  adherence arenas.[29][49]

**Takeaway for the pipeline:** if a *specific frame* absolutely must have perfect,
long-form text, no open-weight model yet matches GPT-image/Gemini-class text, so route
that one asset to a hosted model — but for the bulk of a video you will use open weights
(Qwen-Image for text, FLUX.2/Z-Image for anatomy) and repair.

### A.4 Text-rendering quick ranking (open vs closed)

| Rank | Model | Text | Anatomy | Licence | Local? |
|---|---|---|---|---|---|
| Best open text | **Qwen-Image (1.0)** | Excellent (EN+CN, multi-line) [6][8] | Strong | Apache-2.0 | Yes |
| Best closed text | **GPT-image / Gemini / Seedream** | Excellent (long text) [29][50][51] | Excellent | API | No |
| Strong text + adherence | **FLUX.2 [dev]** | Good→Excellent | Best open | Non-commercial | Yes (heavy) |
| Fast text | **Z-Image-Turbo** | Good (short) [15] | Very good | Apache-2.0 | Yes (16 GB) |
| Short-text only | **FLUX.1 dev / SD3.5** | Fair (a few words) [24] | Good (better than SDXL) | Non-commercial / Community | Yes |
| Poor text | **SDXL / Illustrious / NoobAI / Chroma** | Fair→Poor [17] | Fine with ControlNet | Mixed | Yes |

---

## Part B — Root causes: *why* you get three legs and garbled text

The user's two failure modes have **different** causes, and only one of them is "the
model is bad."

### B.1 Garbled text — four stacked causes

1. **The text encoder is the bottleneck.** CLIP-class encoders hard-cap at **77 tokens**
   and, per measurement, their *effective* length is closer to **20** because higher
   positions were barely trained [22]; CLIP also behaves like a "bag of concepts",
   scoring "a horse riding an astronaut" ≈ "an astronaut riding a horse",[24] and an
   early-token bias means it reads the first sentence almost exclusively.[23] If the
   prompt says "a sign that reads *WELCOME TO THE SHOW*", a lot of it never reaches the
   sampler, or arrives without structure — and the diffusion model is asked to spell
   words it only partially "heard." The STRICT benchmark ties the collapse in text
   accuracy to exactly this: most diffusion models degrade sharply past ~200 characters,
   matching the ~77-token CLIP ceiling.[29] FLUX/SD3 add **T5-XXL** (longer context) and
   Qwen-Image uses a **vision-language encoder (Qwen2.5-VL)**, which is why those models
   spell better.[8][24]
2. **Diffusion's locality bias.** Diffusion is an iterative, local sampler; it struggles
   with long-range spatial dependencies, so glyphs come out "jumbled, misspelled, or
   visually fragmented" — letters that are individually plausible but globally wrong.[29]
   This is a property of the generation process, not just the data.
3. **The VAE sets a hard ceiling.** Latent diffusion compresses the image ~8× spatially
   (a 1024² image → a 128² latent grid); the autoencoder is a *codec*, and whatever it
   cannot reconstruct the diffusion model can never produce.[25][26] Small text is
   high-frequency and exactly what 8× downsampling discards; this is a documented,
   named failure of the VAE, not the denoiser.[25][27] The recommended diagnostic is
   blunt: **encode-decode a real image with text; if the text is already mangled, the
   diffusion model was never the problem.**[26] Newer VAEs widen this: SD3/FLUX use
   **16 latent channels** instead of 4, and Qwen-Image's VAE line explicitly targets the
   "text-rich" detail loss.[26][28]
4. **Too few pixels in the text region.** If the text occupies a small part of the frame,
   it gets proportionally little model attention — the same reason small faces come out
   as mush [33]. Rendered text needs resolution.

### B.2 Extra limbs / wrong counts — four causes (and one myth)

1. **Long-tail training data.** Hands and *counts* sit in the statistical tails of
   training sets; the model "does not have enough data to learn" the rare-but-needed
   cases, and hands are famously SD's "Achilles' heel."[31][34] The fix is structural
   conditioning (below), not more parameters.
2. **Counting and multi-subject binding are a known weak spot.** On GenEval "Counting",
   SDXL scores ~0.39 vs FLUX.1-dev ~0.73 and HiDream ~0.79 — i.e. even good models get
   explicit counts wrong.[11][24] A "chicken" in a busy scene can sprout a third leg
   because the model is not reliably binding "one chicken" to "two legs" — the same
   bag-of-concepts weakness that garbles text.
3. **CFG / over-guidance artefacts.** Classifier-free guidance pushes samples toward the
   conditional manifold; too high a CFG causes oversaturation and unrealistic artefacts
   (Disney Research's APG paper decomposes CFG and shows the parallel component is the
   culprit).[30] On SDXL-family models very high CFG produces vivid, deformed, incoherent
   anatomy.[44]
4. **Off-resolution / off-aspect generation.** SDXL was trained on a fixed set of
   ~1 MP buckets; asking for an unseen size is the classic source of **duplicated limbs,
   a second head, tiled backgrounds.**[45][46] The same "generate at trained buckets"
   advice appears across ComfyUI node docs.[46]

**Myth to drop:** "the model just draws bad hands." Modern models are better, but the
remaining errors are mostly *conditioning and resolution* problems you can engineer
around, plus counting/data limits you manage with guidance and repair.

---

## Part C — Concrete mitigations that people actually use

### C.1 Text encoders — T5/LLM/VLM vs CLIP

- **Prefer encoders that are not CLIP-only.** T5-XXL (SD3, FLUX) handles longer,
  compositional prompts; VL encoders (Qwen2.5-VL in Qwen-Image; Mistral-3 24B in FLUX.2;
  Qwen3-VL in newer Qwen) read prompts like a language model and are why those models
  render text and follow structure.[8][24][2]
- **Practical rule:** if your asset has text, use a model whose encoder is T5/LLM/VLM-class
  (Qwen-Image, FLUX.2, SD3.5, HiDream) and, when you *must* stay on SDXL-class, keep the
  text short and quote it literally in the prompt.

### C.2 Resolution & aspect-ratio rules

- **SDXL / Illustrious / NoobAI / Pony:** generate inside the **trained ~1 MP buckets**
  (1024×1024; 832×1216; 1216×832; 1152×896; 896×1152; 1536×640; …). Off-bucket sizes cause
  duplicated limbs and tiling.[45] Use a resolution-picker node rather than typing numbers.
- **FLUX / SD3 / Z-Image / newer flow models:** much wider tolerance, but keep to roughly
  **1–2 MP and divisible by 64**, and remember the **16-channel** latent shape differs
  from SDXL's 4-channel — pick the right latent node (Flux/SD3 vs SDXL) or you get a tensor
  crash.[46]
- **For legible text, give the text area real pixels:** a "sign" that should be readable
  needs a cropped/zoomed generation or an upscaled inpaint pass, not a small patch in a
  wide frame.[33]

### C.3 CFG & sampler settings

- **Standard (SDXL-class):** ~25–30 steps, **CFG 7–8**, DPM++ 2M + Karras is the reliable
  middle ground; CFG >13 gives visible artefacts/colour distortion.[44]
- **Distilled / guidance-distilled models (FLUX.1 dev, FLUX.2, Z-Image-Turbo, Qwen
  Lightning):** these are trained with **guidance distillation**, so use the *model's*
  default **CFG ≈ 1** and the true CFG/Guidance node instead of cranking CFG.[1][4][9]
- **If anatomy is melting at high CFG, lower it**, or use a CFG schedule that ramps CFG
  down toward the end of sampling (ComfyUI sampler-level hack; community-tested).[44]
- **Don't use "Res Multistep" on standard models** — it targets turbo/distilled models.[44]

### C.4 Negative prompts & embeddings

- On models with true CFG (SDXL family, Chroma), a **negative prompt** is effective:
  "bad anatomy, bad hands, extra fingers, missing fingers, fused fingers, extra limbs,
  extra legs, extra arms, mutated hands, deformed hands."[42][43]
- **Don't overdo it.** Community testers warn that an over-stuffed negative (and hand
  LoRAs run too strong) pushes toward "too perfect"/uncanny anatomy.[43]
- Verified negative embed/LoRA options:
  - **badhandv4** and **verybadimagenegative_v1.3** embeddings (SD1.5/SDXL) — still
    recommended on model cards for hand/quality suppression.[43]
  - **BadHands SDXL negative LyCORIS/LoKr** — a dedicated negative model trained on
    mangled hands, used at negative weight to filter bad hands.[42]
- **On guidance-distilled models (FLUX, FLUX.2, Qwen, Z-Image) negatives are weak** — the
  architecture doesn't run a true unconditional branch, so a negative prompt does little;
  repair via detailers/inpaint instead.

### C.5 Detailers (ADetailer / Impact Pack FaceDetailer)

- **What they are:** a detect → crop → upscale → re-sample → composite-back pass. The
  problem they solve is structural: a face occupying 80×80 px of a 1024² render only gets
  80×80 px of attention, so it comes out mush regardless of the checkpoint.[33]
- **In ComfyUI:** the **Impact Pack** ships **FaceDetailer** (an ADetailer equivalent);
  it needs a YOLO/sam detector wired into `bbox_detector` (the detector models —
  `face_yolov8m.pt`, `hand_yolov8s.pt` — live in a separate subpack/model list).[32][33][41]
- **Tuning:** `denoise` is the key dial — ~0.35–0.5 to *refine* rather than *replace*;
  `guide_size` 512 suits SD1.5, bump to ~768–1024 for SDXL/FLUX.[33]
- **Chain two detailers** (face, then hands) in one pass; run detailers *before*
  upscaling so the region is small and fast.[47]

### C.6 Hand repair (the real fix for finger counts)

- **Plain re-prompting ("five fingers, please") fixes blurry hands, not wrong hands.** A
  detailer re-draws the region with text guidance only — "asking the model that drew six
  fingers to count this time."[36]
- **The reliable fix for wrong geometry is structural conditioning — MeshGraphormer /
  HandRefiner:** reconstruct a 3D hand mesh from the image, render it as a depth map, and
  inpaint the hand region with a depth ControlNet. The mesh has five fingers *by
  construction*, so the condition is anatomically correct rather than hopefully
  correct.[35][36]
  - ComfyUI pieces: **MeshGraphormer** preprocessor in `comfyui_controlnet_aux` [38], the
    **ControlNet-HandRefiner-pruned** model (hr16) [37], and the one-node
    **HandRefineInpaint** wrapper (or a manual ControlNet depth + masked KSampler at
    `denoise ~0.85`).[36]
- **Community testing** (ComfyUI-Hand-Fixing) found **FaceDetailer with BBOX-only mode
  (no SAM)** beat SAM/MeshGraphormer for many hand cases — SAM's tight "glove" mask
  preserves the malformed shape, while a rectangular box lets the model regenerate
  correct anatomy; tested optimal ~`denoise 0.5, cfg 6.0, bbox_crop_factor 2.5`, and
  fix hands at **low resolution before upscaling** (≈16× faster).[34]

### C.7 Hand-fix LoRAs / embeddings (verify before use)

- **Verified, still-cited:** BadHands SDXL negative LyCORIS [42]; badhandv4 &
  verybadimagenegative embeddings [43].
- **Reported but not independently verified in this pass:** a "Flux-Hands" LoRA (Civitai)
  at ~0.4 strength — treat any specific FLUX/FLUX.2 hand LoRA filename as **unverified**
  until you open its model card; LoRA ecosystems for the newest bases are thin and names
  move fast.

### C.8 ControlNet / pose guidance

- **Pose control beats prompt control for anatomy.** Feed a skeleton, not a sentence;
  text cannot express joint positions precisely enough to reproduce a pose.[40]
- **Use DWPose over the original OpenPose estimator** — better hand detection and
  whole-body keypoints in one pass; both are in `comfyui_controlnet_aux`.[38][39]
- **Don't hold pose to the finish line.** Full-strength pose ControlNet through all steps
  leaves anatomy stiff/flat; drop the weight (~0.8) and end its influence partway through
  denoising.[39][40]
- **Hand keypoints via OpenPose are unreliable** — detection misses and the model's
  training on hand-skeletons is sparse; for hand *pose* use OpenPose-extended or
  MeshGraphormer, and for hand *fixing* use an inpaint/detailer pass.[34][40]
- **Model-agnostic:** detect a pose once; the same skeleton drives an SD1.5 openpose
  ControlNet, an SDXL union ControlNet, or a newer FLUX/Qwen/Z-Image union — only the
  ControlNet checkpoint changes.[39]

### C.9 Inpaint / outpaint / edit-model repair passes

- **FLUX Fill / masked inpaint** for high-quality local reconstruction.[34]
- **Instruction-edit models** are the cleanest surgical repair: **FLUX.1 Kontext [dev]**
  ("change the text on the sign to…", "remove the extra leg") and **Qwen-Image-Edit**
  (Apache-2.0 on 1.0; multi-image on Edit 2509/2511) keep the rest of the frame consistent.[18][6][7]
- **Pipeline order people use:** generate → VAE decode → face detailer → hand detailer
  (BBOX) → (if geometry is badly wrong) MeshGraphormer+ControlNet inpaint → upscale →
  final edit pass for any text.[34][36][47]

---

## Part D — Recommended default stack (Windows + ComfyUI)

Assumes NVIDIA GPU; numbers are tiers, pick by VRAM.

**D.1 If you have 24 GB (RTX 3090/4090) — the "reliable anatomy + readable text" default**
1. **Scene/photoreal still:** **FLUX.2 [klein] 4B** (Apache-2.0, ~8–13 GB) for speed, or
   **FLUX.2 [dev]** fp8/4-bit for hero shots (non-commercial) if licence permits.[3][2]
2. **Any frame with text:** **Qwen-Image (1.0, fp8 ~20 GB)**, CFG 1, 20–40 steps, with the
   **8-step Lightning LoRA** for speed; add **Qwen-Image-Edit** for text fixes.[9][6]
3. **Repair:** Impact **FaceDetailer** (denoise ~0.4, guide_size 768) then a second
   FaceDetailer with **hand_yolov8s.pt** (BBOX-only, bbox_crop_factor ~2.5); escalate
   bad geometry to **MeshGraphormer + ControlNet-HandRefiner** inpaint.[33][34][36][37]
4. **Pose:** **DWPose** (comfyui_controlnet_aux) → ControlNet at ~0.8, ended early.[39]
5. **Then animate:** hand the curated still to your image-to-video model (a separate doc).

**D.2 If you have 16 GB — the pragmatic default**
- **Z-Image-Turbo** (Apache-2.0, 16 GB, 8 steps) as the daily driver for anatomy/photoreal.[15]
- **Qwen-Image GGUF Q4/Q5 + 4-step Lightning LoRA** when text matters (runs ~8–12 GB).[9]
- **FLUX.2 [klein] 4B** for FLUX-flavoured output and commercial safety.[3]
- Same detailer/repoint stack as D.1.[32][34]

**D.3 If you have 8–12 GB**
- **SDXL family** (or Illustrious/NoobAI for anime) at **6–8 GB**, inside trained ~1 MP
  buckets only; add a **1-step/Lightning/DMD2 LoRA** for speed.[45][17]
- **FLUX.1 [dev] GGUF Q4** (~7 GB) for adherence; **Qwen-Image GGUF Q2/Q3 + Lightning** for
  text at the cost of small-letter fidelity.[14][9]
- Note: no SDXL/Illustrious/NoobAI model is a text specialist — plan to composite or
  edit text rather than generate it.[17]

**D.4 Licence-safe picks (if you sell the output or ship a product)**
- **FLUX.2 [klein] 4B** (Apache-2.0),[3] **Qwen-Image 1.0** (Apache-2.0),[6]
  **Z-Image-Turbo** (Apache-2.0),[15] **FLUX.1 [schnell]** (Apache-2.0),[1]
  **SDXL** (OpenRAIL++-M),[17] **HiDream-I1** (MIT),[11] **Chroma1-HD** (Apache-2.0).[13]
- Avoid depending on **FLUX.1 [dev], FLUX.2 [dev], FLUX.1 Kontext [dev], and FLUX.2 klein
  9B** weights inside a commercial product without a BFL licence.[2][5][18]

**D.5 Non-negotiable habits regardless of model**
- Stay at trained resolutions/ratios; give text real pixels.[45][46]
- Correct CFG per family (1 for distilled; 7–8 for SDXL).[1][44]
- Always run at least a face + hand detailer pass before upscaling.[33][34]
- Use a pose skeleton when a specific pose is required, not a sentence.[40]
- Diagnose text failures by **encode-decode round-trip first** — if it's the VAE, no
  sampler setting will save the small text.[26]

---

## Part E — Handoff to image-to-video

The still-then-animate plan is the right instinct *because* it splits the failure modes:
you **curate the still at image-model quality** (where text and anatomy are best) and then
ask the video model only to move pixels that are already correct. Practical notes:
- Animate at the still's native aspect ratio and keep the first frame as a ControlNet/IP-Adapter
  anchor so the video model does not re-invent anatomy.
- Keep the still within a video model's native bucketed resolutions where possible;
  upscaling after animation is usually safer than animating at very high res.
- *(Model-specific image-to-video choices belong in the follow-on doc; verify weights/licences
  there rather than assuming from memory.)*

---

## Unverified / flagged items (do not treat as fact)

- **Qwen-Image-2.0 / 2512 / "2.1" licences.** The official repo confirms 2512 (31 Dec 2025)
  and 2.0 (10 Feb 2026) exist,[7] but I could not verify their licences on a primary source
  (the HF repo I tried 404'd, and secondary sources differ). Community sources claim newer
  Qwen image checkpoints moved away from Apache-2.0 toward a research licence — **unverified**.
  Verify the model card before commercial use.
- **"Qwen-Image-2.1" released Sep 2026** appears only in secondary/aggregator pages in this
  pass; treat the exact name/date as unverified.
- **Specific hand-fix LoRA filenames** (e.g. a "Flux-Hands" LoRA) — not verified here; check
  the Civitai/HF model card. The verified hand tooling is FaceDetailer+hand_yolov8s.pt,
  MeshGraphormer/HandRefiner, and the BadHands/badhandv4/verybadimagenegative items cited.[32][34][35][42][43]
- **VRAM figures** vary with quantisation/build; the cited sources state the specific tiers.

---

## Sources

[1] https://huggingface.co/black-forest-labs/FLUX.1-dev — FLUX.1 [dev] model card
[2] https://huggingface.co/black-forest-labs/FLUX.2-dev — FLUX.2 [dev] model card
[3] https://huggingface.co/black-forest-labs/FLUX.2-klein-4B — FLUX.2 [klein] 4B model card
[4] https://bfl.ai/blog/flux-2 — FLUX.2 blog (Black Forest Labs)
[5] https://github.com/black-forest-labs/flux2 — FLUX.2 inference repo (licenses table)
[6] https://huggingface.co/Qwen/Qwen-Image — Qwen-Image model card (Apache 2.0)
[7] https://github.com/QwenLM/Qwen-Image — Qwen-Image GitHub (news/versions)
[8] https://arxiv.org/abs/2508.02324 — Qwen-Image Technical Report
[9] https://docs.comfy.org/tutorials/image/qwen/qwen-image — ComfyUI Qwen-Image workflow docs
[10] https://huggingface.co/stabilityai/stable-diffusion-3.5-large — Stable Diffusion 3.5 Large model card
[11] https://huggingface.co/HiDream-ai/HiDream-I1-Full — HiDream-I1-Full model card
[12] https://github.com/HiDream-ai/HiDream-I1 — HiDream-I1 GitHub
[13] https://huggingface.co/lodestones/Chroma1-HD — Chroma1-HD model card
[14] https://huggingface.co/lodestones/Chroma — Chroma model card (Apache 2.0)
[15] https://huggingface.co/Tongyi-MAI/Z-Image-Turbo — Z-Image-Turbo model card
[16] https://huggingface.co/Laxhar/noobai-XL-1.0 — NoobAI-XL model card (license)
[17] https://civitai.com/articles/18619/what-the-license — Civitai: SDXL/Illustrious/NoobAI license chain
[18] https://huggingface.co/unsloth/FLUX.1-Kontext-dev-GGUF — FLUX.1 Kontext [dev] model card
[19] https://docs.comfy.org/tutorials/flux/flux-2-dev — ComfyUI Flux.2 Dev docs
[20] https://docs.comfy.org/tutorials/flux/flux1-krea-dev — ComfyUI FLUX.1 Krea dev docs
[21] https://nexgpu.net/en/models/lumina — Lumina Image 2.0 / Neta Lumina VRAM & license
[22] https://arxiv.org/html/2403.15378v1 — Long-CLIP: unlocking long-text capability of CLIP
[23] https://arxiv.org/abs/2602.22419 — CLIP Is Shortsighted (early-token bias)
[24] https://visionbook.icsgen-ai.org/part-4-generative-vision-models/module-34-text-to-image/section-34.1.html — Connecting Text & Pixels: CLIP vs T5 encoders
[25] https://praveentn.live/learn/concepts/latent-diffusion-and-the-vae-bottleneck — Latent diffusion and the autoencoder bottleneck
[26] https://srikanthmalla.com/blog/diffusion/08-latent-diffusion — Latent diffusion and what the VAE costs
[27] https://alphaxiv.org/abs/2507.20291 — TVT: VAE 8x downsampling loses small characters
[28] https://arxiv.org/html/2605.13565v1 — Qwen-Image-VAE-2.0 (text-rich fine detail)
[29] https://arxiv.org/html/2505.18985v2 — STRICT: stress-test of rendering images containing text
[30] https://studios.disneyresearch.com/2025/04/23/eliminating-oversaturation-and-artifacts-of-high-guidance-scales-in-diffusion-models — Disney Research: high CFG oversaturation/artifacts
[31] https://arxiv.org/pdf/2604.12617 — SOAR: wrong counts, malformed hands, broken text
[32] https://github.com/ltdrdata/ComfyUI-Impact-Pack — ComfyUI Impact Pack (FaceDetailer)
[33] https://comfy.icu/node/FaceDetailer — FaceDetailer node reference
[34] https://github.com/jjdejong/ComfyUI-Hand-Fixing/blob/main/HAND_FIXING_GUIDE.md — ComfyUI Hand Fixing guide
[35] https://arxiv.org/abs/2311.17957 — HandRefiner (MeshGraphormer) paper
[36] https://comfy.icu/node/HandRefineInpaint — HandRefineInpaint (HandRefiner) node
[37] https://huggingface.co/hr16/ControlNet-HandRefiner-pruned — ControlNet-HandRefiner-pruned (MeshGraphormer)
[38] https://github.com/Fannovel16/comfyui_controlnet_aux — comfyui_controlnet_aux preprocessors
[39] https://comfy.icu/node/DWPreprocessor — DWPose Estimator node (pose/hands)
[40] https://comfy.icu/node/OpenposePreprocessor — OpenPose Pose node
[41] https://huggingface.co/Bingsu/adetailer — ADetailer detector models (hand_yolov8s.pt)
[42] https://civitai.com/models/128969/badhands-sdxl-negative-lycorislokr — BadHands SDXL negative LyCORIS
[43] https://civitai.com/models/11772/verybadimagenegative — verybadimagenegative embedding
[44] https://comfylab.dev/blog/nodes/ksampler-explained-comfyui-steps-cfg-samplers-schedulers — KSampler steps/CFG guide
[45] https://comfy.icu/node/TWCUI_Util_CommonSDXLResolutions — Common SDXL resolutions (off-resolution failures)
[46] https://comfy.icu/node/AspectRatioNikosis — Aspect Ratio node (Flux/SD3 16-ch latent)
[47] https://artificialguy.com/blog/fix-faces-hands-adetailer-facedetailer — ADetailer vs FaceDetailer symptom/cause table
[48] https://ideogram.ai/models/3.0 — Ideogram 3.0 model page
[49] https://artificialanalysis.ai/image/leaderboard/text-to-image — Artificial Analysis text-to-image leaderboard
[50] https://www.whytryai.com/p/text-to-image-comparison-gpt-4o-vs-ideogram-3-vs-reve-1 — GPT-4o vs Ideogram 3.0 vs Reve text test
[51] https://arxiv.org/html/2504.11346v3 — Seedream 3.0 technical report
[52] https://img.ly/ai-benchmarks/models/ideogram-v3 — img.ly Ideogram 3.0 typography benchmark
[53] https://www.recraft.ai/blog/recraft-v4-1-vs-seedream-5-0-pro — Recraft V4.1 vs Seedream 5.0 Pro
