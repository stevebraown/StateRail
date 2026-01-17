Secure Multi-Tenant Document Workflow  
Event-Driven • Versioned • Auditable • Rust-Powered

## Overview
This project implements a secure, multi-tenant document workflow system designed around strictly ordered, event-driven state transitions. Documents move through controlled workflows (upload → review → approval → archive) where:
- Every change is versioned
- Every action emits a structured event
- No step can occur unless its parent state already exists
- Full document and workflow history is observable and replayable

The system is built for traceability, correctness, and trust, making it suitable for regulated, enterprise, and compliance-sensitive environments.

## Core Principles
1. **Event-First Architecture**
   - All actions emit structured domain events.
   - Events are the source of truth, not logs.
   - If an event exists, the state transition did happen.

2. **Strictly Ordered State Transitions**
   - Events follow a hierarchical chain.
   - An event cannot be emitted unless its parent state has already been durably persisted.
   - Example:
     - DocumentCreated
       - VersionUploaded
         - AccessGranted
           - Viewed
             - Commented
               - Approved
                 - Archived
   - Guarantees: causal consistency; no skipped steps; no invalid states.

3. **Immutable Versioning**
   - Documents are never modified in place.
   - Any change produces a new version.
   - Old versions remain readable and auditable.

4. **Full Observability & Audit Trail**
   - For every document and workflow, the system can answer: who accessed it, when, what changed, in what order, under which permissions.
   - Both current workflow state and complete historical timelines can be observed.

## System Architecture
```
┌─────────────┐        HTTP/JSON        ┌─────────────────────┐
│  Frontend   │  ───────────────────▶  │   Rust API (Axum)   │
│  Next.js    │                         │   Event-Driven Core │
└─────────────┘                         └──────────┬──────────┘
                                                   │
                                                   │
                                            ┌──────▼──────┐
                                            │  Postgres   │
                                            │  State +    │
                                            │  Event Log  │
                                            └─────────────┘
```

## Tech Stack
- **Frontend:** Next.js — secure document UI, workflow timelines, version history views (http://localhost:3000)
- **Backend:** Rust (Axum) — strong typing & explicit state transitions; event emission on every mutation (http://localhost:8080/api/v1)
- **Database:** PostgreSQL — durable state persistence; append-only event history; tenant-scoped access

## Key Features
- **Document Versioning:** Every upload creates a new immutable version; metadata includes author, timestamp, reason.
- **Access Control:** Tenant-aware RBAC; explicit permission grants; access events are recorded.
- **Workflow Enforcement:** Review and approval steps are mandatory; no bypass of rules.
- **Audit & History:** Append-only event log; full document timeline; replayable state transitions.

## Example Event (Structured)
```
{
  "event_type": "document_version_uploaded",
  "document_id": "doc_123",
  "version": 3,
  "actor_id": "user_42",
  "tenant_id": "tenant_a",
  "timestamp": "2026-01-16T14:22:31Z",
  "parent_event_id": "document_created"
}
```

## Why This Design
Traditional CRUD-based document systems lose history, allow invalid state changes, are hard to audit, and break under concurrency. This system is designed to:
- Make invalid states impossible
- Make history permanent
- Make debugging and compliance straightforward

## Intended Use Cases
- Enterprise document approval flows
- Legal & compliance workflows
- Internal knowledge systems
- Financial or regulated environments
- Systems requiring non-repudiation

## Project Status
🚧 Active development  
Planned improvements:
- Workflow templates
- Event streaming (Kafka / NATS)
- Cryptographic document hashing
- External audit export
- Webhook notifications

## Philosophy
“If it isn’t observable, it isn’t reliable.  
If it isn’t ordered, it isn’t trustworthy.”  
This project prioritizes correctness over convenience and traceability over speed.

## Author
Steve Braown  
Full-stack product & systems engineer  
Focus: Rust, event-driven systems, and reliable platforms
