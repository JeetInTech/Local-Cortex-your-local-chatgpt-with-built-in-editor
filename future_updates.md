# Future Updates & Known Flaws (src-tauri/src/lib.rs)

This document outlines significant architectural, performance, and reliability flaws found in the Tauri backend (`lib.rs`) and proposed solutions for future updates.

## 🚨 Critical Flaws

### 1. Silent Token Dropping in AI Stream (`generate_response`)
**Issue:** The Ollama response is streamed using `res.bytes_stream()`, and it assumes that the network chunks perfectly align with newlines (`chunk_str.lines()`). Network boundaries are arbitrary; a chunk might look like `{"message": {"role": "assista` and the next chunk `nt", "content": "hello"}}`. When this happens, `serde_json::from_str` fails on the partial line, and `if let Ok(...)` silently ignores the error. This results in randomly dropped text/tokens in the UI.
**Fix:** Maintain a `String` (or `Vec<u8>`) buffer. Append incoming chunks to the buffer, split by `\n`, process complete lines, and keep the remainder in the buffer for the next chunk.

### 2. Blocking I/O inside Async Functions (`list_models`)
**Issue:** `list_models` is an `async fn` (running on a Tokio worker thread), but it uses synchronous `std::fs::read_dir` to walk the Hugging Face and Keras caches. Blocking a Tokio thread with synchronous file system I/O can stall the entire async runtime, delaying other background tasks (like AI streaming or RAG indexing).
**Fix:** Use `tokio::fs::read_dir` or wrap the synchronous blocks in `tokio::task::spawn_blocking`.

## ⚠️ Moderate / Performance Flaws

### 3. Synchronous Heavy Commands Freezing the UI
**Issue:** Commands like `read_directory`, `search_in_files`, and all the `git_*` functions are synchronous. `search_in_files` synchronously iterates over the entire project directory and reads every file into memory to run a regex. If a user searches a large repository, the Tauri command thread pool will block, causing the entire app UI to freeze or stutter.
**Fix:** Change these to `async fn` and use `tokio::fs` or `tokio::task::spawn_blocking` for heavy operations.

### 4. Hardcoded Depth in `read_directory`
**Issue:** A depth of `5` is passed to `read_dir_recursive`. For many modern projects (especially Java, Node.js, or deep Rust workspaces), important source files can easily be deeper than 5 folders. These files will silently fail to appear in the file explorer.
**Fix:** Increase the depth significantly, or refactor the frontend to lazy-load folders when the user expands them.

### 5. Re-creating HTTP Clients
**Issue:** In both `list_models` and `generate_response`, `reqwest::Client::new()` is called. This throws away `reqwest`'s internal connection pool. Creating a new client for every API call is inefficient and adds unnecessary latency.
**Fix:** Create a single shared `reqwest::Client` in the `AppState` inside the `run()` function and reuse it across commands.

### 6. Hardcoded Ollama URL
**Issue:** `http://127.0.0.1:11434` is hardcoded in `check_ollama`, `list_models`, and `generate_response`. If the user runs Ollama on a different port, a custom host, or inside a Docker container, the app will fail with no way to configure it.
**Fix:** Move the base URL to a settings file or an environment variable that the user can configure in the UI.

## 💡 Minor & Maintainability Flaws

### 7. Incomplete Directory Ignores
**Issue:** `read_dir_recursive` hardcodes ignoring `node_modules` and `target`. It will still index and freeze up on other massive directories like `.venv`, `dist`, `build`, `__pycache__`, `.next`, etc.
**Fix:** Consider using the `ignore` crate (which is already used in `search_in_files`) to respect the project's `.gitignore` when populating the file tree.

### 8. Inefficient Chat History I/O
**Issue:** Every time `save_chat_history` or `load_chat_history` runs, it loads the entire file into memory, parses the JSON, prunes old data, re-serializes the whole thing, and writes it back to disk. As chat history grows, this will become noticeably slow.
**Fix:** Consider moving to an embedded SQLite database (like `rusqlite` or `sqlx`) for persistent chat and agent history.

### 9. Terminal Output ANSI Escapes
**Issue:** In `run_terminal_command`, `\x1b[31m` is injected directly into the `stderr` stream output. If the frontend chat component doesn't have an ANSI escape parser (like `xterm.js` or `ansi-to-html`), this will show up as raw garbage characters in the UI.
**Fix:** Ensure the frontend handles ANSI color codes properly, or strip them out / send structured error events instead.
