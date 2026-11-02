//! atlas-pay-host: the real pay.sh MCP `curl` tool, with Atlas Rail as its spending authority.
//!
//! pay (PR #514) has no CLI flag for the hook: a host builds an `AuthorityBinding`. This is that
//! host, kept small. It binds one trusted caller id, posts each `SpendRequest` to Atlas Rail, and maps
//! the verdict fail-closed like PR #525's `RemoteHttpAuthority`, plus `reject_before_execution`,
//! which #525 predates. Payments use pay's own wallet code on Devnet.
//!
//!   atlas-pay-host payer --accounts <accounts.yml>
//!       prints the Devnet payer address (created once, kept in that pay accounts file)
//!   atlas-pay-host run --accounts <accounts.yml> --authority <url> --caller <id> --rpc <url> [--timeout-ms 5000] [--token <t>]
//!       reads a JSON array of curl calls on stdin, runs them on one MCP connection, prints one JSON line each.
//!       Calls with the same "group" number start together. "wait_ms" holds a call before it starts.

use pay_core::accounts::{AccountsStore, FileAccountsStore, load_or_create_ephemeral_for_network};
use pay_mcp::{
    ApprovalPolicy, CallScope, PayContext, PayMcp,
    authority::{AuthorityBinding, AuthorityDecision, AuthorityUnavailable, SpendRequest, SpendingAuthority},
};
use rmcp::{
    ServiceExt,
    model::CallToolRequestParams,
    service::{Peer, RequestContext, RoleServer},
};
use serde_json::{Value, json};
use std::{future::Future, path::PathBuf, pin::Pin, sync::Arc, time::Duration};
use tokio::io::AsyncReadExt;

const MAX_VERDICT_BYTES: usize = 64 * 1024;

struct AtlasAuthority {
    endpoint: String,
    token: Option<String>,
    client: reqwest::Client,
}

impl AtlasAuthority {
    /// Anything that is not an unambiguous, available verdict fails closed.
    fn map_verdict(verdict: &Value) -> Result<AuthorityDecision, AuthorityUnavailable> {
        match verdict.get("unavailable") {
            None | Some(Value::Bool(false)) => {}
            _ => return Err(AuthorityUnavailable),
        }
        match verdict.get("decision").and_then(Value::as_str) {
            Some("allow") => Ok(AuthorityDecision::Allow),
            Some("deny") => Ok(AuthorityDecision::Deny),
            // Atlas Rail reserves nothing while the owner decides, so a retry is safe.
            Some("reject_before_execution") => Ok(AuthorityDecision::RejectBeforeExecution),
            _ => Err(AuthorityUnavailable),
        }
    }
}

impl SpendingAuthority for AtlasAuthority {
    fn authorize(&self, request: SpendRequest) -> Pin<Box<dyn Future<Output = Result<AuthorityDecision, AuthorityUnavailable>> + Send + '_>> {
        Box::pin(async move {
            let body = serde_json::to_vec(&request).map_err(|_| AuthorityUnavailable)?;
            let mut builder = self.client.post(&self.endpoint).header("content-type", "application/json").header("accept", "application/json").body(body);
            if let Some(token) = &self.token {
                builder = builder.bearer_auth(token);
            }
            let mut response = builder.send().await.map_err(|_| AuthorityUnavailable)?;
            if !response.status().is_success() {
                return Err(AuthorityUnavailable);
            }
            let mut buf = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| AuthorityUnavailable)? {
                if buf.len() + chunk.len() > MAX_VERDICT_BYTES {
                    return Err(AuthorityUnavailable);
                }
                buf.extend_from_slice(&chunk);
            }
            let verdict: Value = serde_json::from_slice(&buf).map_err(|_| AuthorityUnavailable)?;
            Self::map_verdict(&verdict)
        })
    }
}

/// The agent has no wallet prompt: the spending authority is the only gate this host adds.
struct NoPrompt;
impl ApprovalPolicy for NoPrompt {
    fn gate(&self, _: Option<&Peer<RoleServer>>) -> pay_core::signer::AuthOverride {
        None
    }
}

struct Host {
    accounts: Arc<FileAccountsStore>,
    authority: Arc<AtlasAuthority>,
    caller_id: String,
    rpc: String,
    timeout: Duration,
}

impl PayContext for Host {
    fn scope(&self, _: &RequestContext<RoleServer>) -> Result<CallScope, rmcp::ErrorData> {
        Ok(CallScope {
            accounts: self.accounts.clone(),
            network_override: Some("devnet".into()),
            account_override: None,
            rpc_url_override: Some(self.rpc.clone()),
            approval: Arc::new(NoPrompt),
            payment_permissions: None,
            body_files: false,
            outbound_policy: pay_core::client::fetch::OutboundPolicy::Unrestricted,
        })
    }
    fn spending_authority(&self, _: &RequestContext<RoleServer>) -> Result<Option<AuthorityBinding>, rmcp::ErrorData> {
        Ok(Some(AuthorityBinding::new(self.caller_id.clone(), self.authority.clone()).with_timeout(self.timeout)))
    }
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let accounts_path = PathBuf::from(flag(&args, "--accounts").expect("--accounts <accounts.yml> is required"));
    let accounts = Arc::new(FileAccountsStore::at(accounts_path));
    let payer = load_or_create_ephemeral_for_network("devnet", accounts.as_ref() as &dyn AccountsStore).expect("devnet payer");
    match args.get(1).map(String::as_str) {
        Some("payer") => {
            println!("{}", json!({ "payer": payer.account.pubkey }));
        }
        Some("run") => {
            let host = Arc::new(Host {
                accounts,
                authority: Arc::new(AtlasAuthority {
                    endpoint: flag(&args, "--authority").expect("--authority <url> is required"),
                    token: flag(&args, "--token"),
                    client: reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().expect("http client"),
                }),
                caller_id: flag(&args, "--caller").expect("--caller <id> is required"),
                rpc: flag(&args, "--rpc").unwrap_or_else(|| "https://api.devnet.solana.com".into()),
                timeout: Duration::from_millis(flag(&args, "--timeout-ms").map(|v| v.parse().expect("--timeout-ms")).unwrap_or(5000)),
            });
            let mut input = String::new();
            tokio::io::stdin().read_to_string(&mut input).await.expect("stdin");
            let calls: Vec<Value> = serde_json::from_str(&input).expect("stdin must be a JSON array of calls");

            // One MCP connection for the whole run, so pay's operation guard behaves as it would for one agent.
            let (a, b) = tokio::io::duplex(1 << 20);
            let (server, client) = tokio::join!(PayMcp::with_context(host).serve(a), ().serve(b));
            let server = server.expect("mcp server");
            let client = Arc::new(client.expect("mcp client"));

            let mut index = 0;
            while index < calls.len() {
                let group = calls[index].get("group").cloned();
                let mut batch = vec![calls[index].clone()];
                index += 1;
                while group.is_some() && index < calls.len() && calls[index].get("group") == group.as_ref() {
                    batch.push(calls[index].clone());
                    index += 1;
                }
                let tasks = batch.into_iter().map(|call| {
                    let client = client.clone();
                    tokio::spawn(async move {
                        let mut arguments = serde_json::Map::new();
                        for key in ["url", "method", "operation_id", "body", "headers"] {
                            if let Some(value) = call.get(key) {
                                arguments.insert(key.into(), value.clone());
                            }
                        }
                        // Lets a demo hold this call on the same connection, for example until the owner taps approve.
                        if let Some(wait) = call.get("wait_ms").and_then(Value::as_u64) {
                            tokio::time::sleep(Duration::from_millis(wait)).await;
                        }
                        let started = std::time::Instant::now();
                        let result = client.call_tool(CallToolRequestParams::new("curl").with_arguments(arguments)).await;
                        let ms = started.elapsed().as_millis();
                        match result {
                            Ok(result) => json!({ "label": call.get("label"), "operation_id": call.get("operation_id"), "is_error": result.is_error, "ms": ms, "result": result }),
                            Err(error) => json!({ "label": call.get("label"), "operation_id": call.get("operation_id"), "is_error": true, "ms": ms, "error": error.to_string() }),
                        }
                    })
                });
                for task in tasks.collect::<Vec<_>>() {
                    println!("{}", task.await.expect("call task"));
                }
            }
            let _ = server.cancel().await;
        }
        _ => {
            eprintln!("usage: atlas-pay-host payer|run --accounts <accounts.yml> [...]");
            std::process::exit(2);
        }
    }
}
