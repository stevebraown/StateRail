import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createClient } from "graphql-ws";
import ReactFlow, { Edge, Node } from "reactflow";
import "reactflow/dist/style.css";

type StepType = "HTTP" | "DELAY" | "MANUAL";
type RunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

type WorkflowStep = {
  id?: string;
  name: string;
  type: StepType;
  config?: any;
  order: number;
};

type Workflow = {
  id: string;
  name: string;
  description?: string | null;
  createdAt: string;
  steps: WorkflowStep[];
};

type WorkflowRun = {
  id: string;
  workflowId: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
};

type StepRun = {
  id: string;
  workflowRunId: string;
  workflowStepId: string;
  status: RunStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
};

type Event = {
  id: string;
  workflowRunId: string;
  stepRunId?: string | null;
  type: string;
  message: string;
  createdAt: string;
};

const client = new QueryClient();
const API_URL = "http://localhost:4000/graphql";
const WS_URL = "ws://localhost:4000/graphql";
const wsClient = createClient({ url: WS_URL });

async function gql<T>(query: string, variables?: Record<string, any>): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables })
  });
  const body = await res.json();
  if (!res.ok || body.errors) {
    throw new Error(body.errors?.[0]?.message ?? `GraphQL error ${res.status}`);
  }
  return body.data as T;
}

export function App() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  return (
    <QueryClientProvider client={client}>
      <div style={{ display: "flex", gap: 16, padding: 24, alignItems: "flex-start" }}>
        <WorkflowList onSelect={(id) => { setSelectedWorkflow(id); setSelectedRun(null); }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          <WorkflowEditor workflowId={selectedWorkflow} />
          {selectedWorkflow && (
            <WorkflowRuns
              workflowId={selectedWorkflow}
              onSelectRun={(id) => setSelectedRun(id)}
              selectedRunId={selectedRun}
            />
          )}
          {selectedRun && <RunDetail runId={selectedRun} />}
        </div>
      </div>
    </QueryClientProvider>
  );
}

function WorkflowList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["workflows"],
    queryFn: () =>
      gql<{ workflows: Workflow[] }>(`query { workflows { id name description createdAt } }`)
  });
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (input: { name: string }) =>
      gql<{ createWorkflow: Workflow }>(
        `mutation CreateWorkflow($name: String!) {
          createWorkflow(name: $name, description: "", steps: []) { id name }
        }`,
        { name: input.name }
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
      onSelect(res.createWorkflow.id);
    }
  });

  if (isLoading) return <div>Loading workflows…</div>;
  if (error) return <div style={{ color: "red" }}>Error loading workflows</div>;

  return (
    <div style={{ width: 260, border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Workflows</h3>
        <button
          onClick={() => {
            const name = window.prompt("Workflow name?");
            if (name) createMutation.mutate({ name });
          }}
        >
          + New
        </button>
      </div>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {data?.workflows.map((w) => (
          <li key={w.id}>
            <button style={{ width: "100%", textAlign: "left" }} onClick={() => onSelect(w.id)}>
              <div style={{ fontWeight: 600 }}>{w.name}</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>{w.description ?? ""}</div>
            </button>
          </li>
        ))}
      </ul>
      <button style={{ marginTop: 8 }} onClick={() => refetch()}>
        Refresh
      </button>
    </div>
  );
}

function WorkflowEditor({ workflowId }: { workflowId: string | null }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["workflow", workflowId],
    enabled: !!workflowId,
    queryFn: () =>
      gql<{ workflow: Workflow }>(`query ($id: ID!) {
        workflow(id: $id) {
          id name description createdAt
          steps { id name type config order }
        }
      }`, { id: workflowId })
  });

  const [local, setLocal] = useState<Workflow | null>(null);

  useEffect(() => {
    if (data?.workflow) {
      setLocal({
        ...data.workflow,
        steps: [...data.workflow.steps].sort((a, b) => a.order - b.order)
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (wf: Workflow) =>
      gql<{ updateWorkflow: Workflow }>(
        `mutation UpdateWorkflow($id: ID!, $name: String, $description: String, $steps: [WorkflowStepInput!]!) {
          updateWorkflow(id: $id, name: $name, description: $description, steps: $steps) {
            id name
          }
        }`,
        {
          id: wf.id,
          name: wf.name,
          description: wf.description ?? "",
          steps: wf.steps.map((s, idx) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            config: s.config ?? {},
            order: idx
          }))
        }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow", workflowId] });
      qc.invalidateQueries({ queryKey: ["workflows"] });
      alert("Saved");
    }
  });

  if (!workflowId) return <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 8 }}>Select a workflow.</div>;
  if (!local) return <div style={{ padding: 12 }}>Loading workflow…</div>;

  const updateStep = (idx: number, patch: Partial<WorkflowStep>) => {
    const next = [...local.steps];
    next[idx] = { ...next[idx], ...patch };
    setLocal({ ...local, steps: next });
  };

  const addStep = () => {
    setLocal({
      ...local,
      steps: [
        ...local.steps,
        { name: "New Step", type: "HTTP", config: { url: "https://example.com" }, order: local.steps.length }
      ]
    });
  };

  const removeStep = (idx: number) => {
    const next = local.steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i }));
    setLocal({ ...local, steps: next });
  };

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
      <h3>Edit Workflow</h3>
      <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
        <input
          style={{ flex: 1 }}
          value={local.name}
          onChange={(e) => setLocal({ ...local, name: e.target.value })}
          placeholder="Workflow name"
        />
        <input
          style={{ flex: 1 }}
          value={local.description ?? ""}
          onChange={(e) => setLocal({ ...local, description: e.target.value })}
          placeholder="Description"
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {local.steps.map((step, idx) => (
          <div key={idx} style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <strong>Step {idx + 1}</strong>
              <button onClick={() => removeStep(idx)} style={{ marginLeft: "auto" }}>
                Remove
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <input
                style={{ flex: 1 }}
                value={step.name}
                onChange={(e) => updateStep(idx, { name: e.target.value })}
                placeholder="Name"
              />
              <select
                value={step.type}
                onChange={(e) => updateStep(idx, { type: e.target.value as StepType })}
              >
                <option value="HTTP">HTTP</option>
                <option value="DELAY">DELAY</option>
                <option value="MANUAL">MANUAL</option>
              </select>
            </div>
            {step.type === "HTTP" && (
              <input
                style={{ marginTop: 6, width: "100%" }}
                value={step.config?.url ?? ""}
                onChange={(e) => updateStep(idx, { config: { ...step.config, url: e.target.value } })}
                placeholder="URL (HTTP GET)"
              />
            )}
            {step.type === "DELAY" && (
              <input
                style={{ marginTop: 6, width: 180 }}
                type="number"
                min={0}
                value={step.config?.seconds ?? 1}
                onChange={(e) => updateStep(idx, { config: { seconds: Number(e.target.value) } })}
                placeholder="Seconds"
              />
            )}
            {step.type === "MANUAL" && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>Manual step will pause run until completed.</div>}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={addStep}>+ Add step</button>
        <button onClick={() => saveMutation.mutate(local)} disabled={saveMutation.isLoading}>
          {saveMutation.isLoading ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function WorkflowRuns({
  workflowId,
  onSelectRun,
  selectedRunId
}: {
  workflowId: string;
  onSelectRun: (id: string) => void;
  selectedRunId: string | null;
}) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["runs", workflowId],
    queryFn: () =>
      gql<{ runs: WorkflowRun[] }>(
        `query Runs($workflowId: ID!) { runs(workflowId: $workflowId) { id status createdAt startedAt finishedAt } }`,
        { workflowId }
      ),
    refetchInterval: 2000
  });

  const startRunMutation = useMutation({
    mutationFn: () =>
      gql<{ startRun: WorkflowRun }>(
        `mutation StartRun($workflowId: ID!) { startRun(workflowId: $workflowId) { id status } }`,
        { workflowId }
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["runs", workflowId] });
      onSelectRun(res.startRun.id);
    }
  });

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Runs</h3>
        <button onClick={() => startRunMutation.mutate()} disabled={startRunMutation.isLoading}>
          {startRunMutation.isLoading ? "Starting..." : "Start run"}
        </button>
      </div>
      {isLoading && <div>Loading runs…</div>}
      {error && <div style={{ color: "red" }}>Error loading runs</div>}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <thead>
          <tr>
            <th align="left">ID</th>
            <th>Status</th>
            <th>Created</th>
            <th>Duration</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data?.runs.map((r) => {
            const duration =
              r.startedAt && r.finishedAt
                ? `${Math.round(
                    (new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000
                  )}s`
                : "-";
            return (
              <tr key={r.id} style={{ background: r.id === selectedRunId ? "#eef2ff" : "transparent" }}>
                <td>{r.id.slice(0, 6)}</td>
                <td>{r.status}</td>
                <td>{new Date(r.createdAt).toLocaleTimeString()}</td>
                <td>{duration}</td>
                <td>
                  <button onClick={() => onSelectRun(r.id)}>Open</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RunDetail({ runId }: { runId: string }) {
  useRunSubscription(runId);

  const { data, isLoading, error } = useQuery({
    queryKey: ["run", runId],
    queryFn: () =>
      gql<{
        run: { id: string; workflowId: string; status: RunStatus; stepRuns: StepRun[]; events: Event[] };
      }>(
        `query Run($id: ID!) {
          run(id: $id) {
            id workflowId status
            stepRuns { id workflowStepId status startedAt finishedAt }
            events { id type message createdAt stepRunId }
          }
        }`,
        { id: runId }
      ),
    refetchInterval: 1500
  });

  const { data: workflowData } = useQuery({
    queryKey: ["workflow", data?.run?.workflowId],
    enabled: !!data?.run?.workflowId,
    queryFn: () =>
      gql<{ workflow: Workflow }>(
        `query ($id: ID!) { workflow(id: $id) { id name steps { id name type order } } }`,
        { id: data?.run?.workflowId }
      )
  });

  const qc = useQueryClient();
  const completeMutation = useMutation({
    mutationFn: (payload: { stepRunId: string; success: boolean }) =>
      gql<{ completeManualStep: StepRun }>(
        `mutation Complete($stepRunId: ID!, $success: Boolean!) {
          completeManualStep(stepRunId: $stepRunId, success: $success) { id status }
        }`,
        payload
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["run", runId] });
    }
  });

  if (isLoading) return <div>Loading run…</div>;
  if (error) return <div style={{ color: "red" }}>Error loading run</div>;
  if (!data?.run) return <div>No run found.</div>;

  const steps = (workflowData?.workflow?.steps ?? []).sort((a, b) => a.order - b.order);
  const stepRunsMap = Object.fromEntries((data.run.stepRuns ?? []).map((sr) => [sr.workflowStepId, sr]));

  const manualPending = steps.find((s) => {
    const sr = stepRunsMap[s.id];
    return s.type === "MANUAL" && sr?.status === "PENDING";
  });

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Run {runId.slice(0, 6)} — {data.run.status}</h3>
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <RunGraph steps={steps} stepRuns={data.run.stepRuns} />
        </div>
        <div style={{ flex: 1 }}>
          <h4>Steps</h4>
          <ol>
            {steps.map((step, idx) => {
              const sr = stepRunsMap[step.id];
              return (
                <li key={step.id} style={{ marginBottom: 6 }}>
                  <span style={{ fontWeight: 600 }}>{idx + 1}. {step.name}</span>{" "}
                  <span style={{ color: colorForStatus(sr?.status) }}>{sr?.status ?? "PENDING"}</span>{" "}
                  <span style={{ color: "#6b7280", fontSize: 12 }}>({step.type})</span>
                  {step.type === "MANUAL" && sr?.status === "PENDING" && (
                    <span style={{ marginLeft: 8 }}>
                      <button onClick={() => completeMutation.mutate({ stepRunId: sr.id, success: true })}>Mark success</button>{" "}
                      <button onClick={() => completeMutation.mutate({ stepRunId: sr.id, success: false })}>Mark failed</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
        <div style={{ flex: 1 }}>
          <h4>Events</h4>
          <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 6, padding: 8 }}>
            {data.run.events.map((ev) => (
              <div key={ev.id} style={{ fontSize: 13, marginBottom: 4 }}>
                <strong>{ev.type}</strong> — {ev.message} <span style={{ color: "#6b7280" }}>{new Date(ev.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {manualPending && (
        <div style={{ marginTop: 8, color: "#374151" }}>
          Manual step pending — complete it to resume.
        </div>
      )}
    </div>
  );
}

function colorForStatus(status?: RunStatus) {
  if (status === "RUNNING") return "#2563eb";
  if (status === "SUCCEEDED") return "#16a34a";
  if (status === "FAILED") return "#dc2626";
  return "#6b7280";
}

function RunGraph({ steps, stepRuns }: { steps: WorkflowStep[]; stepRuns: StepRun[] }) {
  const stepRunsMap = Object.fromEntries(stepRuns.map((sr) => [sr.workflowStepId, sr]));

  const nodes: Node[] = steps.map((step, idx) => {
    const sr = stepRunsMap[step.id ?? ""];
    const statusColor = colorForStatus(sr?.status);
    return {
      id: step.id ?? String(idx),
      data: { label: `${step.name} (${step.type})` },
      position: { x: idx * 180, y: 50 },
      style: {
        padding: 12,
        border: "1px solid #1f2937",
        borderRadius: 8,
        background: statusColor === "#6b7280" ? "#f3f4f6" : statusColor + "22"
      }
    };
  });

  const edges: Edge[] = steps.slice(0, -1).map((step, idx) => ({
    id: `e-${step.id}-${steps[idx + 1].id}`,
    source: step.id ?? String(idx),
    target: steps[idx + 1].id ?? String(idx + 1)
  }));

  return (
    <div style={{ height: 200, border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 8 }}>
      <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.2 }} />
    </div>
  );
}

function useRunSubscription(runId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!runId) return;
    const dispose = wsClient.subscribe(
      {
        query: `
          subscription RunUpdated($runId: ID!) {
            runUpdated(runId: $runId) {
              id
              workflowId
              status
              stepRuns { id workflowStepId status startedAt finishedAt }
              events { id type message createdAt stepRunId }
            }
          }
        `,
        variables: { runId }
      },
      {
        next: (msg) => {
          // @ts-ignore
          const run = msg.data?.runUpdated;
          if (run) {
            qc.setQueryData(["run", runId], { run });
          }
        },
        error: (err) => console.error("subscription error", err),
        complete: () => {}
      }
    );
    return () => dispose();
  }, [runId, qc]);
}
