use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tauri::{Emitter, Window};
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub content: Option<String>,
    pub tool: Option<String>,
    pub args: Option<Value>,
    pub action_id: Option<String>,
    pub error: Option<bool>,
}

pub type ApprovalMap = Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>>;
pub type CancellationMap = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

pub fn new_approval_map() -> ApprovalMap {
    Arc::new(Mutex::new(HashMap::new()))
}

pub fn new_cancellation_map() -> CancellationMap {
    Arc::new(Mutex::new(HashMap::new()))
}

pub async fn wait_for_approval(map: &ApprovalMap, action_id: &str) -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel();
    {
        let mut guard = map.lock().await;
        guard.insert(action_id.to_string(), tx);
    }
    rx.await.unwrap_or(false)
}

pub async fn resolve_approval(map: &ApprovalMap, action_id: &str, approved: bool) {
    let mut guard = map.lock().await;
    if let Some(tx) = guard.remove(action_id) {
        let _ = tx.send(approved);
    }
}

pub async fn register_cancellation(map: &CancellationMap, task_id: &str) -> Arc<AtomicBool> {
    let token = Arc::new(AtomicBool::new(false));
    let mut guard = map.lock().await;
    guard.insert(task_id.to_string(), token.clone());
    token
}

pub async fn cancel_task(map: &CancellationMap, task_id: &str) -> bool {
    let guard = map.lock().await;
    if let Some(token) = guard.get(task_id) {
        token.store(true, Ordering::Relaxed);
        true
    } else {
        false
    }
}

pub async fn unregister_cancellation(map: &CancellationMap, task_id: &str) {
    let mut guard = map.lock().await;
    guard.remove(task_id);
}

const APPROVAL_REQUIRED: &[&str] = &["delete_file", "run_command"];

pub const TOOL_DESCRIPTIONS: &str = r#"
You are an autonomous coding agent embedded inside a Rust-based code editor.
You do NOT behave like a chat assistant. You behave like a software engineer that directly works in the user's workspace.

Your goal is to COMPLETE tasks by planning, editing files, running commands, observing errors, fixing them, and repeating until success.

Always start each task with a plan. Then execute step by step. Do not stop at generating code. Code belongs in files via tools.

Visible status/final response format:
{
  "plan": ["step1", "step2"],
  "actions": [
    {"tool": "FILE_SYSTEM | TERMINAL | PROJECT_INSPECTION", "command": "...", "path": "...", "content": "..."}
  ],
  "reasoning": "short explanation",
  "next_step": "what you will do after this"
}

To actually execute work, call ONE executable tool per assistant turn using JSON on its own line. The runtime accepts both schemas below.

Native tool schema:
{"tool": "<tool_name>", "args": {<args>}}

Available tools:
- read_file:      {"tool": "read_file",      "args": {"path": "<relative-path>"}}
- write_file:     {"tool": "write_file",     "args": {"path": "<relative-path>", "content": "<file content>"}}
- update_file:    alias of write_file
- create_file:    {"tool": "create_file",    "args": {"path": "<relative-path>", "content": "<file content>"}}
- delete_file:    {"tool": "delete_file",    "args": {"path": "<relative-path>"}}
- list_directory: {"tool": "list_directory", "args": {"path": "<relative-path>"}}
- list_files:     alias of list_directory with {"path": "."}
- run_command:    {"tool": "run_command",    "args": {"command": "<shell command>", "cwd": "<relative-path>"}}
- search_codebase:{"tool": "search_codebase","args": {"query": "<search query>"}}
- search_files:   alias of search_codebase

User-facing action schema is also accepted:
{"plan":["..."],"actions":[{"tool":"FILE_SYSTEM","command":"create_file","path":"src/App.tsx","content":"..."}],"reasoning":"...","next_step":"..."}
{"plan":["..."],"actions":[{"tool":"TERMINAL","command":"npm run build"}],"reasoning":"...","next_step":"..."}
{"plan":["..."],"actions":[{"tool":"PROJECT_INSPECTION","command":"search_files","query":"TODO"}],"reasoning":"...","next_step":"..."}

RULES:
- Always begin with a concrete plan.
- Then call tools. Do not merely describe edits.
- Never use TERMINAL for file operations. Do not run shell commands named create_file, write_file, read_file, update_file, list_files, or search_files.
- To create a folder, create a file inside that folder, for example create_file with path "jeet/index.html". Parent folders are created automatically.
- For HTML/CSS/JS tasks, write complete formatted files directly. Do not create an empty file first.
- Do not run a browser/open command just to verify a static HTML file. Read the file back or run a relevant build/test command.
- If asked to create "a folder named X and an HTML page", use exactly one create_file/write_file action at "X/index.html" with the complete HTML.
- A plan-only JSON object is not progress. Every assistant turn before final completion should include exactly one executable action unless blocked.
- After each observation, decide whether to fix, retry, or continue.
- If a command fails, inspect stdout/stderr, fix the cause, and retry.
- If the project exists, modify it intelligently. If it is empty, initialize a minimal working setup.
- Prefer minimal working setups: Vite for React, cargo new for Rust.
- File creation and updates are allowed without approval. delete_file and run_command require approval and pause until approved.
- Stay inside the provided workspace. Never use absolute paths and never try to escape with `..`.
- Use relative paths only.
- Only return "Final Answer:" after you have verified the task or reached a real blocker.
- The final answer after "Final Answer:" must be valid structured JSON with plan, actions, reasoning, and next_step.
- Only use tool JSON on its own line, with no markdown fences.
"#;

fn normalize_workspace_root(workspace: &str) -> Result<PathBuf, String> {
    let workspace_path = PathBuf::from(workspace);
    let absolute = if workspace_path.is_absolute() {
        workspace_path
    } else {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(workspace_path)
    };

    std::fs::canonicalize(&absolute)
        .map_err(|e| format!("Workspace is invalid or inaccessible: {}", e))
}

fn resolve_workspace_path(workspace_root: &Path, candidate: &str) -> Result<PathBuf, String> {
    let path = Path::new(candidate);
    if path.is_absolute() {
        return Err("Absolute paths are not allowed in agent tools".to_string());
    }

    let mut resolved = workspace_root.to_path_buf();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => resolved.push(part),
            Component::ParentDir => {
                if resolved == workspace_root {
                    return Err("Path escapes the workspace".to_string());
                }
                resolved.pop();
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Only workspace-relative paths are allowed".to_string());
            }
        }
    }

    Ok(resolved)
}

pub fn execute_tool_sync(tool: &str, args: &Value, workspace: &str) -> Result<String, String> {
    let workspace_root = normalize_workspace_root(workspace)?;

    match tool {
        "read_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let full = resolve_workspace_path(&workspace_root, path)?;
            std::fs::read_to_string(&full)
                .map(|c| c.chars().take(4000).collect())
                .map_err(|e| e.to_string())
        }
        "write_file" | "create_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let full = resolve_workspace_path(&workspace_root, path)?;
            if let Some(parent) = full.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&full, content)
                .map(|_| format!("Wrote {} bytes to {}", content.len(), path))
                .map_err(|e| e.to_string())
        }
        "delete_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let full = resolve_workspace_path(&workspace_root, path)?;
            if full.is_dir() {
                return Err("delete_file only deletes files, not directories".to_string());
            }
            std::fs::remove_file(&full)
                .map(|_| format!("Deleted {}", path))
                .map_err(|e| e.to_string())
        }
        "list_directory" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
            let full = resolve_workspace_path(&workspace_root, path)?;
            std::fs::read_dir(&full)
                .map_err(|e| e.to_string())
                .map(|entries| {
                    entries
                        .flatten()
                        .map(|entry| {
                            let name = entry.file_name().to_string_lossy().to_string();
                            let is_dir = entry.path().is_dir();
                            format!("{}{}", name, if is_dir { "/" } else { "" })
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                })
        }
        "run_command" => {
            let command = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let lower_command = command.to_lowercase();
            let forbidden_tool_words = [
                "create_file",
                "write_file",
                "update_file",
                "read_file",
                "delete_file",
                "list_files",
                "search_files",
            ];
            if forbidden_tool_words.iter().any(|word| lower_command.contains(word)) {
                return Err(
                    "Do not use terminal for agent file/project tools. Call the matching JSON tool directly instead."
                        .to_string(),
                );
            }
            let cwd = args.get("cwd").and_then(|v| v.as_str()).unwrap_or(".");
            let full_cwd = resolve_workspace_path(&workspace_root, cwd)?;
            let output = if cfg!(target_os = "windows") {
                Command::new("powershell")
                    .args(["-c", command])
                    .current_dir(&full_cwd)
                    .output()
            } else {
                Command::new("sh")
                    .args(["-c", command])
                    .current_dir(&full_cwd)
                    .output()
            };

            match output {
                Ok(out) => {
                    let mut res = String::from_utf8_lossy(&out.stdout).to_string();
                    let err = String::from_utf8_lossy(&out.stderr).to_string();
                    if !err.is_empty() {
                        res.push_str("\n[stderr]\n");
                        res.push_str(&err);
                    }
                    Ok(res.chars().take(4000).collect())
                }
                Err(e) => Err(e.to_string()),
            }
        }
        _ => Err(format!("Unknown tool: {}", tool)),
    }
}

fn approx_tokens(s: &str) -> usize {
    s.len() / 4
}

pub fn build_agent_messages(
    task: &str,
    scratchpad: &[(String, String)],
    rag_context: &[(crate::rag::Chunk, f32)],
    token_budget: usize,
) -> Vec<Value> {
    let mut system = format!(
        "You are Local Cortex, an expert AI coding agent running fully offline.\n\
         Your job is to complete the user's task step by step.\n\
         {}\n",
        TOOL_DESCRIPTIONS
    );

    if !rag_context.is_empty() {
        system.push_str("\n## Relevant codebase context:\n");
        for (chunk, score) in rag_context.iter().take(5) {
            system.push_str(&format!(
                "\n### {} (lines {}-{}, relevance {:.2})\n```\n{}\n```\n",
                chunk.file_path,
                chunk.start_line,
                chunk.end_line,
                score,
                chunk.content.chars().take(800).collect::<String>()
            ));
        }
    }

    let mut messages: Vec<Value> = vec![json!({ "role": "system", "content": system })];
    messages.push(json!({ "role": "user", "content": format!("Task: {}", task) }));

    let mut budget_left = token_budget
        .saturating_sub(approx_tokens(messages[0]["content"].as_str().unwrap_or("")));
    let mut history_msgs: Vec<Value> = Vec::new();

    for (role, content) in scratchpad.iter().rev() {
        let tok = approx_tokens(content);
        if tok > budget_left {
            break;
        }
        budget_left -= tok;
        history_msgs.push(json!({ "role": role, "content": content }));
    }

    history_msgs.reverse();
    messages.splice(2..2, history_msgs);
    messages
}

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

fn value_to_args(value: &Value) -> Value {
    if let Some(args) = value.get("args") {
        return args.clone();
    }

    let mut map = serde_json::Map::new();
    for key in ["path", "content", "command", "cwd", "query"] {
        if let Some(field) = value.get(key) {
            map.insert(key.to_string(), field.clone());
        }
    }
    Value::Object(map)
}

fn normalize_tool_name(tool: &str, args: &mut Value) -> Option<String> {
    let lower = tool.to_lowercase();
    match lower.as_str() {
        "read_file" => Some("read_file".into()),
        "write_file" | "update_file" => Some("write_file".into()),
        "create_file" => Some("create_file".into()),
        "delete_file" => Some("delete_file".into()),
        "list_directory" | "list_files" => {
            if args.get("path").is_none() {
                if let Some(obj) = args.as_object_mut() {
                    obj.insert("path".into(), Value::String(".".into()));
                }
            }
            Some("list_directory".into())
        }
        "run_command" => {
            if args.get("cwd").is_none() {
                if let Some(obj) = args.as_object_mut() {
                    obj.insert("cwd".into(), Value::String(".".into()));
                }
            }
            Some("run_command".into())
        }
        "search_codebase" | "search_files" => Some("search_codebase".into()),
        _ => None,
    }
}

fn normalize_action_schema(action: &Value) -> Option<(String, Value)> {
    let tool = action.get("tool")?.as_str()?.to_uppercase();
    let command = action.get("command").and_then(|v| v.as_str()).unwrap_or("");
    let mut args = value_to_args(action);

    match tool.as_str() {
        "FILE_SYSTEM" => {
            let normalized = normalize_tool_name(command, &mut args)?;
            Some((normalized, args))
        }
        "TERMINAL" => {
            let shell_command = if command == "run_command" {
                action.get("command_text").and_then(|v| v.as_str()).unwrap_or("")
            } else {
                command
            };
            let mut map = serde_json::Map::new();
            map.insert("command".into(), Value::String(shell_command.to_string()));
            map.insert(
                "cwd".into(),
                action
                    .get("cwd")
                    .cloned()
                    .unwrap_or_else(|| Value::String(".".into())),
            );
            Some(("run_command".into(), Value::Object(map)))
        }
        "PROJECT_INSPECTION" => {
            let normalized = match command {
                "list_files" | "list_directory" => "list_directory",
                "search_files" | "search_codebase" => "search_codebase",
                _ => return None,
            };
            if normalized == "list_directory" && args.get("path").is_none() {
                if let Some(obj) = args.as_object_mut() {
                    obj.insert("path".into(), Value::String(".".into()));
                }
            }
            Some((normalized.into(), args))
        }
        _ => None,
    }
}

fn normalize_tool_call(value: &Value) -> Option<(String, Value)> {
    if let Some(actions) = value.get("actions").and_then(|v| v.as_array()) {
        for action in actions {
            if let Some(call) = normalize_action_schema(action) {
                return Some(call);
            }
        }
    }

    let tool = value.get("tool")?.as_str()?;
    if matches!(tool.to_uppercase().as_str(), "FILE_SYSTEM" | "TERMINAL" | "PROJECT_INSPECTION") {
        return normalize_action_schema(value);
    }

    let mut args = value_to_args(value);
    let normalized = normalize_tool_name(tool, &mut args)?;
    Some((normalized, args))
}

fn parse_tool_call(text: &str) -> Option<(String, Value)> {
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('{') && (trimmed.contains("\"tool\"") || trimmed.contains("\"actions\"")) {
            if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                if let Some(call) = normalize_tool_call(&v) {
                    return Some(call);
                }
            }
        }
    }
    None
}

async fn finish_agent(
    emit: &impl Fn(AgentEvent),
    cancellations: &CancellationMap,
    task_id: &str,
    final_event: Option<AgentEvent>,
) {
    if let Some(event) = final_event {
        emit(event);
    }
    emit(AgentEvent {
        event_type: "done".into(),
        content: None,
        tool: None,
        args: None,
        action_id: None,
        error: None,
    });
    unregister_cancellation(cancellations, task_id).await;
}

pub async fn run_agent(
    window: Window,
    task_id: String,
    task: String,
    workspace: String,
    model: String,
    context_messages: Vec<crate::ChatMessage>,
    store: Arc<crate::rag::VectorStore>,
    approvals: ApprovalMap,
    cancel_token: Arc<AtomicBool>,
    cancellations: CancellationMap,
) {
    let client = reqwest::Client::new();
    let event_name = format!("agent-event-{}", task_id);
    let emit = |ev: AgentEvent| {
        let _ = window.emit(&event_name, ev);
    };

    let workspace_root = match normalize_workspace_root(&workspace) {
        Ok(root) => root,
        Err(err) => {
            finish_agent(
                &emit,
                &cancellations,
                &task_id,
                Some(AgentEvent {
                    event_type: "error".into(),
                    content: Some(err),
                    tool: None,
                    args: None,
                    action_id: None,
                    error: Some(true),
                }),
            )
            .await;
            return;
        }
    };

    let mut scratchpad: Vec<(String, String)> = context_messages
        .into_iter()
        .filter_map(|msg| {
            let role = match msg.role.as_str() {
                "assistant" | "ai" => "assistant",
                "user" => "user",
                _ => return None,
            };
            Some((role.to_string(), msg.content))
        })
        .collect();
    let max_iterations = 20;

    for _iteration in 0..max_iterations {
        if cancel_token.load(Ordering::Relaxed) {
            finish_agent(
                &emit,
                &cancellations,
                &task_id,
                Some(AgentEvent {
                    event_type: "error".into(),
                    content: Some("Agent run cancelled.".into()),
                    tool: None,
                    args: None,
                    action_id: None,
                    error: Some(true),
                }),
            )
            .await;
            return;
        }

        let rag_results = store
            .search_in_directory(&task, 6, &workspace_root)
            .await
            .unwrap_or_default();

        let messages = build_agent_messages(&task, &scratchpad, &rag_results, 6000);
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
                finish_agent(
                    &emit,
                    &cancellations,
                    &task_id,
                    Some(AgentEvent {
                        event_type: "error".into(),
                        content: Some(format!("Ollama error: {}", e)),
                        tool: None,
                        args: None,
                        action_id: None,
                        error: Some(true),
                    }),
                )
                .await;
                return;
            }
        };

        let ollama_resp: OllamaResponse = match response.json().await {
            Ok(r) => r,
            Err(e) => {
                finish_agent(
                    &emit,
                    &cancellations,
                    &task_id,
                    Some(AgentEvent {
                        event_type: "error".into(),
                        content: Some(format!("Parse error: {}", e)),
                        tool: None,
                        args: None,
                        action_id: None,
                        error: Some(true),
                    }),
                )
                .await;
                return;
            }
        };

        let assistant_text = ollama_resp.message.map(|m| m.content).unwrap_or_default();
        scratchpad.push(("assistant".into(), assistant_text.clone()));

        if let Some(pos) = assistant_text.to_lowercase().find("final answer:") {
            let answer = assistant_text[pos + "final answer:".len()..]
                .trim()
                .to_string();
            finish_agent(
                &emit,
                &cancellations,
                &task_id,
                Some(AgentEvent {
                    event_type: "final_answer".into(),
                    content: Some(answer),
                    tool: None,
                    args: None,
                    action_id: None,
                    error: None,
                }),
            )
            .await;
            return;
        }

        let thought_lines: Vec<&str> = assistant_text
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                !trimmed.starts_with('{') && !trimmed.is_empty()
            })
            .collect();
        if !thought_lines.is_empty() {
            emit(AgentEvent {
                event_type: "thought".into(),
                content: Some(thought_lines.join("\n")),
                tool: None,
                args: None,
                action_id: None,
                error: None,
            });
        }

        let Some((tool, args)) = parse_tool_call(&assistant_text) else {
            scratchpad.push((
                "user".into(),
                "Continue. Either call a tool or write 'Final Answer:' when done.".into(),
            ));
            continue;
        };

        let action_id = uuid::Uuid::new_v4().to_string();
        emit(AgentEvent {
            event_type: "action".into(),
            content: None,
            tool: Some(tool.clone()),
            args: Some(args.clone()),
            action_id: Some(action_id.clone()),
            error: None,
        });

        if APPROVAL_REQUIRED.contains(&tool.as_str()) {
            emit(AgentEvent {
                event_type: "approval_required".into(),
                content: None,
                tool: Some(tool.clone()),
                args: Some(args.clone()),
                action_id: Some(action_id.clone()),
                error: None,
            });

            let approved = wait_for_approval(&approvals, &action_id).await;
            if cancel_token.load(Ordering::Relaxed) {
                finish_agent(
                    &emit,
                    &cancellations,
                    &task_id,
                    Some(AgentEvent {
                        event_type: "error".into(),
                        content: Some("Agent run cancelled.".into()),
                        tool: None,
                        args: None,
                        action_id: None,
                        error: Some(true),
                    }),
                )
                .await;
                return;
            }

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

        let observation = if tool == "search_codebase" {
            let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
            match store.search_in_directory(query, 5, &workspace_root).await {
                Ok(results) => {
                    if results.is_empty() {
                        "No relevant code found in the current workspace index.".to_string()
                    } else {
                        results
                            .iter()
                            .map(|(chunk, score)| {
                                format!(
                                    "### {} (lines {}-{}, score: {:.2})\n{}",
                                    chunk.file_path,
                                    chunk.start_line,
                                    chunk.end_line,
                                    score,
                                    chunk.content.chars().take(600).collect::<String>()
                                )
                            })
                            .collect::<Vec<_>>()
                            .join("\n\n")
                    }
                }
                Err(e) => format!("Search error: {}", e),
            }
        } else {
            match execute_tool_sync(&tool, &args, &workspace) {
                Ok(out) => out,
                Err(e) => {
                    let error_message = format!("Error: {}", e);
                    emit(AgentEvent {
                        event_type: "observation".into(),
                        content: Some(error_message.clone()),
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

        scratchpad.push(("user".into(), format!("Observation from {}:\n{}", tool, observation)));
    }

    finish_agent(
        &emit,
        &cancellations,
        &task_id,
        Some(AgentEvent {
            event_type: "error".into(),
            content: Some(format!(
                "Agent reached max iterations ({}) without finishing.",
                max_iterations
            )),
            tool: None,
            args: None,
            action_id: None,
            error: Some(true),
        }),
    )
    .await;
}
