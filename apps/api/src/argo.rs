//! Argo Workflows access for the builds view.
//!
//! The CI/CD pipeline is an Argo `WorkflowTemplate` named `cicd` in the CI/CD
//! namespace (see `eks/prod/cicd/argo/`). Each push (or a manual trigger) runs
//! one `Workflow` from that template. This module talks to those Workflow CRDs
//! through the existing in-cluster kube client — no Argo Server / token needed.
//!
//! Workflows are CRDs (`argoproj.io/v1alpha1`), so we use kube-rs `DynamicObject`
//! with a hand-built `ApiResource` rather than a typed k8s-openapi struct.

use kube::api::{Api, DynamicObject, ListParams, PostParams};
use kube::core::{ApiResource, GroupVersionKind};
use kube::Client;

use crate::dto::{BuildJob, BuildStatus};
use crate::error::{ApiError, ApiResult};

/// The WorkflowTemplate every build is submitted from.
const TEMPLATE: &str = "cicd";
/// SA the template runs under (must exist in the CI/CD namespace, RBAC granted).
const RUNNER_SA: &str = "cicd-runner";

/// Argo Workflow API handle scoped to the CI/CD namespace.
#[derive(Clone)]
pub struct Argo {
    api: Api<DynamicObject>,
    pods: Api<k8s_openapi::api::core::v1::Pod>,
}

fn workflow_api_resource() -> ApiResource {
    let gvk = GroupVersionKind::gvk("argoproj.io", "v1alpha1", "Workflow");
    ApiResource::from_gvk(&gvk)
}

impl Argo {
    pub fn new(kube: Client, namespace: impl Into<String>) -> Self {
        let namespace = namespace.into();
        let ar = workflow_api_resource();
        Self {
            api: Api::namespaced_with(kube.clone(), &namespace, &ar),
            pods: Api::namespaced(kube, &namespace),
        }
    }

    /// Submit a new `cicd` Workflow for `(repo, branch, sha)`. Returns the
    /// generated Workflow name (the build id used by the other endpoints).
    pub async fn submit(&self, repo: &str, branch: &str, sha: &str) -> ApiResult<String> {
        let payload = submit_payload(repo, branch, sha);
        let obj: DynamicObject = serde_json::from_value(payload)
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("build workflow payload: {e}")))?;
        let created = self
            .api
            .create(&PostParams::default(), &obj)
            .await
            .map_err(ApiError::from)?;
        Ok(created.metadata.name.unwrap_or_default())
    }

    /// List recent `cicd` Workflows, newest first, mapped to `BuildJob`.
    ///
    /// Argo does NOT stamp a workflow-template label on Workflows created via
    /// `workflowTemplateRef`, so we list all Workflows in the CI/CD namespace and
    /// keep those whose `spec.workflowTemplateRef.name` is our template.
    pub async fn list(&self, limit: usize) -> ApiResult<Vec<BuildJob>> {
        let list = match self.api.list(&ListParams::default()).await {
            Ok(l) => l,
            // Argo Workflows is an OPTIONAL integration. When its CRD/API group
            // isn't installed in the cluster, kube returns 404 ("page not
            // found") — treat that as "no builds / CI/CD not configured" and
            // return an empty history rather than surfacing a 404/502 error.
            Err(kube::Error::Api(ae)) if ae.code == 404 => return Ok(Vec::new()),
            Err(e) => return Err(ApiError::from(e)),
        };
        let mut out: Vec<BuildJob> = list
            .items
            .iter()
            .filter(|wf| is_cicd_workflow(wf))
            .map(workflow_to_dto)
            .collect();
        // Newest first by start time.
        out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        out.truncate(limit);
        Ok(out)
    }

    /// Fetch a single Workflow by name.
    pub async fn get(&self, name: &str) -> ApiResult<BuildJob> {
        let wf = self
            .api
            .get_opt(name)
            .await
            .map_err(ApiError::from)?
            .ok_or_else(|| ApiError::NotFound(format!("build {name}")))?;
        Ok(workflow_to_dto(&wf))
    }

    /// Concatenate logs from the Workflow's pods (newest build only). Works while
    /// the pods still exist (Argo TTL keeps them a while after completion).
    pub async fn logs(&self, name: &str) -> ApiResult<String> {
        // Argo labels every workflow pod with the workflow name.
        let lp = ListParams::default().labels(&format!("workflows.argoproj.io/workflow={name}"));
        let pods = self.pods.list(&lp).await.map_err(ApiError::from)?;
        if pods.items.is_empty() {
            return Err(ApiError::NotFound(format!(
                "no pods for build {name} (logs may have expired)"
            )));
        }
        let mut buf = String::new();
        for p in &pods.items {
            let pod_name = p.metadata.name.clone().unwrap_or_default();
            // The build/deploy step containers are named "main" by Argo.
            let lp = kube::api::LogParams {
                container: Some("main".to_string()),
                ..Default::default()
            };
            match self.pods.logs(&pod_name, &lp).await {
                Ok(text) => {
                    buf.push_str(&format!("===== {pod_name} =====\n"));
                    buf.push_str(&text);
                    buf.push('\n');
                }
                Err(e) => {
                    buf.push_str(&format!("===== {pod_name} (log unavailable: {e}) =====\n"));
                }
            }
        }
        Ok(buf)
    }
}

/// Build the JSON for a `cicd` Workflow submission. Pure — unit-tested.
pub fn submit_payload(repo: &str, branch: &str, sha: &str) -> serde_json::Value {
    serde_json::json!({
        "apiVersion": "argoproj.io/v1alpha1",
        "kind": "Workflow",
        "metadata": { "generateName": "cicd-manual-" },
        "spec": {
            "workflowTemplateRef": { "name": TEMPLATE },
            "serviceAccountName": RUNNER_SA,
            "arguments": {
                "parameters": [
                    { "name": "repo", "value": repo },
                    { "name": "branch", "value": branch },
                    { "name": "sha", "value": sha },
                ]
            }
        }
    })
}

/// True when a Workflow was created from our `cicd` WorkflowTemplate.
fn is_cicd_workflow(wf: &DynamicObject) -> bool {
    wf.data
        .get("spec")
        .and_then(|s| s.get("workflowTemplateRef"))
        .and_then(|r| r.get("name"))
        .and_then(|n| n.as_str())
        == Some(TEMPLATE)
}

/// Map a Workflow's `status.phase` to a `BuildStatus`.
fn phase_to_status(phase: Option<&str>) -> BuildStatus {
    match phase {
        Some("Pending") => BuildStatus::Queued,
        Some("Running") => BuildStatus::Running,
        Some("Succeeded") => BuildStatus::Success,
        Some("Failed") | Some("Error") => BuildStatus::Failure,
        _ => BuildStatus::Unknown,
    }
}

/// Convert a Workflow DynamicObject into the UI's `BuildJob` DTO.
fn workflow_to_dto(wf: &DynamicObject) -> BuildJob {
    let name = wf.metadata.name.clone().unwrap_or_default();
    let data = &wf.data;
    let params = data
        .get("spec")
        .and_then(|s| s.get("arguments"))
        .and_then(|a| a.get("parameters"));
    let param = |key: &str| -> Option<String> {
        params.and_then(|p| p.as_array()).and_then(|arr| {
            arr.iter()
                .find(|x| x.get("name").and_then(|n| n.as_str()) == Some(key))
                .and_then(|x| x.get("value").and_then(|v| v.as_str()))
                .map(|s| s.to_string())
        })
    };
    let status = data.get("status");
    let phase = status
        .and_then(|s| s.get("phase"))
        .and_then(|p| p.as_str());
    let parse_ts = |k: &str| -> Option<crate::dto::Timestamp> {
        status
            .and_then(|s| s.get(k))
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|t| t.with_timezone(&chrono::Utc))
    };
    let started_at = parse_ts("startedAt");
    let finished_at = parse_ts("finishedAt");
    let duration_ms = match (started_at, finished_at) {
        (Some(s), Some(f)) => Some((f - s).num_milliseconds()),
        _ => None,
    };

    BuildJob {
        // `job` carries the repo (owner/name); the workflow name is the build id.
        job: param("repo").unwrap_or_else(|| name.clone()),
        number: None,
        status: phase_to_status(phase),
        ref_: param("branch"),
        sha: param("sha"),
        triggered_by: "argo".to_string(),
        started_at,
        finished_at,
        duration_ms,
        // `url` carries the Argo workflow name = the id for /api/builds/:id.
        url: Some(name),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_cicd_submit_payload() {
        let body = submit_payload("mytech-technology/news-rss-deleter", "master", "abc123");
        assert_eq!(body["spec"]["workflowTemplateRef"]["name"], "cicd");
        assert_eq!(body["spec"]["serviceAccountName"], "cicd-runner");
        assert_eq!(body["kind"], "Workflow");
        let p = &body["spec"]["arguments"]["parameters"];
        let arr = p.as_array().unwrap();
        assert!(arr
            .iter()
            .any(|x| x["name"] == "repo" && x["value"] == "mytech-technology/news-rss-deleter"));
        assert!(arr.iter().any(|x| x["name"] == "branch" && x["value"] == "master"));
        assert!(arr.iter().any(|x| x["name"] == "sha" && x["value"] == "abc123"));
    }

    #[test]
    fn phase_mapping() {
        assert!(matches!(phase_to_status(Some("Succeeded")), BuildStatus::Success));
        assert!(matches!(phase_to_status(Some("Failed")), BuildStatus::Failure));
        assert!(matches!(phase_to_status(Some("Error")), BuildStatus::Failure));
        assert!(matches!(phase_to_status(Some("Running")), BuildStatus::Running));
        assert!(matches!(phase_to_status(None), BuildStatus::Unknown));
    }
}
