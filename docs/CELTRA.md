# ATTATTA ↔ Celtra — Research & Boundary

**Date:** 2026-08-05  
**Purpose:** Clarify what Celtra is, what we deliberately take *out* of it, and what we still use it for.  
**Related:** [PRD.md](./PRD.md) · [WORKFLOW-UX-INTEGRATION.md](./WORKFLOW-UX-INTEGRATION.md) · [assumptions.md](./assumptions.md)

---

## 1. What Celtra is (research summary)

[Celtra](https://celtra.com/) is an enterprise **Creative Management / Creative Automation** platform. It positions itself as the full creative lifecycle OS:

| Celtra capability | What it means |
|-------------------|---------------|
| **Modular templates / design environment** | Build master templates (image, HTML, video); scale variants |
| **Creative automation** | Feeds, localization, auto-sizes/crops, mass variant generation |
| **Brand governance** | Locked toolkits so markets/marketers stay on-brand |
| **Approvals / collaboration** | In-platform review before launch |
| **GenAI + performance intelligence** | AI-assisted production, predictive pre-flight scoring, element insights |
| **Activation / distribution** | Publish/traffic to **100+** media platforms, ad servers, DCO / live-data creatives |
| **Integrations** | Figma, Adobe, Workfront, DAMs (Bynder/Widen/Canto cited), Meta/DSP-style paths |

Public scale claims (Celtra marketing): hundreds of enterprise customers, tens of millions of ads/year, integrations across a large ad-tech surface.

**Competitive framing (industry commentary):** Celtra is often strongest on **enterprise production + brand governance + multi-channel packaging**; platforms like Smartly are stronger on **native paid-social buying/DCO loops**. Celtra commonly **exports / pushes creatives into** media platforms rather than owning the media-buy brain.

**APIs (known):** Celtra documents an **Export API** (`hub.celtra.io` — JSON / ZIP / TSV of project outputs, Basic auth via API App). Public docs emphasize *getting assets out of Celtra*. Ingest/import paths for third-party finished video are typically account-specific (feeds, design files, toolkits, custom integrations) — treat exact ingest schema as **to confirm with the Celtra admin / CSM**.

---

## 2. The problem with “doing it all in Celtra” for this team

Celtra is built to own **template design → variant explosion → approve → distribute**. For ATTATTA’s use case that creates friction:

1. **Talent-locked modular video** (Ted face/voice/performance frozen; hands generative) is a custom production model Celtra’s generic template/AI flow does not natively express.  
2. **Performance marketers** need a sparse, knob-based test matrix (hands × copy), not a full Celtra toolkit localization blast.  
3. **ComfyUI + Remotion + library** is the real generative/assembly stack; forcing that *inside* Celtra loses control and speed.  
4. Creative judgement (story cohesion: setup → punchline → end card) should happen **before** enterprise trafficking machinery.

So ATTATTA is not “another Celtra.” It is an **upstream creative control hopper** that removes manual assembly *and* removes over-reliance on Celtra for ideation/variant logic.

---

## 3. Deliberate split (locked product boundary)

```text
┌─────────────────────────────────────────────┐
│ ATTATTA — Creative & marketing control      │
│ brief → rail → sparse matrix → preview      │
│ → Comfy plates → Remotion assemble          │
│ → review / regen → approved masters         │
│ → content matrix package                    │
└─────────────────────┬───────────────────────┘
                      │ handoff (files + matrix)
                      ▼
┌─────────────────────────────────────────────┐
│ Celtra — Distribution & channel activation  │
│ multi-channel packaging / trafficking       │
│ DCO / ad-server / Meta & 100+ platforms     │
│ enterprise launch ops already on Celtra     │
└─────────────────────────────────────────────┘
```

### ATTATTA owns (taken *out* of Celtra)

| Step | Why ATTATTA |
|------|-------------|
| Brief / prompt → structured offer | Marketer-speed ideation, not Celtra design file setup |
| Ingredient rail (Ted, hands, motion) | Contract locks + library intelligence |
| Design token pack confirm | Brand chrome as constraint, not variant engine |
| Sparse test matrix | Performance learning, not combinatorial toolkit spam |
| Comfy generative plates | Hands/attire/BG under our guardrails |
| Remotion story assembly | Fixed setup → punchline → end card |
| Creative review / single-knob regen | Quality bar = cohesion, before traffic |
| Approved vertical masters + lineage | Source of truth for what was tested |

### Celtra owns (distribution sink)

| Step | Why Celtra |
|------|------------|
| Channel / placement packaging | Org already traffics via Celtra; 100+ platform surface |
| Size / format adaptation for delivery *when needed* | Auto-sizes etc. as **downstream** from approved masters |
| Push to Meta, DSPs, ad servers, DCO | Activation is Celtra’s job |
| Live-data / feed-driven swaps *after* master approval | Optional later; not ATTATTA’s PoC |
| Enterprise audit of what launched where | Media ops continuity |

### Explicitly not ATTATTA’s job (leave to Celtra or media tools)

- Native media buying / bid optimization  
- In-flight DCO budget allocation  
- Being the system of record for “what ran on which placement”  
- Replacing Celtra Studio as the enterprise design toolkit for display HTML5, etc.

---

## 4. Handoff contract (“Celtra-ready” means this)

Until the account’s ingest path is confirmed, ATTATTA’s PoC handoff is:

**Package = approved MP4s + `matrix.json` (and optional CSV/TSV)**

Suggested matrix fields (map to Celtra content dimensions / custom labels later):

| Field | Example | Notes |
|-------|---------|-------|
| `variantId` | `cmp_spring_012` | Stable ID |
| `campaignId` | `spring_sale` | |
| `videoPath` / URL | `.../cmp_spring_012_9x16.mp4` | Finished master |
| `aspect` | `9:16` | |
| `primaryText` | hook / setup line | Meta primary text |
| `headline` / `endcard` | offer line | |
| `cta` | `Learn more` | |
| `landingUrl` | `https://…` | |
| `angle` / `handsId` / `talentTakeId` | lineage knobs | Useful as Celtra labels |
| `designTokenPackId` | `brand_default_v3` | |
| `approvalStatus` | `approved` | Only approved rows |
| `reviewNotes` | optional | |

**PoC:** manual drop into Celtra (upload + spreadsheet/feed).  
**Later:** Celtra API App / importer / design-file automation — confirm with CSM which ingest is supported for **pre-rendered video masters** (vs rebuilding inside Celtra templates).

### Preferred long-term pattern

1. ATTATTA produces **finished, approved vertical (and later multi-size) video masters**.  
2. Celtra treats them as **activation-ready outputs** (or thin wrappers), not as unfinished template slots to re-author.  
3. Celtra may still **resize/repackage** for additional channels — that is distribution, not creative reinvention.  
4. If Celtra must own a template for DCO live fields (price, inventory), ATTATTA still owns the **hero film**; Celtra swaps only declared dynamic fields.

---

## 5. What we intentionally do *not* rebuild from Celtra

Avoid scope creep into a second CMP:

- Full multi-market localization studio  
- HTML5 rich-media builder  
- Universal banner / ad-tag serving  
- Predictive pre-flight scoring (nice-to-have later; not MVP)  
- DAM replacement (Bynder et al.)  
- In-platform media analytics across 100 channels  

ATTATTA wins on **controlled modular video variants under talent contracts**. Celtra wins on **getting approved ads onto channels the business already uses**.

---

## 6. Implications for ATTATTA product language

| Old loose language | Sharper language |
|--------------------|------------------|
| “Celtra hopper” as if Celtra builds the ads | Hopper **feeds** Celtra; ATTATTA builds the ads |
| “Content matrix for Celtra” as production plan only | Matrix is **both** ATTATTA’s test plan **and** the distribution manifest |
| “Distribution = Meta” | Distribution = **via Celtra** to Meta and other channels |
| Compete with Celtra GenAI | **Complement**: we own upstream creative control Celtra is awkward at |

Working nickname stays **Celtra hopper**, meaning: *ingredients in → trafficable package out for Celtra*, not *Celtra does the thinking*.

---

## 7. Open items to confirm with Celtra owners

1. Exact ingest for **pre-rendered MP4 masters** + metadata (feed vs design file vs API).  
2. Required columns / content dimensions for Meta video + other channels.  
3. Whether Celtra should **re-output** sizes from our 9:16 master or ATTATTA should supply 1:1 / 4:5.  
4. Whether any dynamic fields (CTA URL, price) must remain Celtra-feed-driven.  
5. Export API usage: do we ever pull performance labels *back* from Celtra into ATTATTA (future loop)?

---

## 8. Doc impact checklist

- [x] This research note  
- [x] PRD thesis / non-goals / distribution wording  
- [x] Assumptions L7 / L7a / L7b + revisables R11–R12  
- [x] Workflow Phase G + Phase 3 distribution clarification  
- [x] Architecture diagram note + hopper brief one-liner  
