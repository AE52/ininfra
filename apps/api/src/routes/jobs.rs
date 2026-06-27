//! Jobs & CronJobs — the batch tier (`batch/v1`).
//!
//!   GET   /api/cronjobs?ns=                      list CronJobs (ns or all managed)
//!   GET   /api/jobs?ns=                          recent Jobs (ns or all managed)
//!   PATCH /api/cronjobs/:ns/:name/suspend        body SuspendRequest (audited)
//!   POST  /api/cronjobs/:ns/:name/trigger        create a Job from the template (audited)
//!
//! Suspend/resume and trigger-now are mutations and every change is audited.
//! Trigger-now mirrors `kubectl create job --from=cronjob/<name>`: it copies the
//! CronJob's `spec.jobTemplate` into a fresh Job (generateName `<cron>-manual-`)
//! carrying the `cronjob.kubernetes.io/instantiate: manual` annotation and an
//! ownerReference back to the CronJob.

use std::collections::BTreeMap;

use axum::{
    extract::{Path, Query, State},
    routing::{get, patch, post},
    Json, Router,
};
use k8s_openapi::api::batch::v1::{CronJob as K8sCronJob, Job as K8sJob, JobSpec};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::{ObjectMeta, OwnerReference};
use kube::api::{ListParams, Patch, PatchParams, PostParams};
use kube::Api;
use serde::Deserialize;

use crate::auth::Identity;
use crate::conv;
use crate::db::{insert_audit, NewAudit};
use crate::dto::{
    AuditAction, CronJobSummary, JobSummary, Page, PageQuery, SuspendRequest, TriggerJobAck,
};
use crate::error::{ApiError, ApiResult};
use crate::k8s::{managed_namespaces, require_namespace};
use crate::AppState;

/// Cap on the recent-Jobs list (newest-first). Jobs accumulate across namespaces
/// and most callers only care about the latest runs.
const JOBS_CAP: usize = 100;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/cronjobs", get(list_cronjobs))
        .route("/api/jobs", get(list_jobs))
        .route("/api/cronjobs/:ns/:name/suspend", patch(suspend_cronjob))
        .route("/api/cronjobs/:ns/:name/trigger", post(trigger_cronjob))
}

#[derive(Debug, Deserialize)]
struct NsQuery {
    ns: Option<String>,
}

/// Resolve the request's target namespace(s): the one supplied (allowlist-gated)
/// or every managed namespace when omitted.
fn target_namespaces(ns: &Option<String>) -> ApiResult<Vec<String>> {
    match ns {
        Some(ns) => {
            require_namespace(ns)?;
            Ok(vec![ns.clone()])
        }
        None => Ok(managed_namespaces()),
    }
}

/* ------------------------------ CronJobs --------------------------- */

fn cronjob_to_dto(c: &K8sCronJob, ns: &str) -> CronJobSummary {
    let spec = c.spec.as_ref();
    let status = c.status.as_ref();

    let schedule = spec.map(|s| s.schedule.clone()).unwrap_or_default();
    let suspended = spec.and_then(|s| s.suspend).unwrap_or(false);
    let active_count = status
        .and_then(|s| s.active.as_ref())
        .map(|a| a.len() as i32)
        .unwrap_or(0);

    // Primary container image of the embedded job template.
    let image = spec
        .and_then(|s| s.job_template.spec.as_ref())
        .and_then(|js| js.template.spec.as_ref())
        .and_then(|p| conv::primary_container(&p.containers))
        .and_then(|c| c.image.clone());

    CronJobSummary {
        namespace: ns.to_string(),
        name: c.metadata.name.clone().unwrap_or_default(),
        schedule,
        suspended,
        last_schedule_time: status.and_then(|s| s.last_schedule_time.as_ref().map(conv::time)),
        last_successful_time: status
            .and_then(|s| s.last_successful_time.as_ref().map(conv::time)),
        active_count,
        image,
    }
}

async fn list_cronjobs(
    State(st): State<AppState>,
    Query(q): Query<NsQuery>,
    Query(page): Query<PageQuery>,
) -> ApiResult<Json<Page<CronJobSummary>>> {
    let namespaces = target_namespaces(&q.ns)?;
    let mut out = Vec::new();
    for ns in namespaces {
        let api: Api<K8sCronJob> = Api::namespaced(st.kube.clone(), &ns);
        for c in api.list(&ListParams::default()).await?.items {
            out.push(cronjob_to_dto(&c, &ns));
        }
    }
    out.sort_by(|a, b| (&a.namespace, &a.name).cmp(&(&b.namespace, &b.name)));
    Ok(Json(Page::offset(out, page.cursor.as_deref(), page.limit)))
}

/* -------------------------------- Jobs ----------------------------- */

/// Roll a Job's conditions/counts up to a single status verb.
fn job_status(j: &K8sJob) -> &'static str {
    let status = match j.status.as_ref() {
        Some(s) => s,
        None => return "Unknown",
    };
    // Prefer the authoritative terminal conditions when present.
    if let Some(conds) = status.conditions.as_ref() {
        if conds
            .iter()
            .any(|c| c.type_ == "Failed" && c.status == "True")
        {
            return "Failed";
        }
        if conds
            .iter()
            .any(|c| c.type_ == "Complete" && c.status == "True")
        {
            return "Complete";
        }
    }
    if status.active.unwrap_or(0) > 0 {
        return "Running";
    }
    // No terminal condition and nothing active: completed-without-condition or
    // not yet started.
    if status.succeeded.unwrap_or(0) > 0 {
        return "Complete";
    }
    if status.failed.unwrap_or(0) > 0 {
        return "Failed";
    }
    "Unknown"
}

fn job_to_dto(j: &K8sJob, ns: &str) -> JobSummary {
    let spec = j.spec.as_ref();
    let status = j.status.as_ref();

    // Owning CronJob, when this Job was created by one.
    let owner = j.metadata.owner_references.as_ref().and_then(|ors| {
        ors.iter()
            .find(|o| o.kind == "CronJob")
            .map(|o| o.name.clone())
    });

    let start_time = status.and_then(|s| s.start_time.as_ref().map(conv::time));
    let completion_time = status.and_then(|s| s.completion_time.as_ref().map(conv::time));
    let duration_seconds = match (start_time, completion_time) {
        (Some(start), Some(end)) => Some((end - start).num_seconds()),
        _ => None,
    };

    JobSummary {
        namespace: ns.to_string(),
        name: j.metadata.name.clone().unwrap_or_default(),
        owner,
        completions: spec.and_then(|s| s.completions),
        succeeded: status.and_then(|s| s.succeeded).unwrap_or(0),
        failed: status.and_then(|s| s.failed).unwrap_or(0),
        active: status.and_then(|s| s.active).unwrap_or(0),
        start_time,
        completion_time,
        duration_seconds,
        status: job_status(j).to_string(),
    }
}

async fn list_jobs(
    State(st): State<AppState>,
    Query(q): Query<NsQuery>,
    Query(page): Query<PageQuery>,
) -> ApiResult<Json<Page<JobSummary>>> {
    let namespaces = target_namespaces(&q.ns)?;
    let mut out = Vec::new();
    for ns in namespaces {
        let api: Api<K8sJob> = Api::namespaced(st.kube.clone(), &ns);
        for j in api.list(&ListParams::default()).await?.items {
            out.push(job_to_dto(&j, &ns));
        }
    }
    // Newest-first by startTime (Jobs without a start time sort last), then cap.
    out.sort_by(|a, b| b.start_time.cmp(&a.start_time));
    out.truncate(JOBS_CAP);
    Ok(Json(Page::offset(out, page.cursor.as_deref(), page.limit)))
}

/* ------------------------------ Mutations -------------------------- */

async fn suspend_cronjob(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
    Json(body): Json<SuspendRequest>,
) -> ApiResult<Json<crate::dto::MutationAck>> {
    require_namespace(&ns)?;
    let api: Api<K8sCronJob> = Api::namespaced(st.kube.clone(), &ns);
    let current = api
        .get_opt(&name)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("cronjob {ns}/{name}")))?;
    let previous = current
        .spec
        .as_ref()
        .and_then(|s| s.suspend)
        .unwrap_or(false);

    // JSON merge-patch on spec.suspend.
    let patch = serde_json::json!({ "spec": { "suspend": body.suspend } });
    api.patch(&name, &PatchParams::default(), &Patch::Merge(&patch))
        .await?;

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::SuspendCronJob,
            target_ns: Some(&ns),
            target_kind: Some("CronJob"),
            target_name: Some(&name),
            detail: serde_json::json!({ "from": previous, "to": body.suspend }),
        },
    )
    .await?;

    Ok(Json(crate::dto::MutationAck::ok(Some(audit_id))))
}

async fn trigger_cronjob(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
) -> ApiResult<Json<TriggerJobAck>> {
    require_namespace(&ns)?;
    let cron_api: Api<K8sCronJob> = Api::namespaced(st.kube.clone(), &ns);
    let cron = cron_api
        .get_opt(&name)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("cronjob {ns}/{name}")))?;

    // Pull the embedded job template.
    let cron_spec = cron
        .spec
        .as_ref()
        .ok_or_else(|| ApiError::BadRequest(format!("cronjob {ns}/{name} has no spec")))?;
    let template = &cron_spec.job_template;
    let job_spec: JobSpec = template
        .spec
        .clone()
        .ok_or_else(|| ApiError::BadRequest(format!("cronjob {ns}/{name} has no jobTemplate.spec")))?;

    // `kubectl create job --from=cronjob/<name>` shape: generateName
    // `<cron>-manual-`, the manual-instantiate annotation, an ownerReference back
    // to the CronJob, and the template's own labels/annotations carried forward.
    let cron_uid = cron.metadata.uid.clone();
    let mut annotations: BTreeMap<String, String> = template
        .metadata
        .as_ref()
        .and_then(|m| m.annotations.clone())
        .unwrap_or_default();
    annotations.insert(
        "cronjob.kubernetes.io/instantiate".to_string(),
        "manual".to_string(),
    );
    let labels = template
        .metadata
        .as_ref()
        .and_then(|m| m.labels.clone());

    let owner_references = cron_uid.map(|uid| {
        vec![OwnerReference {
            api_version: "batch/v1".to_string(),
            kind: "CronJob".to_string(),
            name: name.clone(),
            uid,
            controller: Some(true),
            block_owner_deletion: Some(true),
        }]
    });

    let job = K8sJob {
        metadata: ObjectMeta {
            generate_name: Some(format!("{name}-manual-")),
            namespace: Some(ns.clone()),
            annotations: Some(annotations),
            labels,
            owner_references,
            ..Default::default()
        },
        spec: Some(job_spec),
        status: None,
    };

    let job_api: Api<K8sJob> = Api::namespaced(st.kube.clone(), &ns);
    let created = job_api.create(&PostParams::default(), &job).await?;
    let job_name = created.metadata.name.clone().unwrap_or_default();

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::TriggerJob,
            target_ns: Some(&ns),
            target_kind: Some("CronJob"),
            target_name: Some(&name),
            detail: serde_json::json!({ "jobName": job_name }),
        },
    )
    .await?;

    Ok(Json(TriggerJobAck {
        ok: true,
        job_name,
        audit_id: Some(audit_id),
    }))
}
