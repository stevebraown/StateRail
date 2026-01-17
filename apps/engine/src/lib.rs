use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WorkflowState {
    Created,
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StepState {
    Idle,
    Queued,
    Running,
    Succeeded,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transition {
    pub to: String,
    pub condition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Step {
    pub id: String,
    pub kind: String,
    pub config: serde_json::Value,
    pub transitions: Vec<Transition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDefinition {
    pub id: String,
    pub name: String,
    pub version: i32,
    pub steps: HashMap<String, Step>,
}

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("unknown workflow {0}")]
    UnknownWorkflow(String),
    #[error("invalid transition")]
    InvalidTransition,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

pub struct Engine {}

impl Engine {
    pub fn new() -> Self {
        Self {}
    }

    pub async fn start(&self) -> Result<(), EngineError> {
        info!("engine placeholder start");
        Ok(())
    }
}
