use tracing_subscriber::FmtSubscriber;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let subscriber = FmtSubscriber::builder().with_env_filter("info").finish();
    tracing::subscriber::set_global_default(subscriber)?;

    tracing::info!("analytics service scaffold start");
    // TODO: connect to event stream and expose metrics API
    Ok(())
}
