//! Read-only raw manifest viewer.
//!
//!   GET /api/manifest/:kind/:ns/:name
//!
//! Fetches the live object from the cluster, strips noise that `kubectl get -o
//! yaml` users learn to ignore (`metadata.managedFields` and the kubectl
//! last-applied-configuration annotation), and returns it as a YAML string.
//!
//! Strictly read-only and `require_namespace`-gated, so it is governed by the
//! same managed-namespace allowlist as every other read endpoint. Supported
//! kinds: deployment, statefulset, pod, service, configmap.

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use k8s_openapi::api::apps::v1::{Deployment as K8sDeployment, StatefulSet as K8sSts};
use k8s_openapi::api::core::v1::{ConfigMap as K8sConfigMap, Pod as K8sPod, Service as K8sService};
use kube::Api;
use serde::Serialize;
use serde_json::Value;

use crate::dto::ManifestResponse;
use crate::error::{ApiError, ApiResult};
use crate::k8s::require_namespace;
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/manifest/:kind/:ns/:name", get(get_manifest))
}

/// Fetch one typed object `T` and serialize it to a `serde_json::Value`.
///
/// `T` is any k8s resource type (all implement `Serialize` + `kube::Resource`),
/// so we share a single fetch/serialize path across every supported kind.
async fn fetch_value<T>(kube: &kube::Client, ns: &str, name: &str, what: &str) -> ApiResult<Value>
where
    T: kube::Resource<Scope = kube::core::NamespaceResourceScope>
        + Clone
        + std::fmt::Debug
        + Serialize
        + serde::de::DeserializeOwned,
    <T as kube::Resource>::DynamicType: Default,
{
    let api: Api<T> = Api::namespaced(kube.clone(), ns);
    let obj = api
        .get_opt(name)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("{what} {ns}/{name}")))?;
    serde_json::to_value(&obj)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("serialize {what}: {e}")))
}

/// Drop the noisy server-managed fields so the manifest reads like a clean
/// `kubectl get -o yaml`: `metadata.managedFields` and the kubectl
/// last-applied-configuration annotation. `status` is intentionally kept — it
/// is useful when inspecting a live object.
fn sanitize(value: &mut Value) {
    let Some(meta) = value.get_mut("metadata").and_then(Value::as_object_mut) else {
        return;
    };
    meta.remove("managedFields");
    if let Some(ann) = meta.get_mut("annotations").and_then(Value::as_object_mut) {
        ann.remove("kubectl.kubernetes.io/last-applied-configuration");
        // If that was the only annotation, drop the now-empty map for tidiness.
        if ann.is_empty() {
            meta.remove("annotations");
        }
    }
}

async fn get_manifest(
    State(st): State<AppState>,
    Path((kind, ns, name)): Path<(String, String, String)>,
) -> ApiResult<Json<ManifestResponse>> {
    require_namespace(&ns)?;

    let mut value = match kind.to_ascii_lowercase().as_str() {
        "deployment" => fetch_value::<K8sDeployment>(&st.kube, &ns, &name, "deployment").await?,
        "statefulset" => fetch_value::<K8sSts>(&st.kube, &ns, &name, "statefulset").await?,
        "pod" => fetch_value::<K8sPod>(&st.kube, &ns, &name, "pod").await?,
        "service" => fetch_value::<K8sService>(&st.kube, &ns, &name, "service").await?,
        "configmap" => fetch_value::<K8sConfigMap>(&st.kube, &ns, &name, "configmap").await?,
        other => {
            return Err(ApiError::BadRequest(format!(
                "unsupported kind {other:?} (expected one of: deployment, statefulset, pod, service, configmap)"
            )))
        }
    };

    sanitize(&mut value);

    let yaml = serde_yaml::to_string(&value)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("render yaml: {e}")))?;

    Ok(Json(ManifestResponse {
        yaml,
        kind: kind.to_ascii_lowercase(),
        name,
        namespace: ns,
    }))
}
