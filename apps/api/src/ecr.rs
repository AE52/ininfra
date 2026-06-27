//! ECR access — image inventory, delete, and digest→commit resolution.
//!
//! Enabled only when AWS creds are present in the environment (typically mounted
//! from a Kubernetes secret whose name is configurable by the operator). When
//! absent, [`init`] returns `None` and the deploy routes degrade gracefully
//! (commit/image features marked unavailable).

use aws_sdk_ecr::primitives::DateTime as AwsDateTime;
use aws_sdk_ecr::types::ImageIdentifier;
use aws_sdk_ecr::Client;

use crate::error::{ApiError, ApiResult};

#[derive(Clone)]
pub struct Ecr {
    client: Client,
}

/// One ECR image manifest and its tags.
pub struct ImageInfo {
    pub digest: String,
    pub tags: Vec<String>,
    pub pushed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub size_bytes: Option<i64>,
}

/// Build an ECR client from ambient AWS creds, or `None` when unconfigured.
pub async fn init() -> Option<Ecr> {
    if std::env::var("AWS_ACCESS_KEY_ID").is_err() {
        tracing::warn!("AWS_ACCESS_KEY_ID not set; ECR features disabled");
        return None;
    }
    let region = std::env::var("AWS_REGION")
        .or_else(|_| std::env::var("AWS_DEFAULT_REGION"))
        .unwrap_or_else(|_| "us-east-1".to_string());
    let conf = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(aws_config::Region::new(region))
        .load()
        .await;
    tracing::info!("ECR client initialized");
    Some(Ecr {
        client: Client::new(&conf),
    })
}

fn to_chrono(dt: Option<&AwsDateTime>) -> Option<chrono::DateTime<chrono::Utc>> {
    dt.and_then(|d| chrono::DateTime::from_timestamp(d.secs(), d.subsec_nanos()))
}

fn ecr_err<E: std::fmt::Display>(e: E) -> ApiError {
    ApiError::Upstream(format!("ecr: {e}"))
}

impl Ecr {
    /// All images in a repository (server-side paginated, collected).
    pub async fn list(&self, repo: &str) -> ApiResult<Vec<ImageInfo>> {
        let mut out = Vec::new();
        let mut pages = self
            .client
            .describe_images()
            .repository_name(repo)
            .into_paginator()
            .send();
        while let Some(page) = pages.next().await {
            let page = page.map_err(ecr_err)?;
            for d in page.image_details() {
                if let Some(digest) = d.image_digest() {
                    out.push(ImageInfo {
                        digest: digest.to_string(),
                        tags: d.image_tags().to_vec(),
                        pushed_at: to_chrono(d.image_pushed_at()),
                        size_bytes: d.image_size_in_bytes(),
                    });
                }
            }
        }
        Ok(out)
    }

    /// Resolve a single digest to its tags. `None` when the image is absent.
    pub async fn get(&self, repo: &str, digest: &str) -> ApiResult<Option<ImageInfo>> {
        let resp = self
            .client
            .describe_images()
            .repository_name(repo)
            .image_ids(ImageIdentifier::builder().image_digest(digest).build())
            .send()
            .await;
        match resp {
            Ok(o) => Ok(o.image_details().first().and_then(|d| {
                d.image_digest().map(|dg| ImageInfo {
                    digest: dg.to_string(),
                    tags: d.image_tags().to_vec(),
                    pushed_at: to_chrono(d.image_pushed_at()),
                    size_bytes: d.image_size_in_bytes(),
                })
            })),
            // ImageNotFound / RepositoryNotFound → treat as "no info".
            Err(_) => Ok(None),
        }
    }

    /// Delete an image by digest.
    pub async fn delete(&self, repo: &str, digest: &str) -> ApiResult<()> {
        let out = self
            .client
            .batch_delete_image()
            .repository_name(repo)
            .image_ids(ImageIdentifier::builder().image_digest(digest).build())
            .send()
            .await
            .map_err(ecr_err)?;
        if let Some(f) = out.failures().first() {
            return Err(ApiError::Upstream(format!(
                "ecr delete failed: {:?} {}",
                f.failure_code(),
                f.failure_reason().unwrap_or_default()
            )));
        }
        Ok(())
    }
}

/// Parse a git short SHA out of image tags (e.g. "fixed-eddf9a5" → "eddf9a5").
/// Picks the trailing hex segment after the last '-' on the first matching tag.
pub fn commit_from_tags(tags: &[String]) -> Option<String> {
    for t in tags {
        let seg = t.rsplit('-').next().unwrap_or(t);
        if (7..=40).contains(&seg.len()) && seg.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(seg.to_string());
        }
    }
    None
}
