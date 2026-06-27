//! Runtime configuration, loaded once from the environment at startup.
//!
//! Everything deployment-specific (cluster name, which namespaces the console
//! manages, the build-catalog ConfigMap, the CI/CD namespace, the product name)
//! is configuration — never hard-coded — so anyone can drop the project onto
//! their own cluster by setting a handful of env vars. See docs/CONFIGURATION.md.

use std::sync::OnceLock;

pub struct Config {
    /// Brand/product name shown in the UI.
    pub product_name: String,
    /// Human-friendly cluster name shown in the masthead/login.
    pub cluster_name: String,
    /// Namespaces the console may read/operate on.
    pub managed_namespaces: Vec<String>,
    /// ConfigMap holding the build catalog (services.json) — optional feature.
    pub build_catalog_cm: String,
    /// Namespace where CI (Jenkins) lives — used for build audit attribution.
    pub cicd_namespace: String,
    /// Optional API-gateway integration (access-log view + config editor).
    pub gateway: Option<GatewayTarget>,
    /// Days to keep audit_log rows (0 = forever).
    pub audit_retention_days: i64,
    /// Days to keep error_events / gateway_errors / status_events (0 = forever).
    pub log_retention_days: i64,
    /// Days to keep k8s_events rows (0 = forever). Default: 7.
    pub event_retention_days: i64,
    /// Sampling for the all-requests gateway feed: persist 1-in-N 2xx requests
    /// (non-2xx are always persisted). 1 = keep all 2xx, 0 = drop all 2xx.
    pub gateway_sample_2xx: i64,
    /// Base URL for the Loki query API (used by the historical log view).
    pub loki_url: String,
    /// Optional node label key marking spot/preemptible nodes (empty = disabled).
    pub spot_label_key: String,
    /// Optional value the spot label must equal (empty = match any value).
    pub spot_label_value: String,
    /// Optional node taint key marking spot/preemptible nodes (empty = disabled).
    pub spot_taint_key: String,
}

/// Which workload is the API gateway, and where its config lives.
#[derive(Clone)]
pub struct GatewayTarget {
    pub namespace: String,
    pub deployment: String,
    /// ConfigMap holding the gateway config (e.g. APISIX apisix.yaml/config.yaml).
    pub config_cm: String,
}

static CONFIG: OnceLock<Config> = OnceLock::new();

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn split_csv(s: &str) -> Vec<String> {
    s.split(',')
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
        .collect()
}

impl Config {
    fn from_env() -> Self {
        let managed = std::env::var("MANAGED_NAMESPACES")
            .ok()
            .map(|s| split_csv(&s))
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| vec!["default".to_string()]);
        let cicd = env_or(
            "CICD_NAMESPACE",
            managed.first().map(String::as_str).unwrap_or("default"),
        );
        // Gateway integration is enabled only when all three are set.
        let gw_ns = std::env::var("GATEWAY_NAMESPACE").ok().filter(|s| !s.trim().is_empty());
        let gw_dep = std::env::var("GATEWAY_DEPLOYMENT").ok().filter(|s| !s.trim().is_empty());
        let gw_cm = std::env::var("GATEWAY_CONFIG_CONFIGMAP").ok().filter(|s| !s.trim().is_empty());
        let gateway = match (gw_ns, gw_dep, gw_cm) {
            (Some(namespace), Some(deployment), Some(config_cm)) => Some(GatewayTarget {
                namespace,
                deployment,
                config_cm,
            }),
            _ => None,
        };

        Self {
            product_name: env_or("PRODUCT_NAME", "inInfra"),
            cluster_name: env_or("CLUSTER_NAME", "kubernetes"),
            managed_namespaces: managed,
            build_catalog_cm: env_or("BUILD_CATALOG_CONFIGMAP", "ininfra-build-catalog"),
            cicd_namespace: cicd,
            gateway,
            audit_retention_days: env_int("AUDIT_RETENTION_DAYS", 90),
            log_retention_days: env_int("LOG_RETENTION_DAYS", 30),
            event_retention_days: env_int("EVENT_RETENTION_DAYS", 7),
            gateway_sample_2xx: env_int("GATEWAY_SAMPLE_2XX", 10),
            loki_url: env_or("LOKI_URL", "http://loki.monitoring.svc:3100"),
            spot_label_key: env_or("SPOT_LABEL_KEY", ""),
            spot_label_value: env_or("SPOT_LABEL_VALUE", ""),
            spot_taint_key: env_or("SPOT_TAINT_KEY", ""),
        }
    }
}

fn env_int(key: &str, default: i64) -> i64 {
    std::env::var(key)
        .ok()
        .and_then(|s| s.trim().parse::<i64>().ok())
        .filter(|n| *n >= 0)
        .unwrap_or(default)
}

/// Initialize from the environment. Call once at startup before `get`.
pub fn init() {
    let cfg = Config::from_env();
    tracing::info!(
        cluster = %cfg.cluster_name,
        namespaces = ?cfg.managed_namespaces,
        "configuration loaded"
    );
    let _ = CONFIG.set(cfg);
}

pub fn get() -> &'static Config {
    CONFIG.get().expect("config::init() must run before config::get()")
}
