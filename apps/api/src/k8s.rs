//! Kubernetes client initialization.
//!
//! In-cluster the client is built from the mounted ServiceAccount token (see
//! deploy/k8s RBAC). Locally it falls back to the kubeconfig current-context.
//! Build-phase agents add typed accessors (deployments, configmaps, secrets,
//! pods, logs, nodes) on top of this client.

use k8s_openapi::api::core::v1::Pod;
use kube::api::AttachParams;
use kube::{Api, Client};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::error::{ApiError, ApiResult};

/// Namespaces the console is permitted to operate on (runtime settings).
///
/// Reads the reloadable settings (wizard-chosen post-setup, env defaults
/// before), so the allowlist tracks the live configuration. Returns an owned
/// `Vec` (a cheap snapshot) since the settings are no longer `'static`.
pub fn managed_namespaces() -> Vec<String> {
    crate::settings::get().managed_namespaces.clone()
}

/// Returns true when `ns` is in the operate-on allowlist.
pub fn is_allowed_namespace(ns: &str) -> bool {
    crate::settings::get()
        .managed_namespaces
        .iter()
        .any(|n| n == ns)
}

/// Guard a (possibly user-supplied) namespace against the allowlist. Every
/// read or mutating handler that takes a `:ns` path param funnels through
/// this so out-of-scope namespaces are rejected uniformly with 403.
pub fn require_namespace(ns: &str) -> ApiResult<()> {
    if is_allowed_namespace(ns) {
        Ok(())
    } else {
        Err(ApiError::Forbidden(format!(
            "namespace {ns:?} is not managed by this console"
        )))
    }
}

/// Build a kube `Client`. Tries in-cluster config first (ServiceAccount),
/// then falls back to the local kubeconfig for development.
pub async fn init_client() -> ApiResult<Client> {
    // `Client::try_default()` already implements the in-cluster → kubeconfig
    // fallback chain via `kube::Config::infer()`.
    let client = Client::try_default().await?;
    tracing::info!("kube client initialized");
    Ok(client)
}

/// Captured result of running a command inside a pod.
pub struct ExecOutput {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub success: bool,
}

/// Run `command` inside `pod`/`container` via the exec (websocket) subresource,
/// optionally feeding `stdin_data`, and capture stdout/stderr + exit success.
///
/// Used by the PVC file browser. Callers MUST pass any user-controlled path as
/// a positional argument (e.g. `sh -c 'ls "$1"' sh <path>`) rather than
/// interpolating it into the script, so a filename can never be shell-injected.
pub async fn exec_in_pod(
    client: &Client,
    ns: &str,
    pod: &str,
    container: Option<&str>,
    command: &[&str],
    stdin_data: Option<&[u8]>,
) -> ApiResult<ExecOutput> {
    let pods: Api<Pod> = Api::namespaced(client.clone(), ns);
    let mut ap = AttachParams::default()
        .stdin(stdin_data.is_some())
        .stdout(true)
        .stderr(true);
    if let Some(c) = container {
        ap = ap.container(c.to_string());
    }

    let mut attached = pods.exec(pod, command.iter().copied(), &ap).await?;

    if let Some(data) = stdin_data {
        if let Some(mut stdin) = attached.stdin() {
            stdin
                .write_all(data)
                .await
                .map_err(|e| ApiError::Internal(anyhow::anyhow!("exec stdin: {e}")))?;
            let _ = stdin.flush().await;
            drop(stdin); // close stdin → EOF for the remote process
        }
    }

    let status_fut = attached.take_status();

    let mut stdout = Vec::new();
    if let Some(mut out) = attached.stdout() {
        out.read_to_end(&mut stdout)
            .await
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("exec stdout: {e}")))?;
    }
    let mut stderr_buf = Vec::new();
    if let Some(mut err) = attached.stderr() {
        let _ = err.read_to_end(&mut stderr_buf).await;
    }

    let success = match status_fut {
        Some(fut) => match fut.await {
            // The k8s `Status` object: status == "Success" on exit code 0.
            Some(s) => s.status.as_deref() == Some("Success"),
            None => true,
        },
        None => true,
    };

    Ok(ExecOutput {
        stdout,
        stderr: String::from_utf8_lossy(&stderr_buf).into_owned(),
        success,
    })
}
