import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import {
  CampaignEventSchema,
  type CampaignEvent,
  type CampaignEventType,
  type LiveColumnId,
} from "@attatta/shared";

const RING_CAP = 500;

type BusState = {
  events: CampaignEvent[];
  emitter: EventEmitter;
};

const buses = new Map<string, BusState>();

function busFor(campaignId: string): BusState {
  let b = buses.get(campaignId);
  if (!b) {
    b = { events: [], emitter: new EventEmitter() };
    b.emitter.setMaxListeners(100);
    buses.set(campaignId, b);
  }
  return b;
}

export function emitCampaignEvent(input: {
  campaignId: string;
  column: LiveColumnId;
  type: CampaignEventType;
  summary: string;
  payload?: Record<string, unknown>;
}): CampaignEvent {
  const event = CampaignEventSchema.parse({
    id: nanoid(12),
    at: new Date().toISOString(),
    campaignId: input.campaignId,
    column: input.column,
    type: input.type,
    summary: input.summary,
    payload: input.payload ?? {},
  });
  const bus = busFor(input.campaignId);
  bus.events.push(event);
  if (bus.events.length > RING_CAP) {
    bus.events.splice(0, bus.events.length - RING_CAP);
  }
  bus.emitter.emit("event", event);
  return event;
}

/** Newest-first page. `before` = load older than this event id. */
export function listCampaignEvents(
  campaignId: string,
  opts?: { before?: string | null; after?: string | null; limit?: number },
): { events: CampaignEvent[]; hasMore: boolean } {
  const bus = busFor(campaignId);
  const lim = Math.min(Math.max(opts?.limit ?? 40, 1), 100);
  let slice = [...bus.events];

  if (opts?.after) {
    const idx = slice.findIndex((e) => e.id === opts.after);
    if (idx >= 0) slice = slice.slice(idx + 1);
    else slice = [];
  }

  if (opts?.before) {
    const idx = slice.findIndex((e) => e.id === opts.before);
    if (idx >= 0) slice = slice.slice(0, idx);
  }

  // Return newest first for UI feeds
  const newestFirst = slice.slice().reverse();
  const page = newestFirst.slice(0, lim);
  return { events: page, hasMore: newestFirst.length > lim };
}

export function subscribeCampaignEvents(
  campaignId: string,
  listener: (event: CampaignEvent) => void,
): () => void {
  const bus = busFor(campaignId);
  bus.emitter.on("event", listener);
  return () => bus.emitter.off("event", listener);
}
