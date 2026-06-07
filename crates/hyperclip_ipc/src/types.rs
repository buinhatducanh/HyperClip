// crates/hyperclip_ipc/src/types.rs
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// All IPC commands. We use a single catch-all variant with arbitrary params
/// instead of an explicit enum, because the command set is large (80+ channels)
/// and grows often. This avoids touching the type system every time a new
/// IPC channel is added — only `commands.rs` needs an entry in the dispatch
/// table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcRequest {
    pub id: u64,
    #[serde(rename = "cmd")]
    pub command: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcResponse {
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ok: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "method")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl IpcResponse {
    pub fn ok(id: Value, result: Value) -> Self {
        Self { id, ok: Some(true), result: Some(result), error: None, method: None, params: None }
    }
    pub fn err(id: Value, error: String) -> Self {
        Self { id, ok: Some(false), result: None, error: Some(error), method: None, params: None }
    }
    pub fn event(method: &str, params: Value) -> Self {
        Self {
            id: Value::Null,
            ok: None,
            result: None,
            error: None,
            method: Some(method.to_string()),
            params: Some(params),
        }
    }
}

// Re-export BackendCommand for backwards compat
pub type BackendCommand = IpcRequest;
