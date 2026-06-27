//! Workload configuration drift: live spec vs last-applied.
//!
//!   GET /api/drift/:kind/:ns/:name   (kind ∈ deployment | statefulset)
//!
//! A read-only, `require_namespace`-gated answer to "has this workload's LIVE
//! spec drifted from what was declaratively applied?". It compares the live
//! object against the manifest captured in its
//! `kubectl.kubernetes.io/last-applied-configuration` annotation — the snapshot
//! `kubectl apply` records of the last config the operator declared.
//!
//! The diff is intentionally focused on the fields operators actually care about
//! drifting (and that other actors — HPAs, mutating webhooks, manual `kubectl
//! edit`/`scale`, controllers — routinely change out from under `apply`):
//!
//!   * `spec.replicas`
//!   * per-container image (`spec.template.spec.containers[<name>].image`)
//!   * per-container cpu/memory requests + limits
//!     (`...resources.requests.cpu|memory`, `...resources.limits.cpu|memory`)
//!
//! When the annotation is absent (the workload was never `kubectl apply`-ed —
//! e.g. created by a controller or `kubectl create`), there is no declared
//! baseline to compare against, so we report `hasBaseline: false` with an empty
//! diff rather than inventing one.
//!
//! Strictly read-only: governed by the `drift.read` permission and the same
//! managed-namespace allowlist as every other read endpoint.

use std::collections::BTreeSet;

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use k8s_openapi::api::apps::v1::{Deployment as K8sDeployment, StatefulSet as K8sSts};
use kube::Api;
use serde::Serialize;
use serde_json::Value;

use crate::dto::{DriftField, DriftResponse};
use crate::error::{ApiError, ApiResult};
use crate::k8s::require_namespace;
use crate::AppState;

/// The annotation `kubectl apply` writes to record the last declared config.
const LAST_APPLIED: &str = "kubectl.kubernetes.io/last-applied-configuration";

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/drift/:kind/:ns/:name", get(drift))
}

/// Fetch one typed object `T` and serialize it to a `serde_json::Value`, so a
/// single fetch/serialize path covers every supported kind (mirrors
/// `manifest.rs::fetch_value`).
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

/// Stringify a JSON scalar for stable comparison, or `None` when the value is
/// absent / JSON null. Numbers, strings and bools all become their canonical
/// string form (e.g. `3` → "3", `"500m"` → "500m") so a live int and an applied
/// string compare equal when they mean the same thing.
fn scalar_str(v: Option<&Value>) -> Option<String> {
    match v {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        Some(Value::Bool(b)) => Some(b.to_string()),
        // Objects/arrays aren't expected for the scalar fields we diff; render
        // them compactly rather than dropping the signal.
        Some(other) => Some(other.to_string()),
    }
}

/// Resolve a dotted path of object keys against a JSON value, e.g.
/// `["spec", "replicas"]`. Returns `None` if any segment is missing.
fn dig<'a>(root: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut cur = root;
    for seg in path {
        cur = cur.get(*seg)?;
    }
    Some(cur)
}

/// The list of containers under `spec.template.spec.containers`, as a slice.
fn containers(root: &Value) -> &[Value] {
    dig(root, &["spec", "template", "spec", "containers"])
        .and_then(Value::as_array)
        .map(|v| v.as_slice())
        .unwrap_or(&[])
}

/// Find a container by name within a `containers` array.
fn find_container<'a>(list: &'a [Value], name: &str) -> Option<&'a Value> {
    list.iter()
        .find(|c| c.get("name").and_then(Value::as_str) == Some(name))
}

/// Read a container's `resources.<group>.<res>` scalar (e.g. requests.cpu),
/// where `group ∈ {requests, limits}` and `res ∈ {cpu, memory}`.
fn container_resource(container: Option<&Value>, group: &str, res: &str) -> Option<String> {
    let c = container?;
    scalar_str(dig(c, &["resources", group, res]))
}

/// Push a `DriftField` comparing `live` vs `applied` at `path`.
fn push_field(out: &mut Vec<DriftField>, path: String, live: Option<String>, applied: Option<String>) {
    let drifted = live != applied;
    out.push(DriftField {
        path,
        live,
        applied,
        drifted,
    });
}

/// Compute the focused field-level diff between the live object and its declared
/// (last-applied) baseline. Both are raw JSON values shaped like a workload
/// manifest. Returns one `DriftField` per compared item.
fn diff(live: &Value, applied: &Value) -> Vec<DriftField> {
    let mut fields: Vec<DriftField> = Vec::new();

    // spec.replicas
    push_field(
        &mut fields,
        "spec.replicas".to_string(),
        scalar_str(dig(live, &["spec", "replicas"])),
        scalar_str(dig(applied, &["spec", "replicas"])),
    );

    // Per-container fields. Iterate the union of container names across both
    // sides so a container added/removed relative to the baseline still shows
    // up (its image/resources read as null on the missing side → drifted).
    let live_containers = containers(live);
    let applied_containers = containers(applied);

    let mut names: BTreeSet<String> = BTreeSet::new();
    for c in live_containers.iter().chain(applied_containers.iter()) {
        if let Some(n) = c.get("name").and_then(Value::as_str) {
            names.insert(n.to_string());
        }
    }

    for name in &names {
        let live_c = find_container(live_containers, name);
        let applied_c = find_container(applied_containers, name);

        // image
        push_field(
            &mut fields,
            format!("spec.template.spec.containers[{name}].image"),
            scalar_str(live_c.and_then(|c| c.get("image"))),
            scalar_str(applied_c.and_then(|c| c.get("image"))),
        );

        // resources requests/limits × cpu/memory
        for (group, res) in [
            ("requests", "cpu"),
            ("requests", "memory"),
            ("limits", "cpu"),
            ("limits", "memory"),
        ] {
            push_field(
                &mut fields,
                format!("spec.template.spec.containers[{name}].resources.{group}.{res}"),
                container_resource(live_c, group, res),
                container_resource(applied_c, group, res),
            );
        }
    }

    fields
}

async fn drift(
    State(st): State<AppState>,
    Path((kind, ns, name)): Path<(String, String, String)>,
) -> ApiResult<Json<DriftResponse>> {
    require_namespace(&ns)?;
    let kind = kind.to_ascii_lowercase();

    // Fetch the live object as a Value (single path across both kinds).
    let live = match kind.as_str() {
        "deployment" => fetch_value::<K8sDeployment>(&st.kube, &ns, &name, "deployment").await?,
        "statefulset" => fetch_value::<K8sSts>(&st.kube, &ns, &name, "statefulset").await?,
        other => {
            return Err(ApiError::BadRequest(format!(
                "unsupported kind {other:?} (expected one of: deployment, statefulset)"
            )))
        }
    };

    // Read the last-applied annotation. Missing OR unparseable → no declared
    // baseline: report cleanly rather than erroring.
    let applied: Option<Value> = dig(&live, &["metadata", "annotations", LAST_APPLIED])
        .and_then(Value::as_str)
        .and_then(|s| serde_json::from_str::<Value>(s).ok());

    let Some(applied) = applied else {
        return Ok(Json(DriftResponse {
            kind,
            namespace: ns,
            name,
            has_baseline: false,
            has_drift: false,
            fields: Vec::new(),
        }));
    };

    let fields = diff(&live, &applied);
    let has_drift = fields.iter().any(|f| f.drifted);

    Ok(Json(DriftResponse {
        kind,
        namespace: ns,
        name,
        has_baseline: true,
        has_drift,
        fields,
    }))
}
