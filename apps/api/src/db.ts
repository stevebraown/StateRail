import Database from "better-sqlite3";
import path from "path";
import { nanoid } from "nanoid";
import fs from "fs";

export type StepType = "HTTP" | "DELAY" | "MANUAL";
export type RunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
export type EventType =
  | "RUN_STARTED"
  | "STEP_STARTED"
  | "STEP_SUCCEEDED"
  | "STEP_FAILED"
  | "RUN_SUCCEEDED"
  | "RUN_FAILED";

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  steps: WorkflowStep[];
}

export interface WorkflowStep {
  id: string;
  workflowId: string;
  name: string;
  type: StepType;
  config: unknown;
  order: number;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface StepRun {
  id: string;
  workflowRunId: string;
  workflowStepId: string;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Event {
  id: string;
  workflowRunId: string;
  stepRunId: string | null;
  type: EventType;
  message: string;
  createdAt: string;
}

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const dbFile = path.join(dataDir, "dev.db");
const db = new Database(dbFile);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_steps (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config TEXT,
  step_order INTEGER NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS step_runs (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  workflow_step_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_step_id) REFERENCES workflow_steps(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  step_run_id TEXT,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (step_run_id) REFERENCES step_runs(id) ON DELETE CASCADE
);
`);

function now() {
  return new Date().toISOString();
}

export function listWorkflows(): Workflow[] {
  const rows = db.prepare("SELECT * FROM workflows ORDER BY created_at DESC").all();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    steps: listWorkflowSteps(row.id)
  }));
}

export function getWorkflow(id: string): Workflow | null {
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    steps: listWorkflowSteps(id)
  };
}

export function listWorkflowSteps(workflowId: string): WorkflowStep[] {
  const rows = db
    .prepare("SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC")
    .all(workflowId);
  return rows.map((r) => ({
    id: r.id,
    workflowId: r.workflow_id,
    name: r.name,
    type: r.type,
    config: r.config ? JSON.parse(r.config) : null,
    order: r.step_order
  }));
}

export function createWorkflow(input: {
  name: string;
  description?: string | null;
  steps: Array<{ name: string; type: StepType; config?: unknown; order: number }>;
}): Workflow {
  const id = nanoid();
  const createdAt = now();
  const insertWorkflow = db.prepare(
    "INSERT INTO workflows (id, name, description, created_at) VALUES (?, ?, ?, ?)"
  );
  const insertStep = db.prepare(
    "INSERT INTO workflow_steps (id, workflow_id, name, type, config, step_order) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const tx = db.transaction(() => {
    insertWorkflow.run(id, input.name, input.description ?? null, createdAt);
    input.steps.forEach((s) => {
      insertStep.run(nanoid(), id, s.name, s.type, JSON.stringify(s.config ?? {}), s.order);
    });
  });
  tx();
  return getWorkflow(id)!;
}

export function updateWorkflow(input: {
  id: string;
  name?: string;
  description?: string | null;
  steps: Array<{ id?: string; name: string; type: StepType; config?: unknown; order: number }>;
}): Workflow {
  const existing = getWorkflow(input.id);
  if (!existing) throw new Error("Workflow not found");

  const updateWf = db.prepare("UPDATE workflows SET name = ?, description = ? WHERE id = ?");
  const deleteSteps = db.prepare("DELETE FROM workflow_steps WHERE workflow_id = ?");
  const insertStep = db.prepare(
    "INSERT INTO workflow_steps (id, workflow_id, name, type, config, step_order) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const tx = db.transaction(() => {
    updateWf.run(input.name ?? existing.name, input.description ?? existing.description, input.id);
    deleteSteps.run(input.id);
    input.steps.forEach((s) => {
      insertStep.run(
        s.id ?? nanoid(),
        input.id,
        s.name,
        s.type,
        JSON.stringify(s.config ?? {}),
        s.order
      );
    });
  });
  tx();
  return getWorkflow(input.id)!;
}

export function createRun(workflowId: string): WorkflowRun {
  const id = nanoid();
  const createdAt = now();
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, created_at, started_at, finished_at) VALUES (?, ?, 'PENDING', ?, NULL, NULL)"
  ).run(id, workflowId, createdAt);
  const steps = listWorkflowSteps(workflowId);
  const insertStepRun = db.prepare(
    "INSERT INTO step_runs (id, workflow_run_id, workflow_step_id, status, started_at, finished_at) VALUES (?, ?, ?, 'PENDING', NULL, NULL)"
  );
  const tx = db.transaction(() => {
    steps.forEach((s) => insertStepRun.run(nanoid(), id, s.id));
  });
  tx();
  return getRun(id)!;
}

export function getRun(id: string): WorkflowRun | null {
  const row = db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id);
  if (!row) return null;
  return {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

export function listRuns(workflowId: string): WorkflowRun[] {
  const rows = db
    .prepare("SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC")
    .all(workflowId);
  return rows.map((r) => ({
    id: r.id,
    workflowId: r.workflow_id,
    status: r.status,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at
  }));
}

export function listStepRuns(runId: string): StepRun[] {
  const rows = db
    .prepare("SELECT * FROM step_runs WHERE workflow_run_id = ? ORDER BY rowid ASC")
    .all(runId);
  return rows.map((r) => ({
    id: r.id,
    workflowRunId: r.workflow_run_id,
    workflowStepId: r.workflow_step_id,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at
  }));
}

export function listEvents(runId: string): Event[] {
  const rows = db
    .prepare("SELECT * FROM events WHERE workflow_run_id = ? ORDER BY created_at ASC")
    .all(runId);
  return rows.map((r) => ({
    id: r.id,
    workflowRunId: r.workflow_run_id,
    stepRunId: r.step_run_id,
    type: r.type,
    message: r.message,
    createdAt: r.created_at
  }));
}

export function updateRunStatus(runId: string, status: RunStatus) {
  const finished =
    status === "SUCCEEDED" || status === "FAILED" ? now() : null;
  db.prepare(
    "UPDATE workflow_runs SET status = ?, started_at = COALESCE(started_at, ?), finished_at = COALESCE(finished_at, ?) WHERE id = ?"
  ).run(status, status === "RUNNING" ? now() : null, finished, runId);
}

export function updateStepRunStatus(
  stepRunId: string,
  status: RunStatus
) {
  const finished =
    status === "SUCCEEDED" || status === "FAILED" ? now() : null;
  db.prepare(
    "UPDATE step_runs SET status = ?, started_at = COALESCE(started_at, ?), finished_at = COALESCE(finished_at, ?) WHERE id = ?"
  ).run(status, status === "RUNNING" ? now() : null, finished, stepRunId);
}

export function appendEvent(input: {
  workflowRunId: string;
  stepRunId?: string | null;
  type: EventType;
  message: string;
}) {
  db.prepare(
    "INSERT INTO events (id, workflow_run_id, step_run_id, type, message, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(nanoid(), input.workflowRunId, input.stepRunId ?? null, input.type, input.message, now());
}

export function getStepRunById(id: string): StepRun | null {
  const row = db.prepare("SELECT * FROM step_runs WHERE id = ?").get(id);
  if (!row) return null;
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    workflowStepId: row.workflow_step_id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

export function getStepRunsMap(runId: string): Record<string, StepRun> {
  const list = listStepRuns(runId);
  return Object.fromEntries(list.map((s) => [s.workflowStepId, s]));
}

export function ensureDataDir() {
  // no-op placeholder; directory is relative to cwd
}
