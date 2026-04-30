use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tauri::{Emitter, Window};
use tokio::sync::Mutex;

// ─────────────────────────────────────────────
// AGENT EVENTS  (sent to frontend via Tauri)
// ─────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentEvent {
    #[serde(rename = "type")]
    pub event_type: String, // thought | action | observation | approval_required | final_answer | error | done
    pub content:    Option<String>,
    pub tool:       Option<String>,
    pub args:       Option<Value>,
    pub action_id:  Option<String>,
    pub error:      Option<bool>,
}

// ─────────────────────────────────────────────
// APPROVAL GATE
// ─────────────────────────────────────────────

/// Shared map of pending approvals: action_id → channel
pub type ApprovalMap = Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>>;

pub fn new_approval_map() -> ApprovalMap {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Register a pending approval and wait for the user to resolve it.
pub async fn wait_for_approval(map: &ApprovalMap, action_id: &str) -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel();
    {
        let mut guard = map.lock().await;
        guard.insert(action_id.to_string(), tx);
    }
    rx.await.unwrap_or(false)
}

/// Called from the Tauri command `agent_approve` to resolve a pending gate.
pub async fn resolve_approval(map: &ApprovalMap, action_id: &str, approved: bool) {
    let mut guard = map.lock().await;
    if let Some(tx) = guard.remove(action_id) {
        let _ = tx.send(approved);
    }
}

// ─────────────────────────────────────────────
// TOOLS
// ─────────────────────────────────────────────

/// Tools that need explicit user approval before running
const APPROVAL_REQUIRED: &[&str] = &["write_file", "create_file", "run_command"];

/// Tool descriptions injected into the system prompt
pub const TOOL_DESCRIPTIONS: &str = r#"
You have access to the following tools. Call them using this exact JSON format on its own line:
{"tool": "<tool_name>", "args": {<args>}}

Available tools:
- read_file:      {"tool": "read_file",      "args": {"path": "<relative-path>"}}
- write_file:     {"tool": "write_file",     "args": {"path": "<relative-path>", "content": "<file content>"}}
- create_file:    {"tool": "create_file",    "args": {"path": "<relative-path>", "content": "<file content>"}}
- list_directory: {"tool": "list_directory", "args": {"path": "<relative-path>"}}
- run_command:    {"tool": "run_command",    "args": {"command": "<shell command>", "cwd": "<relative-path>"}}
- search_codebase:{"tool": "search_codebase","args": {"query": "<search query>"}}

RULES:
- Think step by step before each action. Start your thought with "Thought:"
- When you have enough info to answer, write "Final Answer:" followed by your response.
- write_file, create_file, and run_command require user approval — they will be paused until approved.
- Only use absolute tool JSON, no markdown fences around it.
"#;

/// Execute a non-async tool and return its output string
pub fn execute_tool_sync(tool: &str, args: &Value, workspace: &str) -> Result<String, String> {
    match tool {
        "read_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let full  = PathBuf::from(workspace).join(path);
            std::fs::read_to_string(&full)
                .map(|c| c.chars().take(4000).collect())
                .map_err(|e| e.to_string())
        }
        "write_file" | "create_file" => {
            let path    = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let full    = PathBuf::from(workspace).join(path);
            if let Some(p) = full.parent() { let _ = std::fs::create_dir_all(p); }
            std::fs::write(&full, content)
                .map(|_| format!("Wrote {} bytes to {}", content.len(), path))
                .map_err(|e| e.to_string())
        }
        "list_directory" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
            let full  = PathBuf::from(workspace).join(path);
            std::fs::read_dir(&full)
                .map_err(|e| e.to_string())
                .map(|entries| {
                    entries.flatten()
                        .map(|e| {
                            let n = e.file_name().to_string_lossy().to_string();
                            let d = e.path().is_dir();
                            format!("{}{}", n, if d { "/" } else { "" })
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                })
        }
        "run_command" => {
            let cmd = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let cwd = args.get("cwd").and_then(|v| v.as_str()).unwrap_or(workspace);
            let output = if cfg!(target_os = "windows") {
                Command::new("powershell").args(["-c", cmd]).current_dir(cwd).output()
            } else {
                Command::new("sh").args(["-c", cmd]).current_dir(cwd).output()
            };
            match output {
                Ok(out) => {
                    let mut res = String::from_utf8_lossy(&out.stdout).to_string();
                    let err = String::from_utf8_lossy(&out.stderr).to_string();
                    if !err.is_empty() { res.push_str("\n[stderr]\n"); res.push_str(&err); }
                    Ok(res.chars().take(4000).collect())
                }
                Err(e) => Err(e.to_string()),
            }
        }
        // search_codebase is handled in the agent loop directly (needs async VectorStore)
        _ => Err(format!("Unknown tool: {}", tool)),
    }
}

// ─────────────────────────────────────────────
// TOKEN-AWARE PROMPT BUILDER
// ─────────────────────────────────────────────

/// Very fast approximate token count (1 token ≈ 4 chars)
fn approx_tokens(s: &str) -> usize { s.len() / 4 }

/// Build the messages array for the ReAct loop.
/// Truncates history from the front to stay within `token_budget`.
pub fn build_agent_messages(
    task: &str,
    scratchpad: &[(String, String)],   // (role, content) history
    rag_context: &[(crate::rag::Chunk, f32)],
    token_budget: usize,
) -> Vec<Value> {
    // System prompt
    let mut system = format!(
        "You are Local Cortex, an expert AI coding agent running fully offline.\n\
         Your job is to complete the user's task step by step.\n\
         {}\n",
        TOOL_DESCRIPTIONS
    );

    // Inject RAG context if available
    if !rag_context.is_empty() {
        system.push_str("\n## Relevant codebase context:\n");
        for (chunk, score) in rag_context.iter().take(5) {
            system.push_str(&format!(
                "\n### {} (lines {}-{}, relevance {:.2})\n```\n{}\n```\n",
                chunk.file_path, chunk.start_line, chunk.end_line,
                score, chunk.content.chars().take(800).collect::<String>()
            ));
        }
    }

    let mut messages: Vec<Value> = vec![json!({"role": "system", "content": system})];
    messages.push(json!({"role": "user", "content": format!("Task: {}", task)}));

    // Fill from the back (most recent first), stopping at budget
    let mut budget_left = token_budget.saturating_sub(approx_tokens(&messages[0]["content"].as_str().unwrap_or("")));
    let mut history_msgs: Vec<Value> = Vec::new();

    for (role, content) in scratchpad.iter().rev() {
        let tok = approx_tokens(content);
        if tok > budget_left { break; }
        budget_left -= tok;
        history_msgs.push(json!({"role": role, "content": content}));
    }

    history_msgs.reverse();
    // Insert history after system + first user message
    messages.splice(2..2, history_msgs);

    messages
}

// ─────────────────────────────────────────────
// REACT AGENT LOOP
// ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    message: Option<OllamaMessage>,
    #[allow(dead_code)]
    done: bool,
}
#[derive(Debug, Deserialize)]
struct OllamaMessage {
    content: String,
}

/// Parse `{"tool": "...", "args": {...}}` from a line of text
fn parse_tool_call(text: &str) -> Option<(String, Value)> {
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('{') && trimmed.contains("\"tool\"") {
            if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                let tool = v.get("tool")?.as_str()?.to_string();
                let args = v.get("args").cloned().unwrap_or_else(|| json!({}));
                return Some((tool, args));
            }
        }
    }
    None
}

pub async fn run_agent(
    window:       Window,
    task_id:      String,
    task:         String,
    workspace:    String,
    model:        String,
    store:        Arc<crate::rag::VectorStore>,
    approvals:    ApprovalMap,
) {
    let client = reqwest::Client::new();
    let event  = format!("agent-event-{}", task_id);

    let emit = |ev: AgentEvent| { let _ = window.emit(&event, ev); };

    let mut scratchpad: Vec<(String, String)> = Vec::new();
    let max_iterations = 20;

    for _iteration in 0..max_iterations {
        // ── RAG retrieval ─────────────────────────────────────────────────
        let rag_results = store.search(&task, 6, None, &[]).await.unwrap_or_default();

        // ── Build messages ─────────────────────────────────────────────────
        let messages = build_agent_messages(&task, &scratchpad, &rag_results, 6000);

        // ── Call Ollama (non-streaming for cleaner parsing) ────────────────
        let req_body = json!({
            "model": model,
            "messages": messages,
            "stream": false,
        });

        let response = match client
            .post("http://127.0.0.1:11434/api/chat")
            .json(&req_body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                emit(AgentEvent {
                    event_type: "error".into(),
                    content: Some(format!("Ollama error: {}", e)),
                    tool: None, args: None, action_id: None, error: Some(true),
                });
                break;
            }
        };

        let ollama_resp: OllamaResponse = match response.json().await {
            Ok(r) => r,
            Err(e) => {
                emit(AgentEvent {
                    event_type: "error".into(),
                    content: Some(format!("Parse error: {}", e)),
                    tool: None, args: None, action_id: None, error: Some(true),
                });
                break;
            }
        };

        let assistant_text = ollama_resp.message.map(|m| m.content).unwrap_or_default();
        scratchpad.push(("assistant".into(), assistant_text.clone()));

        // ── Check for Final Answer ─────────────────────────────────────────
        if let Some(pos) = assistant_text.to_lowercase().find("final answer:") {
            let answer = assistant_text[pos + "final answer:".len()..].trim().to_string();
            emit(AgentEvent {
                event_type: "final_answer".into(),
                content: Some(answer),
                tool: None, args: None, action_id: None, error: None,
            });
            emit(AgentEvent {
                event_type: "done".into(),
                content: None, tool: None, args: None, action_id: None, error: None,
            });
            return;
        }

        // ── Emit Thought (lines before tool call) ──────────────────────────
        let thought_lines: Vec<&str> = assistant_text.lines()
            .filter(|l| {
                let t = l.trim();
                !t.starts_with('{') && !t.is_empty()
            })
            .collect();
        if !thought_lines.is_empty() {
            emit(AgentEvent {
                event_type: "thought".into(),
                content: Some(thought_lines.join("\n")),
                tool: None, args: None, action_id: None, error: None,
            });
        }

        // ── Parse tool call ────────────────────────────────────────────────
        let Some((tool, args)) = parse_tool_call(&assistant_text) else {
            // No tool call and no final answer — nudge the model
            scratchpad.push((
                "user".into(),
                "Continue. Either call a tool or write 'Final Answer:' when done.".into(),
            ));
            continue;
        };

        // ── Emit action ────────────────────────────────────────────────────
        let action_id = uuid::Uuid::new_v4().to_string();
        emit(AgentEvent {
            event_type: "action".into(),
            content: None,
            tool: Some(tool.clone()),
            args: Some(args.clone()),
            action_id: Some(action_id.clone()),
            error: None,
        });

        // ── Approval gate ──────────────────────────────────────────────────
        let needs_approval = APPROVAL_REQUIRED.contains(&tool.as_str());
        if needs_approval {
            emit(AgentEvent {
                event_type: "approval_required".into(),
                content: None,
                tool: Some(tool.clone()),
                args: Some(args.clone()),
                action_id: Some(action_id.clone()),
                error: None,
            });

            let approved = wait_for_approval(&approvals, &action_id).await;
            emit(AgentEvent {
                event_type: "approval_result".into(),
                content: Some(if approved { "approved" } else { "rejected" }.into()),
                tool: Some(tool.clone()),
                args: None,
                action_id: Some(action_id.clone()),
                error: None,
            });

            if !approved {
                scratchpad.push((
                    "user".into(),
                    format!("Tool '{}' was rejected by the user. Try a different approach.", tool),
                ));
                continue;
            }
        }

        // ── Execute tool ───────────────────────────────────────────────────
        let observation = if tool == "search_codebase" {
            // Async vector search
            let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
            match store.search(query, 5, None, &[]).await {
                Ok(results) => {
                    if results.is_empty() {
                        "No relevant code found in the index.".to_string()
                    } else {
                        results.iter().map(|(chunk, score)| {
                            format!(
                                "### {} (lines {}-{}, score: {:.2})\n{}",
                                chunk.file_path, chunk.start_line, chunk.end_line,
                                score, chunk.content.chars().take(600).collect::<String>()
                            )
                        }).collect::<Vec<_>>().join("\n\n")
                    }
                }
                Err(e) => format!("Search error: {}", e),
            }
        } else {
            match execute_tool_sync(&tool, &args, &workspace) {
                Ok(out) => out,
                Err(e) => {
                    emit(AgentEvent {
                        event_type: "observation".into(),
                        content: Some(format!("Error: {}", e)),
                        tool: Some(tool.clone()),
                        args: None,
                        action_id: Some(action_id.clone()),
                        error: Some(true),
                    });
                    scratchpad.push(("user".into(), format!("Error from {}: {}", tool, e)));
                    continue;
                }
            }
        };

        emit(AgentEvent {
            event_type: "observation".into(),
            content: Some(observation.clone()),
            tool: Some(tool.clone()),
            args: None,
            action_id: Some(action_id.clone()),
            error: Some(false),
        });

        scratchpad.push((
            "user".into(),
            format!("Observation from {}:\n{}", tool, observation),
        ));
    }

    // Hit max iterations
    emit(AgentEvent {
        event_type: "error".into(),
        content: Some(format!("Agent reached max iterations ({}) without finishing.", max_iterations)),
        tool: None, args: None, action_id: None, error: Some(true),
    });
    emit(AgentEvent {
        event_type: "done".into(),
        content: None, tool: None, args: None, action_id: None, error: None,
    });
}
