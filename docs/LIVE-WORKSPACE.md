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
| **Magic** | Brief, zip import, readiness, variant plan, prepare/generate; event feed + composer (`/prepare`, `/generate`) |
| **Hopper** | Keep/Kill, deep links; feed fans in prepare/generate/job/review events |
| **Celtra** | **Live content matrix** (all matrix cells as draft/kept/killed + plate status); compact event strip; **Package zip** only includes kept + plated rows |

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

Each column: reverse-chron **event cards** + bottom **composer**.  
Celtra: matrix table on top, compact event strip below.  
LLM status shown when `ATTATTA_LLM_API_KEY` is set; rich agent behavior is deferred.

## Aspirational (not MVP)

- Browser WebSocket (upgrade from SSE)
- Comfy `/ws` progress into job events
- Celtra ingest API + status webhooks mirrored into the right column
- Durable multi-instance event store
