# Live workspace — 3-column cockpit

**Updated:** 2026-09-02  
**Related:** [APP.md](./APP.md) · [MAGIC.md](./MAGIC.md) · [CELTRA.md](./CELTRA.md) · [COMFY.md](./COMFY.md)

ATTATTA is the **source of truth** for creative → review → delivery. The Live Workspace is a full-screen, three-column UI that stays reactive as Magic, Advanced/Review, and Celtra package state change.

## Entry

- Nav **Workspace**, home **Workspace**, or StepNav **Workspace**
- Picker: choose an existing campaign or **Create & open** (magic campaign)
- Route: `/campaigns/:id/live`

## Columns

| Column | Role |
|--------|------|
| **Magic** | Brief, **delivery size toggles** (defaults from Settings), import, readiness, variant plan, **size coverage XY**, queue; chat suggestions for missing sizes |
| **Hopper** | **Matrix XY / list** of combinations with size dots, detail review Keep/Kill; Activity toggle |
| **Celtra** | **Live content matrix**; Package zip for kept+plated. Activity via header toggle |

Each column has **one scroll body** (header + composer fixed). Nested panel scrollers are avoided so the pointer always scrolls the column.  
**Thumbnails:** ingredients, variant plates, Hopper review cells, Celtra matrix rows, and completed queue jobs show expandable previews when media exists.

Each column header shows an **API chip** (dot + label): Magic→ComfyUI, Hopper→simulated review bus, Celtra→package/matrix (future ingest API). Tap to open status + **Resync**.

Columns expand/collapse independently (at least one stays open).

## Realtime (MVP)

- In-memory **campaign event bus** (`campaignEvents.ts`)
- `GET /campaigns/:id/events` — paginated history (lazy load older)
- `GET /campaigns/:id/events/stream` — **SSE** push of new events
- Client also **polls** events every ~2.5s so columns stay live if SSE drops
- Emitters: magic prepare/generate (also fan hopper/celtra), job status, reviews (+ `celtra_preview`), Comfy publish, Celtra package
- `GET /campaigns/:id/celtra-preview` — **full matrix draft** (not only approved); zip still gated on Keep + plate

Comfy stays publish webhook + job poll. Celtra stays one-way zip (no Celtra cloud API).

## Conversational UI

Magic: ephemeral **chat suggestions** (confirm import, generate, open Hopper) appear when milestones hit and clear after act/dismiss — not a sticky Generate bar.  
**Activity** is a header toggle (next to Collapse) that opens a log panel over the column — off by default.  
LLM status shown when `ATTATTA_LLM_API_KEY` is set; rich agent behavior is deferred.

## Aspirational (not MVP)

- Browser WebSocket (upgrade from SSE)
- Comfy `/ws` progress into job events
- Celtra ingest API + status webhooks mirrored into the right column
- Durable multi-instance event store
