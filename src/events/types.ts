export type LoopTopic = "loop.start" | "loop.complete" | "loop.stop";
export type IterationTopic = "iteration.start" | "iteration.finish";
export type BackendTopic = "backend.start" | "backend.finish";
export type ReviewTopic = "review.start" | "review.finish";
export type CoordinationTopic =
  | "issue.discovered"
  | "issue.resolved"
  | "slice.started"
  | "slice.verified"
  | "slice.committed"
  | "context.archived"
  | "chain.spawn";
export type ChainTopic = "chain.start" | "chain.complete";
export type WaveTopic = string;
export type CoreSystemTopic =
  | LoopTopic
  | IterationTopic
  | BackendTopic
  | ReviewTopic
  | "event.invalid";
export type KnownTopic =
  | CoreSystemTopic
  | CoordinationTopic
  | ChainTopic
  | WaveTopic
  | string;

export interface EventBase {
  run: string;
  topic: KnownTopic;
  iteration?: string;
}

export interface FieldsEvent extends EventBase {
  shape: "fields";
  fields: Record<string, string>;
  rawFields?: Record<string, unknown>;
}

export interface PayloadEvent extends EventBase {
  shape: "payload";
  payload: string;
  source?: string;
}

export type JournalEvent = FieldsEvent | PayloadEvent;
