//! Mapping helpers from `k8s-openapi` objects to wire DTOs.
//!
//! Kept separate from the route modules so the (verbose) translation logic is
//! testable and shared between `services`, `deployments`, `pods`, and `nodes`.

use std::collections::BTreeMap;

use k8s_openapi::api::apps::v1::Deployment as K8sDeployment;
use k8s_openapi::api::core::v1::{
    Container, Node as K8sNode, Pod as K8sPod, ResourceRequirements as K8sResources,
};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::Time;

use crate::dto::{
    ContainerSpec, DeploymentCondition, HealthStatus, PodSummary, ResourceRequirements,
};

/// Convert a k8s `Time` into our `Timestamp`.
pub fn time(t: &Time) -> chrono::DateTime<chrono::Utc> {
    t.0
}

/// `creationTimestamp` or the unix epoch if (impossibly) absent.
pub fn created_at(meta_ts: Option<&Time>) -> chrono::DateTime<chrono::Utc> {
    meta_ts
        .map(|t| t.0)
        .unwrap_or_else(|| chrono::DateTime::<chrono::Utc>::from_timestamp(0, 0).unwrap())
}

/// Pull requests/limits out of a container's resource block.
pub fn resources(r: Option<&K8sResources>) -> ResourceRequirements {
    let get = |m: &Option<BTreeMap<String, k8s_openapi::apimachinery::pkg::api::resource::Quantity>>,
               key: &str|
     -> Option<String> {
        m.as_ref().and_then(|m| m.get(key)).map(|q| q.0.clone())
    };
    match r {
        None => ResourceRequirements {
            requests_cpu: None,
            requests_memory: None,
            limits_cpu: None,
            limits_memory: None,
        },
        Some(r) => ResourceRequirements {
            requests_cpu: get(&r.requests, "cpu"),
            requests_memory: get(&r.requests, "memory"),
            limits_cpu: get(&r.limits, "cpu"),
            limits_memory: get(&r.limits, "memory"),
        },
    }
}

/// The "primary" container is the first one in the spec; typical single-container
/// workloads, so this is the app container.
pub fn primary_container(containers: &[Container]) -> Option<&Container> {
    containers.first()
}

pub fn container_spec(c: &Container) -> ContainerSpec {
    ContainerSpec {
        name: c.name.clone(),
        image: c.image.clone().unwrap_or_default(),
        resources: resources(c.resources.as_ref()),
        ports: c
            .ports
            .as_ref()
            .map(|ps| ps.iter().map(|p| p.container_port).collect())
            .unwrap_or_default(),
    }
}

/// Roll a Deployment's status up to a single health verb.
pub fn deployment_health(d: &K8sDeployment) -> HealthStatus {
    let spec_replicas = d.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0);
    let status = match d.status.as_ref() {
        Some(s) => s,
        None => return HealthStatus::Unknown,
    };
    let ready = status.ready_replicas.unwrap_or(0);
    let updated = status.updated_replicas.unwrap_or(0);
    let available = status.available_replicas.unwrap_or(0);

    if spec_replicas == 0 {
        // Intentionally scaled to zero — neither healthy nor failing.
        return HealthStatus::Unknown;
    }
    // Degraded ONLY when there is zero serving capacity. A deployment with some
    // (but not all) replicas ready — during a rolling update, an HPA scale, or a
    // brief single-pod blip on a maxUnavailable=0 deployment — is still serving
    // and is Progressing, not Degraded. (Previously any "Available=False"
    // condition was mapped to Degraded; with maxUnavailable=0 that flips on a
    // single unavailable replica and produced false-positive incidents on healthy
    // multi-replica services.)
    if ready == 0 {
        return HealthStatus::Degraded;
    }
    if ready == spec_replicas && updated == spec_replicas && available == spec_replicas {
        HealthStatus::Healthy
    } else {
        HealthStatus::Progressing
    }
}

pub fn deployment_conditions(d: &K8sDeployment) -> Vec<DeploymentCondition> {
    d.status
        .as_ref()
        .and_then(|s| s.conditions.as_ref())
        .map(|cs| {
            cs.iter()
                .map(|c| DeploymentCondition {
                    type_: c.type_.clone(),
                    status: c.status.clone(),
                    reason: c.reason.clone(),
                    message: c.message.clone(),
                    last_transition_time: c.last_transition_time.as_ref().map(time),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// ConfigMap / Secret names referenced by a Deployment's pod template via
/// `envFrom` and `valueFrom` on every container.
pub fn env_refs(d: &K8sDeployment) -> (Vec<String>, Vec<String>) {
    let mut cms = Vec::new();
    let mut secrets = Vec::new();
    let containers = d
        .spec
        .as_ref()
        .and_then(|s| s.template.spec.as_ref())
        .map(|p| p.containers.as_slice())
        .unwrap_or(&[]);

    for c in containers {
        if let Some(env_from) = &c.env_from {
            for src in env_from {
                if let Some(cm) = &src.config_map_ref {
                    cms.push(cm.name.clone());
                }
                if let Some(s) = &src.secret_ref {
                    secrets.push(s.name.clone());
                }
            }
        }
        if let Some(env) = &c.env {
            for e in env {
                if let Some(vf) = &e.value_from {
                    if let Some(cm) = &vf.config_map_key_ref {
                        cms.push(cm.name.clone());
                    }
                    if let Some(s) = &vf.secret_key_ref {
                        secrets.push(s.name.clone());
                    }
                }
            }
        }
    }
    cms.sort();
    cms.dedup();
    secrets.sort();
    secrets.dedup();
    (cms, secrets)
}

/* ------------------------------ pods ------------------------------- */

pub fn pod_summary(p: &K8sPod) -> PodSummary {
    let meta = &p.metadata;
    let spec = p.spec.as_ref();
    let status = p.status.as_ref();

    let phase = status
        .and_then(|s| s.phase.clone())
        .unwrap_or_else(|| "Unknown".to_string());

    let container_statuses = status
        .and_then(|s| s.container_statuses.as_ref())
        .map(|v| v.as_slice())
        .unwrap_or(&[]);

    let total = spec.map(|s| s.containers.len()).unwrap_or(0);
    let ready_count = container_statuses.iter().filter(|cs| cs.ready).count();
    let restarts: i32 = container_statuses.iter().map(|cs| cs.restart_count).sum();
    let all_ready = total > 0 && ready_count == total;

    let owner_ref = meta.owner_references.as_ref().and_then(|ors| {
        ors.iter()
            .find(|o| o.controller.unwrap_or(false))
            .map(|o| format!("{}/{}", o.kind.to_lowercase(), o.name))
    });

    PodSummary {
        name: meta.name.clone().unwrap_or_default(),
        namespace: meta.namespace.clone().unwrap_or_default(),
        phase,
        ready: all_ready,
        container_ready: format!("{ready_count}/{total}"),
        restarts,
        node: spec.and_then(|s| s.node_name.clone()),
        pod_ip: status.and_then(|s| s.pod_ip.clone()),
        owner_ref,
        started_at: status.and_then(|s| s.start_time.as_ref().map(time)),
        containers: spec
            .map(|s| s.containers.iter().map(|c| c.name.clone()).collect())
            .unwrap_or_default(),
        // Usage fields are populated by the route handler after querying
        // metrics-server; conv::pod_summary() cannot do it (no async).
        usage_cpu: None,
        usage_memory: None,
    }
}

/* ------------------------------ nodes ------------------------------ */

/// Read a quantity string out of a node capacity/allocatable map.
pub fn node_qty(
    m: &Option<BTreeMap<String, k8s_openapi::apimachinery::pkg::api::resource::Quantity>>,
    key: &str,
) -> String {
    m.as_ref()
        .and_then(|m| m.get(key))
        .map(|q| q.0.clone())
        .unwrap_or_default()
}

/// True when the node is cordoned (`spec.unschedulable`). Defaults to false when
/// the field is absent.
pub fn node_unschedulable(n: &K8sNode) -> bool {
    n.spec
        .as_ref()
        .and_then(|s| s.unschedulable)
        .unwrap_or(false)
}

pub fn node_ready(n: &K8sNode) -> bool {
    n.status
        .as_ref()
        .and_then(|s| s.conditions.as_ref())
        .map(|cs| {
            cs.iter()
                .any(|c| c.type_ == "Ready" && c.status == "True")
        })
        .unwrap_or(false)
}

/// True when the node carries a taint with the given key (any value/effect).
pub fn node_has_taint(n: &K8sNode, key: &str) -> bool {
    n.spec
        .as_ref()
        .and_then(|s| s.taints.as_ref())
        .map(|ts| ts.iter().any(|t| t.key == key))
        .unwrap_or(false)
}

/// Heuristic: is this node a spot/preemptible instance?
///
/// Detects spot/preemptible capacity via the well-known, vendor-neutral
/// cloud-provider labels (EKS managed node groups, Karpenter) plus an optional
/// operator-configured label and/or taint (`SPOT_LABEL_KEY` /
/// `SPOT_LABEL_VALUE` / `SPOT_TAINT_KEY`, see `crate::config`). The configured
/// label/taint detection is off unless the corresponding key is set, so this
/// works on any cluster out of the box.
pub fn node_is_spot(n: &K8sNode) -> bool {
    let labels = n.metadata.labels.as_ref();
    let label_eq_ci = |key: &str, want: &str| -> bool {
        labels
            .and_then(|l| l.get(key))
            .map(|v| v.eq_ignore_ascii_case(want))
            .unwrap_or(false)
    };
    if label_eq_ci("eks.amazonaws.com/capacityType", "SPOT")
        || label_eq_ci("karpenter.sh/capacity-type", "spot")
    {
        return true;
    }

    let cfg = crate::config::get();

    // Optional operator-configured spot label: match by key, and by value too
    // when a value is configured (otherwise any value counts as spot).
    if !cfg.spot_label_key.is_empty() {
        if let Some(v) = labels.and_then(|l| l.get(cfg.spot_label_key.as_str())) {
            if cfg.spot_label_value.is_empty() || v.eq_ignore_ascii_case(&cfg.spot_label_value) {
                return true;
            }
        }
    }

    // Optional operator-configured spot taint (any value/effect).
    if !cfg.spot_taint_key.is_empty() && node_has_taint(n, &cfg.spot_taint_key) {
        return true;
    }

    false
}

/// Classify the node's provisioning capacity type: "spot" | "on-demand" | "unknown".
pub fn node_capacity_type(n: &K8sNode) -> &'static str {
    if node_is_spot(n) {
        return "spot";
    }
    let labels = n.metadata.labels.as_ref();
    let label_eq_ci = |key: &str, want: &str| -> bool {
        labels
            .and_then(|l| l.get(key))
            .map(|v| v.eq_ignore_ascii_case(want))
            .unwrap_or(false)
    };
    let has_label = |key: &str| -> bool { labels.map(|l| l.contains_key(key)).unwrap_or(false) };

    let cfg = crate::config::get();
    // If the operator configured a spot label, a node carrying that label but
    // whose value did not qualify as spot (checked above in `node_is_spot`) is
    // explicitly on-demand.
    let configured_on_demand = !cfg.spot_label_key.is_empty()
        && has_label(cfg.spot_label_key.as_str());

    let explicit_on_demand = label_eq_ci("eks.amazonaws.com/capacityType", "ON_DEMAND")
        || label_eq_ci("karpenter.sh/capacity-type", "on-demand")
        || configured_on_demand;

    if explicit_on_demand
        || has_label("node.kubernetes.io/instance-type")
        || has_label("beta.kubernetes.io/instance-type")
    {
        "on-demand"
    } else {
        "unknown"
    }
}
