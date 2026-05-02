mod rag;
mod agent;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, Window, State};
use futures_util::StreamExt;
use std::path::PathBuf;
use std::sync::Arc;

// ─────────────────────────────────────────────
// GLOBAL APP STATE
// ─────────────────────────────────────────────

pub struct AppState {
    pub store:     Arc<rag::VectorStore>,
    pub approvals: agent::ApprovalMap,
    pub cancellations: agent::CancellationMap,
    // index progress (progress, total)
    pub index_progress: tokio::sync::Mutex<(usize, usize, String)>,
}

// ─────────────────────────────────────────────
// CHAT / AI TYPES
// ─────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OllamaOptions {
    pub num_ctx: u32,
    pub temperature: f32,
    pub top_p: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OllamaRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    options: OllamaOptions,
    #[serde(skip_serializing_if = "Option::is_none")]
    keep_alive: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct OllamaResponseChunk {
    message: Option<ChatMessage>,
    done: bool,
}

// ─────────────────────────────────────────────
// MODEL DISCOVERY TYPES
// ─────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiscoveredModel {
    pub id: String,
    pub name: String,
    pub category: String,
    pub model_type: String,
    pub size: Option<String>,
    pub source: String,
}

#[derive(Debug, Deserialize)]
struct OllamaTag {
    name: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaTag>,
}

// ─────────────────────────────────────────────
// FILE SYSTEM TYPES
// ─────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
    pub extension: Option<String>,
}

// ─────────────────────────────────────────────
// HELPER: FORMAT BYTES
// ─────────────────────────────────────────────

fn format_size(bytes: u64) -> String {
    let gb = bytes as f64 / 1_073_741_824.0;
    let mb = bytes as f64 / 1_048_576.0;
    if gb >= 1.0 {
        format!("{:.1} GB", gb)
    } else {
        format!("{:.0} MB", mb)
    }
}

// ─────────────────────────────────────────────
// HELPER: DETECT MODEL TYPE FROM NAME
// ─────────────────────────────────────────────

fn detect_model_type(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("embed") {
        "Embedding".to_string()
    } else if lower.contains("vision") || lower.contains("clip") || lower.contains("vit") || lower.contains("vgg") {
        "Vision".to_string()
    } else if lower.contains("sentiment") || lower.contains("emotion") || lower.contains("roberta") {
        "Classifier".to_string()
    } else if lower.contains("audio") || lower.contains("whisper") || lower.contains("ace") || lower.contains("music") {
        "Audio".to_string()
    } else if lower.contains("diffusion") || lower.contains("stable") || lower.contains("sdxl") {
        "Image Gen".to_string()
    } else if lower.contains("code") || lower.contains("codellama") || lower.contains("deepseek-coder") {
        "Code LLM".to_string()
    } else {
        "LLM".to_string()
    }
}

// ─────────────────────────────────────────────
// COMMAND: LIST ALL MODELS
// ─────────────────────────────────────────────

#[tauri::command]
async fn list_models() -> Result<Vec<DiscoveredModel>, String> {
    let mut models: Vec<DiscoveredModel> = Vec::new();

    // 1. Query Ollama API for local LLMs
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .unwrap();

    if let Ok(response) = client
        .get("http://127.0.0.1:11434/api/tags")
        .send()
        .await
    {
        if let Ok(tags) = response.json::<OllamaTagsResponse>().await {
            for tag in tags.models {
                let display_name = tag.name.clone();
                let model_type = detect_model_type(&tag.name);
                let category = if model_type == "Code LLM" {
                    "Ollama Code Models".to_string()
                } else if model_type == "Embedding" {
                    "Ollama Embedding Models".to_string()
                } else {
                    "Ollama LLMs".to_string()
                };
                if model_type == "LLM" || model_type == "Code LLM" {
                    models.push(DiscoveredModel {
                        id: tag.name.clone(),
                        name: display_name,
                        category,
                        model_type,
                        size: Some(format_size(tag.size)),
                        source: "ollama".to_string(),
                    });
                }
            }
        }
    }

    // 2. Scan Hugging Face cache
    let home = dirs_next::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let hf_cache = home.join(".cache").join("huggingface").join("hub");

    if hf_cache.exists() {
        if let Ok(entries) = std::fs::read_dir(&hf_cache) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.starts_with("models--") && entry.path().is_dir() {
                    // Convert "models--org--name" -> "org/name"
                    let model_id = fname
                        .strip_prefix("models--")
                        .unwrap_or(&fname)
                        .replace("--", "/");
                    let display_name = model_id.split('/').last().unwrap_or(&model_id).to_string();
                    let model_type = detect_model_type(&model_id);
                    if model_type == "LLM" || model_type == "Code LLM" {
                        models.push(DiscoveredModel {
                            id: model_id.clone(),
                            name: display_name,
                            category: "Hugging Face Models".to_string(),
                            model_type,
                            size: None,
                            source: "huggingface".to_string(),
                        });
                    }
                }
            }
        }
    }

    // 3. Scan Keras models cache
    let keras_dir = home.join(".keras").join("models");
    if keras_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&keras_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                let ext = entry.path().extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if ["h5", "keras", "pkl", "pt", "pth"].contains(&ext.as_str()) {
                    let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    let model_type = detect_model_type(&fname);
                    if model_type == "LLM" || model_type == "Code LLM" {
                        models.push(DiscoveredModel {
                            id: fname.clone(),
                            name: fname.clone(),
                            category: "Keras Models".to_string(),
                            model_type,
                            size: Some(format_size(size_bytes)),
                            source: "keras".to_string(),
                        });
                    }
                }
            }
        }
    }

    Ok(models)
}

// ─────────────────────────────────────────────
// COMMAND: READ DIRECTORY (File Explorer)
// ─────────────────────────────────────────────

fn read_dir_recursive(path: &PathBuf, depth: u32) -> Vec<FileNode> {
    if depth == 0 { return vec![]; }
    let mut nodes = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        let mut entry_list: Vec<_> = entries.flatten().collect();
        entry_list.sort_by(|a, b| {
            let a_is_dir = a.path().is_dir();
            let b_is_dir = b.path().is_dir();
            b_is_dir.cmp(&a_is_dir).then(a.file_name().cmp(&b.file_name()))
        });

        for entry in entry_list {
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            // Skip hidden dirs and node_modules
            if name.starts_with('.') || name == "node_modules" || name == "target" { continue; }

            let is_dir = entry_path.is_dir();
            let extension = if is_dir { None } else {
                entry_path.extension().and_then(|e| e.to_str()).map(|s| s.to_string())
            };
            let children = if is_dir {
                Some(read_dir_recursive(&entry_path, depth - 1))
            } else {
                None
            };
            nodes.push(FileNode {
                name,
                path: entry_path.to_string_lossy().to_string(),
                is_dir,
                children,
                extension,
            });
        }
    }
    nodes
}

#[tauri::command]
fn read_directory(path: String) -> Result<Vec<FileNode>, String> {
    let dir = PathBuf::from(&path);
    if !dir.exists() { return Err(format!("Path does not exist: {}", path)); }
    Ok(read_dir_recursive(&dir, 5))
}

// ─────────────────────────────────────────────
// COMMAND: READ FILE
// ─────────────────────────────────────────────

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────
// COMMAND: WRITE FILE (Save)
// ─────────────────────────────────────────────

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────
// COMMAND: GENERATE AI RESPONSE (streaming)
// ─────────────────────────────────────────────

#[tauri::command]
async fn generate_response(
    window: Window,
    stream_id: String,
    model: String,
    messages: Vec<ChatMessage>,
    system_prompt: Option<String>,
    num_ctx: Option<u32>,
) -> Result<(), String> {
    // Prepend system message if one is provided
    let mut final_messages: Vec<ChatMessage> = Vec::new();
    if let Some(sp) = system_prompt {
        let trimmed = sp.trim().to_string();
        if !trimmed.is_empty() {
            final_messages.push(ChatMessage {
                role: "system".to_string(),
                content: trimmed,
            });
        }
    }
    final_messages.extend(messages);

    let client = reqwest::Client::new();
    let req_body = OllamaRequest {
        model,
        messages: final_messages,
        stream: true,
        options: OllamaOptions {
            num_ctx: num_ctx.unwrap_or(8192),
            temperature: 0.7,
            top_p: 0.9,
        },
        keep_alive: Some(-1),
    };

    let res = client
        .post("http://127.0.0.1:11434/api/chat")
        .json(&req_body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let mut stream = res.bytes_stream();
    let stream_event = format!("chat-stream-{}", stream_id);
    let done_event = format!("chat-stream-done-{}", stream_id);

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        for line in chunk_str.lines() {
            if line.is_empty() { continue; }
            if let Ok(parsed) = serde_json::from_str::<OllamaResponseChunk>(line) {
                if let Some(msg) = parsed.message {
                    let _ = window.emit(&stream_event, msg.content);
                }
                if parsed.done {
                    let _ = window.emit(&done_event, ());
                }
            }
        }
    }

    Ok(())
}

// ─────────────────────────────────────────────
// CHAT HISTORY PERSISTENCE
// ─────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub created_at: u64,
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentHistoryMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentHistorySession {
    pub id: String,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub keep_forever: bool,
    pub model: String,
    pub workspace: Option<String>,
    pub messages: Vec<AgentHistoryMessage>,
}

fn history_file(app: &tauri::AppHandle) -> PathBuf {
    let base = app.path().app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    std::fs::create_dir_all(&base).ok();
    base.join("chat_history.json")
}

fn agent_history_file(app: &tauri::AppHandle) -> PathBuf {
    let base = app.path().app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    std::fs::create_dir_all(&base).ok();
    base.join("agent_history.json")
}

fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn prune_chat_sessions(mut sessions: Vec<ChatSession>) -> Vec<ChatSession> {
    const THIRTY_DAYS_MS: u64 = 30 * 24 * 60 * 60 * 1000;
    let cutoff = now_unix_ms().saturating_sub(THIRTY_DAYS_MS);
    // created_at is in ms — keep sessions updated within the last 30 days
    sessions.retain(|s| s.created_at >= cutoff);
    sessions.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    sessions
}

fn prune_agent_sessions(mut sessions: Vec<AgentHistorySession>) -> Vec<AgentHistorySession> {
    const THIRTY_DAYS_MS: u64 = 30 * 24 * 60 * 60 * 1000;
    let cutoff = now_unix_ms().saturating_sub(THIRTY_DAYS_MS);
    sessions.retain(|session| session.keep_forever || session.updated_at >= cutoff);
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    sessions
}

#[tauri::command]
fn save_chat_history(app: tauri::AppHandle, sessions: Vec<ChatSession>) -> Result<(), String> {
    let path = history_file(&app);
    let pruned = prune_chat_sessions(sessions);
    let json = serde_json::to_string_pretty(&pruned).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_chat_history(app: tauri::AppHandle) -> Result<Vec<ChatSession>, String> {
    let path = history_file(&app);
    if !path.exists() { return Ok(vec![]); }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed: Vec<ChatSession> = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let pruned = prune_chat_sessions(parsed);
    let json = serde_json::to_string_pretty(&pruned).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(pruned)
}

#[tauri::command]
fn save_agent_history(app: tauri::AppHandle, sessions: Vec<AgentHistorySession>) -> Result<(), String> {
    let path = agent_history_file(&app);
    let pruned = prune_agent_sessions(sessions);
    let json = serde_json::to_string_pretty(&pruned).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_agent_history(app: tauri::AppHandle) -> Result<Vec<AgentHistorySession>, String> {
    let path = agent_history_file(&app);
    if !path.exists() { return Ok(vec![]); }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed: Vec<AgentHistorySession> = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let pruned = prune_agent_sessions(parsed);
    let json = serde_json::to_string_pretty(&pruned).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(pruned)
}

// ─────────────────────────────────────────────
// RECENT FILES PERSISTENCE
// ─────────────────────────────────────────────

fn recent_files_path(app: &tauri::AppHandle) -> PathBuf {
    let base = app.path().app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    std::fs::create_dir_all(&base).ok();
    base.join("recent_files.json")
}

#[tauri::command]
fn save_recent_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    let path = recent_files_path(&app);
    let json = serde_json::to_string_pretty(&paths).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_recent_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let path = recent_files_path(&app);
    if !path.exists() { return Ok(vec![]); }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────
// COMMAND: GET TEMP DIRECTORY
// ─────────────────────────────────────────────

#[tauri::command]
fn get_temp_dir() -> String {
    std::env::temp_dir().to_string_lossy().to_string()
}

// ─────────────────────────────────────────────
// TERMINAL COMMAND RUNNER
// ─────────────────────────────────────────────

#[tauri::command]
async fn run_terminal_command(
    window: Window,
    stream_id: String,
    command: String,
    cwd: String,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    let out_event = format!("terminal-out-{}", stream_id);
    let done_event = format!("terminal-done-{}", stream_id);

    // Use PowerShell on Windows, sh on Unix
    #[cfg(target_os = "windows")]
    let mut child = Command::new("powershell")
        .args(["-NoProfile", "-Command", &command])
        .current_dir(&cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(not(target_os = "windows"))]
    let mut child = Command::new("sh")
        .args(["-c", &command])
        .current_dir(&cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    // Stream stdout
    if let Some(stdout) = child.stdout.take() {
        let mut lines = BufReader::new(stdout).lines();
        let window_clone = window.clone();
        let out_event_clone = out_event.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = window_clone.emit(&out_event_clone, line);
            }
        });
    }

    // Stream stderr
    if let Some(stderr) = child.stderr.take() {
        let mut lines = BufReader::new(stderr).lines();
        let window_clone = window.clone();
        let out_event_clone = out_event.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = window_clone.emit(&out_event_clone, format!("\x1b[31m{}\x1b[0m", line));
            }
        });
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let exit_code = status.code().unwrap_or(-1);
    let _ = window.emit(&done_event, exit_code);

    Ok(())
}

// ─────────────────────────────────────────────
// COMMAND: INDEX DIRECTORY (RAG)
// ─────────────────────────────────────────────

#[tauri::command]
async fn index_directory(
    state: State<'_, AppState>,
    window: Window,
    dir: String,
    reindex: bool,
) -> Result<(), String> {
    let store = state.store.clone();
    if reindex {
        store.clear_directory(&dir).await;
    }

    let chunks = rag::chunk_directory(std::path::Path::new(&dir));
    let _total   = chunks.len();

    let win2 = window.clone();
    store.add_chunks(chunks, move |done, total| {
        let _ = win2.emit("index-progress", serde_json::json!({"done": done, "total": total}));
    }).await?;

    store.save().await?;
    let _ = window.emit("index-done", serde_json::json!({"chunks": store.record_count().await}));
    Ok(())
}

// ─────────────────────────────────────────────
// COMMAND: RAG SEARCH
// ─────────────────────────────────────────────

#[derive(Serialize)]
pub struct SearchResult {
    file_path:  String,
    content:    String,
    start_line: usize,
    end_line:   usize,
    score:      f32,
}

#[tauri::command]
async fn rag_search(
    state: State<'_, AppState>,
    query: String,
    k: usize,
    active_file: Option<String>,
    recent_files: Vec<String>,
) -> Result<Vec<SearchResult>, String> {
    let results = state.store.search(
        &query, k,
        active_file.as_deref(),
        &recent_files,
    ).await?;

    Ok(results.into_iter().map(|(chunk, score)| SearchResult {
        file_path:  chunk.file_path,
        content:    chunk.content,
        start_line: chunk.start_line,
        end_line:   chunk.end_line,
        score,
    }).collect())
}

// ─────────────────────────────────────────────
// COMMAND: START AGENT
// ─────────────────────────────────────────────

#[tauri::command]
async fn start_agent(
    state: State<'_, AppState>,
    window: Window,
    id: String,
    task: String,
    workspace: String,
    model: String,
    context_messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let store     = state.store.clone();
    let approvals = state.approvals.clone();
    let cancellations = state.cancellations.clone();
    let cancel_token = agent::register_cancellation(&cancellations, &id).await;

    tokio::spawn(async move {
        agent::run_agent(
            window,
            id,
            task,
            workspace,
            model,
            context_messages,
            store,
            approvals,
            cancel_token,
            cancellations,
        ).await;
    });

    Ok(())
}

// ─────────────────────────────────────────────
// COMMAND: APPROVE AGENT ACTION
// ─────────────────────────────────────────────

#[tauri::command]
async fn agent_approve(
    state: State<'_, AppState>,
    action_id: String,
    approved: bool,
) -> Result<(), String> {
    agent::resolve_approval(&state.approvals, &action_id, approved).await;
    Ok(())
}

#[tauri::command]
async fn cancel_agent(
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    Ok(agent::cancel_task(&state.cancellations, &id).await)
}

// ─────────────────────────────────────────────
// COMMAND: INDEX STATUS
// ─────────────────────────────────────────────

#[tauri::command]
async fn get_index_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let count = state.store.record_count().await;
    Ok(serde_json::json!({ "chunks": count }))
}

// ─────────────────────────────────────────────
// GIT COMMANDS
// ─────────────────────────────────────────────

fn run_git(args: &[&str], cwd: &str) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git not found: {}", e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
fn get_git_branch(dir: String) -> Result<String, String> {
    run_git(&["rev-parse", "--abbrev-ref", "HEAD"], &dir)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitFileStatus {
    pub status: String,
    pub path: String,
    pub staged: bool,
}

#[tauri::command]
fn git_status(dir: String) -> Result<Vec<GitFileStatus>, String> {
    let output = run_git(&["status", "--short", "--porcelain"], &dir)?;
    let files = output
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let status_chars: &str = &line[..2];
            let path = line[3..].trim().to_string();
            let x = &status_chars[..1];
            let y = &status_chars[1..];
            // Index status (staged) vs worktree (unstaged)
            let staged = x != " " && x != "?";
            let eff_status = if staged { x } else { y };
            let status = match eff_status.trim() {
                "M" => "M",
                "A" => "A",
                "D" => "D",
                "R" => "R",
                "C" => "C",
                "?" => "?",
                _ => eff_status.trim(),
            }.to_string();
            GitFileStatus { status, path, staged }
        })
        .collect();
    Ok(files)
}

#[tauri::command]
fn git_commit(dir: String, message: String) -> Result<String, String> {
    run_git(&["add", "-A"], &dir)?;
    run_git(&["commit", "-m", &message], &dir)
}

#[tauri::command]
fn git_push(dir: String) -> Result<String, String> {
    run_git(&["push"], &dir)
}

#[tauri::command]
fn git_pull(dir: String) -> Result<String, String> {
    run_git(&["pull"], &dir)
}

#[tauri::command]
fn git_diff(dir: String, file_path: String) -> Result<String, String> {
    // Try staged diff first, then unstaged
    let staged = run_git(&["diff", "--cached", "--", &file_path], &dir).unwrap_or_default();
    let unstaged = run_git(&["diff", "--", &file_path], &dir).unwrap_or_default();
    let combined = format!("{}{}", staged, unstaged);
    if combined.trim().is_empty() {
        // Possibly untracked — show content as all-added
        let content = std::fs::read_to_string(&file_path)
            .unwrap_or_else(|_| "(unreadable)".to_string());
        Ok(format!("+ (new file)\n{}", content))
    } else {
        Ok(combined)
    }
}

// ─────────────────────────────────────────────
// WORKSPACE SEARCH
// ─────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchMatchResult {
    pub file_path: String,
    pub line_number: usize,
    pub line_content: String,
    pub match_start: usize,
    pub match_end: usize,
}

#[tauri::command]
fn search_in_files(
    dir: String,
    query: String,
    is_regex: bool,
    case_sensitive: bool,
    whole_word: bool,
) -> Result<Vec<SearchMatchResult>, String> {
    use ignore::WalkBuilder;
    use regex::RegexBuilder;

    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    let pattern = if is_regex {
        query.clone()
    } else {
        regex::escape(&query)
    };

    let pattern = if whole_word {
        format!(r"\b{}\b", pattern)
    } else {
        pattern
    };

    let re = RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("Invalid regex: {}", e))?;

    let mut results = Vec::new();

    let walker = WalkBuilder::new(&dir)
        .hidden(true)
        .ignore(true)
        .git_ignore(true)
        .build();

    for entry in walker.flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        // Skip binary-likely extensions
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if matches!(ext, "exe"|"dll"|"so"|"a"|"lib"|"bin"|"png"|"jpg"|"jpeg"|"gif"|"ico"|"webp"|"wasm"|"pdf") {
            continue;
        }
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        for (line_idx, line) in content.lines().enumerate() {
            for m in re.find_iter(line) {
                results.push(SearchMatchResult {
                    file_path: path.to_string_lossy().to_string(),
                    line_number: line_idx + 1,
                    line_content: line.to_string(),
                    match_start: m.start(),
                    match_end: m.end(),
                });
            }
        }
        if results.len() > 5000 { break; } // Safety cap
    }

    Ok(results)
}

#[tauri::command]
fn replace_in_file(
    path: String,
    old_text: String,
    new_text: String,
    is_regex: bool,
    case_sensitive: bool,
) -> Result<(), String> {
    use regex::RegexBuilder;
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let pattern = if is_regex { old_text.clone() } else { regex::escape(&old_text) };
    let re = RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("Invalid regex: {}", e))?;
    let replaced = re.replace_all(&content, new_text.as_str()).to_string();
    std::fs::write(&path, replaced).map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────
// APP ENTRY
// ─────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store     = rag::VectorStore::new();
    let approvals = agent::new_approval_map();
    let cancellations = agent::new_cancellation_map();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            store,
            approvals,
            cancellations,
            index_progress: tokio::sync::Mutex::new((0, 0, "idle".into())),
        })
        .invoke_handler(tauri::generate_handler![
            generate_response,
            list_models,
            read_directory,
            read_file,
            write_file,
            get_temp_dir,
            save_chat_history,
            load_chat_history,
            save_agent_history,
            load_agent_history,
            save_recent_files,
            load_recent_files,
            run_terminal_command,
            // ── RAG + Agent ──
            index_directory,
            rag_search,
            start_agent,
            agent_approve,
            cancel_agent,
            get_index_status,
            // ── Git ──
            get_git_branch,
            git_status,
            git_commit,
            git_push,
            git_pull,
            git_diff,
            // ── Search ──
            search_in_files,
            replace_in_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
