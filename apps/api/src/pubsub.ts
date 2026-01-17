import { createPubSub } from "graphql-yoga";

// Topic name pattern: runUpdated:{runId}
export const pubsub = createPubSub<{
  [topic: `runUpdated:${string}`]: [{ runId: string }];
}>();
