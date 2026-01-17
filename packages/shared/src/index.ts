export type WorkflowId = string;
export type RunId = string;
export type StepId = string;

export interface EventEnvelope<T = unknown> {
  eventType: string;
  workflowId: WorkflowId;
  runId: RunId;
  stepId?: StepId;
  payload?: T;
  ts: string;
  traceId?: string;
  correlationId?: string;
}
