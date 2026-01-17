import fetch from "node-fetch";
import {
  appendEvent,
  EventType,
  getRun,
  getStepRunById,
  getStepRunsMap,
  getWorkflow,
  listWorkflowSteps,
  RunStatus,
  StepRun,
  updateRunStatus,
  updateStepRunStatus
} from "./db";
import { pubsub } from "./pubsub";

const activeRuns = new Set<string>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function enqueueRun(runId: string) {
  if (activeRuns.has(runId)) return;
  activeRuns.add(runId);
  execute(runId).finally(() => activeRuns.delete(runId));
}

async function execute(runId: string) {
  const run = getRun(runId);
  if (!run) return;
  const workflow = getWorkflow(run.workflowId);
  if (!workflow) return;

  updateRunStatus(runId, "RUNNING");
  appendEvent({ workflowRunId: runId, type: "RUN_STARTED", message: "Run started" });
  await publishRun(runId);

  const steps = listWorkflowSteps(workflow.id);
  const stepRunMap = getStepRunsMap(runId);

  for (const step of steps) {
    const stepRun = stepRunMap[step.id];
    if (!stepRun) continue;
    if (stepRun.status === "SUCCEEDED") continue;
    if (stepRun.status === "FAILED") {
      updateRunStatus(runId, "FAILED");
      appendEvent({
        workflowRunId: runId,
        stepRunId: stepRun.id,
        type: "RUN_FAILED",
        message: "Run already failed"
      });
      return;
    }

    if (step.type === "MANUAL") {
      if (stepRun.status === "PENDING") {
        appendEvent({
          workflowRunId: runId,
          stepRunId: stepRun.id,
          type: "STEP_STARTED",
          message: `Manual step '${step.name}' awaiting completion`
        });
        await publishRun(runId);
      }
      return; // pause until manual completion
    }

    await runNonManualStep(runId, stepRun, step.type, step.config);
    if (getRun(runId)?.status === "FAILED") return;
  }

  updateRunStatus(runId, "SUCCEEDED");
  appendEvent({ workflowRunId: runId, type: "RUN_SUCCEEDED", message: "Run succeeded" });
  await publishRun(runId);
}

async function runNonManualStep(
  runId: string,
  stepRun: StepRun,
  type: string,
  config: any
) {
  updateStepRunStatus(stepRun.id, "RUNNING");
  appendEvent({
    workflowRunId: runId,
    stepRunId: stepRun.id,
    type: "STEP_STARTED",
    message: `Step started`
  });
  await publishRun(runId);

  try {
    if (type === "DELAY") {
      const seconds = Number(config?.seconds ?? 1);
      await sleep(seconds * 1000);
    } else if (type === "HTTP") {
      const url = config?.url;
      if (!url) throw new Error("Missing url");
      const method = (config?.method ?? "GET") as string;
      const res = await fetch(url, { method });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
    updateStepRunStatus(stepRun.id, "SUCCEEDED");
    appendEvent({
      workflowRunId: runId,
      stepRunId: stepRun.id,
      type: "STEP_SUCCEEDED",
      message: "Step succeeded"
    });
    await publishRun(runId);
  } catch (err: any) {
    updateStepRunStatus(stepRun.id, "FAILED");
    appendEvent({
      workflowRunId: runId,
      stepRunId: stepRun.id,
      type: "STEP_FAILED",
      message: `Step failed: ${err?.message ?? err}`
    });
    updateRunStatus(runId, "FAILED");
    appendEvent({ workflowRunId: runId, type: "RUN_FAILED", message: "Run failed" });
    await publishRun(runId);
  }
}

export async function completeManualStep(stepRunId: string, success: boolean) {
  const stepRun = getStepRunById(stepRunId);
  if (!stepRun) throw new Error("StepRun not found");
  if (stepRun.status === "SUCCEEDED" || stepRun.status === "FAILED") return stepRun;

  updateStepRunStatus(stepRunId, success ? "SUCCEEDED" : "FAILED");
  appendEvent({
    workflowRunId: stepRun.workflowRunId,
    stepRunId,
    type: success ? ("STEP_SUCCEEDED" as EventType) : ("STEP_FAILED" as EventType),
    message: success ? "Manual step completed" : "Manual step failed"
  });
  await publishRun(stepRun.workflowRunId);

  if (!success) {
    updateRunStatus(stepRun.workflowRunId, "FAILED");
    appendEvent({
      workflowRunId: stepRun.workflowRunId,
      type: "RUN_FAILED",
      message: "Run failed by manual step"
    });
    await publishRun(stepRun.workflowRunId);
    return getStepRunById(stepRunId);
  }

  // resume execution
  await enqueueRun(stepRun.workflowRunId);
  return getStepRunById(stepRunId);
}

async function publishRun(runId: string) {
  await pubsub.publish(`runUpdated:${runId}`, [{ runId }]);
}
