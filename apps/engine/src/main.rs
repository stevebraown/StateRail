use staterail_engine::Engine;
use tracing_subscriber::FmtSubscriber;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let subscriber = FmtSubscriber::builder().with_env_filter("info").finish();
    tracing::subscriber::set_global_default(subscriber)?;

    let engine = Engine::new();
    engine.start().await?;
    Ok(())
}
