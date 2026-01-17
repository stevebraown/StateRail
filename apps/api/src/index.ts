import { createYoga, createSchema } from "graphql-yoga";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/lib/use/ws";
import {
  appendEvent,
  createRun,
  createWorkflow,
  getRun,
  getWorkflow,
  listEvents,
  listRuns,
  listWorkflows,
  listWorkflowSteps,
  listStepRuns,
  updateWorkflow
} from "./db";
import { completeManualStep, enqueueRun } from "./executor";
import { pubsub } from "./pubsub";

const typeDefs = /* GraphQL */ `
  scalar JSON
  scalar DateTime

  enum StepType { HTTP DELAY MANUAL }
  enum RunStatus { PENDING RUNNING SUCCEEDED FAILED }
  enum EventType { RUN_STARTED STEP_STARTED STEP_SUCCEEDED STEP_FAILED RUN_SUCCEEDED RUN_FAILED }

  type Workflow {
    id: ID!
    name: String!
    description: String
    createdAt: DateTime!
    steps: [WorkflowStep!]!
  }

  type WorkflowStep {
    id: ID!
    workflowId: ID!
    name: String!
    type: StepType!
    config: JSON
    order: Int!
  }

  type WorkflowRun {
    id: ID!
    workflowId: ID!
    status: RunStatus!
    createdAt: DateTime!
    startedAt: DateTime
    finishedAt: DateTime
    stepRuns: [StepRun!]!
    events: [Event!]!
  }

  type StepRun {
    id: ID!
    workflowRunId: ID!
    workflowStepId: ID!
    status: RunStatus!
    startedAt: DateTime
    finishedAt: DateTime
  }

  type Event {
    id: ID!
    workflowRunId: ID!
    stepRunId: ID
    type: EventType!
    message: String!
    createdAt: DateTime!
  }

  input WorkflowStepInput {
    id: ID
    name: String!
    type: StepType!
    config: JSON
    order: Int!
  }

  type Query {
    health: String!
    workflows: [Workflow!]!
    workflow(id: ID!): Workflow
    runs(workflowId: ID!): [WorkflowRun!]!
    run(id: ID!): WorkflowRun
  }

  type Mutation {
    createWorkflow(name: String!, description: String, steps: [WorkflowStepInput!]!): Workflow!
    updateWorkflow(id: ID!, name: String, description: String, steps: [WorkflowStepInput!]!): Workflow!
    startRun(workflowId: ID!): WorkflowRun!
    completeManualStep(stepRunId: ID!, success: Boolean!): StepRun!
  }

  type Subscription {
    runUpdated(runId: ID!): WorkflowRun!
  }
`;

const resolvers = {
  Query: {
    health: () => "ok",
    workflows: () => listWorkflows(),
    workflow: (_: unknown, { id }: { id: string }) => getWorkflow(id),
    runs: (_: unknown, { workflowId }: { workflowId: string }) => listRuns(workflowId),
    run: (_: unknown, { id }: { id: string }) => getRun(id)
  },
  WorkflowRun: {
    stepRuns: (parent: any) => listStepRunsSafe(parent.id),
    events: (parent: any) => listEvents(parent.id)
  },
  Workflow: {
    steps: (parent: any) => listWorkflowSteps(parent.id)
  },
  Mutation: {
    createWorkflow: (_: unknown, args: any) => createWorkflow(args),
    updateWorkflow: (_: unknown, args: any) => updateWorkflow(args),
    startRun: async (_: unknown, { workflowId }: { workflowId: string }) => {
      const run = createRun(workflowId);
      appendEvent({ workflowRunId: run.id, type: "RUN_STARTED", message: "Run enqueued" });
      await enqueueRun(run.id);
      return {
        ...run,
        stepRuns: listStepRunsSafe(run.id),
        events: listEvents(run.id)
      };
    },
    completeManualStep: async (_: unknown, { stepRunId, success }: { stepRunId: string; success: boolean }) => {
      const result = await completeManualStep(stepRunId, success);
      return result;
    }
  },
  Subscription: {
    runUpdated: {
      subscribe: (_: unknown, { runId }: { runId: string }) => pubsub.subscribe(`runUpdated:${runId}`),
      resolve: (payload: { runId: string }) => getRun(payload.runId)
    }
  }
};

function listStepRunsSafe(runId: string) {
  return listStepRuns(runId);
}

const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),
  cors: { origin: "*", credentials: false }
});

const server = createServer(yoga);
const wsServer = new WebSocketServer({ server, path: yoga.graphqlEndpoint });

useServer(
  {
    onSubscribe: async (ctx, msg) => {
      const { schema, execute, subscribe, contextFactory, parse, validate } = yoga.getEnveloped({
        request: ctx.extra.request,
        socket: ctx.extra.socket,
        params: msg.payload
      });

      const executionArgs = {
        schema,
        operationName: msg.payload.operationName,
        document: parse(msg.payload.query),
        variableValues: msg.payload.variables,
        contextValue: await contextFactory(),
        execute,
        subscribe
      };

      const errors = validate(schema, executionArgs.document);
      if (errors.length) return errors;
      return executionArgs;
    }
  },
  wsServer
);
const port = Number(process.env.PORT || 4000);

server.listen(port, () => {
  console.log(`GraphQL API ready at http://localhost:${port}${yoga.graphqlEndpoint}`);
});
