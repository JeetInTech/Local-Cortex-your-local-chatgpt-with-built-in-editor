use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, Window};
use futures_util::StreamExt;
use std::path::PathBuf;

// ─────────────────────────────────────────────
// CHAT / AI TYPES
// ─────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OllamaRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
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
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let req_body = OllamaRequest {
        model,
        messages,
        stream: true,
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

fn history_file(app: &tauri::AppHandle) -> PathBuf {
    let base = app.path().app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    std::fs::create_dir_all(&base).ok();
    base.join("chat_history.json")
}

#[tauri::command]
fn save_chat_history(app: tauri::AppHandle, sessions: Vec<ChatSession>) -> Result<(), String> {
    let path = history_file(&app);
    let json = serde_json::to_string_pretty(&sessions).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_chat_history(app: tauri::AppHandle) -> Result<Vec<ChatSession>, String> {
    let path = history_file(&app);
    if !path.exists() { return Ok(vec![]); }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
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
// APP ENTRY
// ─────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            generate_response,
            list_models,
            read_directory,
            read_file,
            write_file,
            save_chat_history,
            load_chat_history,
            save_recent_files,
            load_recent_files,
            run_terminal_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
