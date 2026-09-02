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
| **Magic** | Brief, prepare, generate; event feed + composer (`/prepare`, `/generate`) |
| **Hopper** | Keep/Kill, deep links to Ingredients/Matrix/Variants/Assemble; feed of review/job events |
| **Celtra** | Live package **preview** (rows from approved + plates); **Package zip** writes versioned zip |

Columns expand/collapse independently (at least one stays open).

## Realtime (MVP)

- In-memory **campaign event bus** (`campaignEvents.ts`)
- `GET /campaigns/:id/events` — paginated history (lazy load older)
- `GET /campaigns/:id/events/stream` — **SSE** push of new events
- Emitters: magic prepare/generate, job status, reviews, Comfy publish, Celtra package
- `GET /campaigns/:id/celtra-preview` — matrix preview without writing a zip

Comfy stays publish webhook + job poll. Celtra stays one-way zip (no Celtra cloud API).

## Conversational UI

Each column: reverse-chron **event cards** + bottom **composer**.  
LLM status shown when `ATTATTA_LLM_API_KEY` is set; rich agent behavior is deferred.

## Aspirational (not MVP)

- Browser WebSocket (upgrade from SSE)
- Comfy `/ws` progress into job events
- Celtra ingest API + status webhooks mirrored into the right column
- Durable multi-instance event store
