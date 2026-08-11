# Source notes — 2026-08-05

Unedited trace of inputs used to enrich the PRD. Prefer the normalized brief: [2026-08-05_celtra-hopper-brief.md](./2026-08-05_celtra-hopper-brief.md).

---

## A. Creative technologist — PoC approach (summary)

**Goal:** PoC that AI content flows into a workflow providing video asset generation at scale from a campaign template. Provide workflow diagrams, a simple production overview, and live demos that output campaign-ready assets from the creative template.

**Important points**

- All video (talent, AI, final output) goes through AI tagging and sentiment analysis.  
- Content library metadata aids suggestions and discovery for creative iterations.  
- Library primarily: Ted, hand alt videos, human body movement references.  
- Full production needs asset discovery, iteration review, state tracking, publishing — **not for PoC**.  

**Deliverables**

- Demo: script taking a content matrix of assets + brand messaging into a video template timeline → videos satisfying the matrix.  
- Demo: ComfyUI workflow generating the two videos used at the beginning of the template; param tweaks for theme variations.  
- Diagrams: content matrix; workflow stages; ComfyUI tasks/deps; video generation flow.  

**Questions raised**

- Face-untouchable → limited scenarios?  
- No relight/face change → need flat lighting; Ted scenarios share lighting setup?  
- Camera coverage — front essential; multiple angles?  
- Where to source body motion references?  
- Phones — match one brand always, or change?  
- Social media interface — static or changeable?  

**Dependencies (as written)**

- Remotion Enterprise — https://www.remotion.pro/license  
- Human motion/animation library — e.g. https://actorcore.reallusion.com/3d-motion  
- Frame.io  

---

## B. Florentin Hortopan — product framing (email excerpt)

**Working nickname:** “Celtra hopper” — pour approved ingredients in the top; finished, trafficable ad variants out the bottom.

**What we're building:** Tool for a creative team to produce a large set of paid social video ads from a single brief, without building each by hand and without developer support. Team writes a prompt; tool assembles from approved libraries, generates copy, produces variants; team reviews/tweaks; packages approved set into a content matrix for Celtra.

**Point:** Not remove creative judgement — remove manual assembly between a good idea and fifty versions.

**Target workflow:** Brief once → tool generates → variants → review/tweak → package matrix → deliver via Celtra.

**Ad parts:** Spokesperson (pre-recorded contracted talent) · Hands (pre-recorded/rendered product handling) · Copy.

**Story:** Setup · Punchline · End card. Cohesion is the quality bar.

**Spokesperson restrictions:** No face/voice/(likely) body performance alteration. AI may change wardrobe and background. Variation via library selection + re-dress/re-site.

**Hands:** Open — any product, adjust performance, change BG. Main generative flexibility.

**Output:** MVP vertical paid social; beyond MVP display and multi-size from one concept.

**Hosting:** Called out as needed for self-service creative teams — **superseded for current build by local-first decision** (see PRD non-goals).

**Prototype today:** Modular ad (spokesperson + hands + offer copy) → vertical video; selection still manual. Next: prompt-and-variants workflow.

*(Original email clipped in the chat paste.)*  
