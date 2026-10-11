# Local Cortex

Local Cortex is a Windows desktop AI workspace built with Tauri, React, TypeScript, and Rust. It combines:

- a local AI chat view
- a code/editor workspace
- file explorer, terminal, Git, and workspace search
- local model discovery
- RAG-style indexing using Ollama embeddings

This project is designed to run as a packaged Windows app (`.exe` / installer), with Ollama providing the local model runtime.

## What This App Needs

### Required for normal software use

To run the packaged Local Cortex app as an end user, the minimum requirements are:

1. Windows 10 or Windows 11
2. Local Cortex desktop app (`Local Cortex.exe` or the generated installer)
3. [Ollama for Windows](https://ollama.com/download/windows)
4. Ollama running locally on `http://127.0.0.1:11434`
5. A chat model installed in Ollama:
   - recommended: `llama3.2`

### Optional but useful inside the app

These are not required just to open Local Cortex, but some features depend on them:

- [Git for Windows](https://git-scm.com/download/win): Git sidebar and Git actions
- [Python for Windows](https://www.python.org/downloads/windows/): live server and Python file execution

### Required only if you want to build the app from source

If you want to create the `.exe` / installer yourself from this repository, you also need:

1. [Node.js 18+](https://nodejs.org/)
2. [Rust stable](https://rustup.rs/)
3. Microsoft C++ Build Tools with `Desktop development with C++`
4. WebView2 runtime
5. VBSCRIPT Windows feature if you build the MSI target and Windows asks for it

Tauri's official Windows prerequisites are documented here:

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri WebView2 notes](https://v2.tauri.app/reference/webview-versions/)

Ollama references:

- [Ollama Windows download](https://ollama.com/download/windows)
- [Ollama quickstart](https://docs.ollama.com/quickstart)
- [Ollama CLI reference](https://docs.ollama.com/cli)
- [Ollama model pull API reference](https://docs.ollama.com/api/pull)

## How This Project Works

- All AI calls go from the Rust backend to Ollama at `http://127.0.0.1:11434` (`/api/chat`, `/api/tags`, `/api/pull`, `/api/embeddings`).
- To use Ollama on another machine (e.g. a PC with a bigger GPU), set the `OLLAMA_HOST` environment variable before starting the app, e.g. `192.168.1.20:11434`. It is read the same way the `ollama` CLI reads it.
- If Ollama is missing, the app opens but AI features fail. If no model is installed, pick or pull one first.

### The coding agent

The agent (Editor view, right panel) works only inside the folder you open, and cannot touch paths outside it.

- It uses Ollama's native tool calling, and falls back to a JSON text protocol for models without tool support.
- Tools: `read_file` (paged, line-numbered), `write_file`, `edit_file` (exact snippet replace), `delete_file`, `list_directory`, `grep`, `run_command` (PowerShell, 120 s timeout).
- Approval modes: **Default** asks before commands and deletes, **Manual** also asks before file edits, **Auto** approves everything.
- If the project has an `AGENTS.md` or `CLAUDE.md`, it is added to the agent's instructions.

The model decides how good the agent is. `llama3.2` (3B, fits a 4 GB GPU) handles small single-file fixes. Use `qwen2.5-coder:7b` or larger for real multi-file work.

Backend tests: `cd src-tauri && cargo test --lib`. To run the agent end to end against your local Ollama: `cargo test --lib live_agent -- --ignored --nocapture` (set `LC_TEST_MODEL` to pick the model).

## End-User Installation Guide

Use this section when distributing Local Cortex as software to someone who should only install and run it.

### Step 1: Install Ollama

Download and install Ollama for Windows:

- [Download Ollama for Windows](https://ollama.com/download/windows)

After installation, open PowerShell or Command Prompt and verify:

```powershell
ollama --version
```

### Step 2: Install the required Ollama models

Install the default chat model:

```powershell
ollama pull llama3.2
```

*(Note: `llama3.2` is the only **required** model for the app to function properly out of the box).*

#### Optional: Additional Recommended Models

You can install other models depending on your needs. They are **strictly optional** but highly recommended for better performance or specific use cases:

- **`llama3.1:8b`**: Best for heavy-duty coding & Agent tasks. (Run `ollama pull llama3.1:8b`)
- **`mistral-nemo`**: Best for large codebases & complex logic, massive context window. (Run `ollama pull mistral-nemo`)
- **`phi3`**: Extremely fast, snappy questions and logic. Great for lower-end hardware. (Run `ollama pull phi3`)
- **`dolphin-llama3`**: Completely uncensored, unfiltered tasks without guardrails. (Run `ollama pull dolphin-llama3`)

You can verify your installed models at any time with:

```powershell
ollama ls
```

### Step 3: Make sure Ollama is running

Usually Ollama runs in the background after installation. If needed, start it and confirm the API is reachable:

```powershell
ollama serve
```

Local Cortex expects Ollama on:

```text
http://127.0.0.1:11434
```

### Step 4: Install Local Cortex

Use one of these distribution options:

1. Installer build:
   - install the generated `msi` or setup package from `src-tauri/target/release/bundle`
2. Portable app:
   - place `Local Cortex.exe` and any related files in a folder and run it directly

### Step 5: Run the health-check script

This repository now includes:

- [check_local_cortex_requirements.bat](check_local_cortex_requirements.bat)

Run it before launching the app. It will:

- check whether Local Cortex exists
- check whether Ollama is installed
- check whether Ollama is reachable
- check whether `llama3.2` is installed
- report optional tools like Git and Python
- offer to open download/install links when something is missing

### Step 6: Open Local Cortex

When all required checks pass, launch the app:

- `Local Cortex.exe`

## Recommended Packaging Flow for Distribution

If you want this project to be delivered like real Windows software, use this flow:

1. Build the Tauri release bundle
2. Keep Ollama as a separate required dependency
3. Give users:
   - the Local Cortex installer or `.exe`
   - the batch checker
   - a short install note telling them to install Ollama and pull the two required models

### Why Ollama should stay separate

This codebase is currently written to call a local Ollama server directly. It does not bundle a private model runtime or ship a self-contained `llama.cpp` sidecar. So the cleanest supported deployment is:

- Local Cortex app
- user-installed Ollama
- user-pulled models

## Build the `.exe` / installer from source

Use this section only if you are building the software yourself.

### 1. Install prerequisites

Install:

- Node.js 18+
- Rust stable
- Microsoft C++ Build Tools
- WebView2 runtime

Installers:

- [rustup](https://rustup.rs/)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

### 2. Install JavaScript dependencies

From the project root:

```powershell
npm install
```

### 3. Run the app in development

Frontend only:

```powershell
npm run dev
```

Desktop app with Tauri:

```powershell
npm run tauri dev
```

### 4. Build production assets

```powershell
npm run build
```

### 5. Build the Windows app bundle

```powershell
npm run tauri build
```

Because `src-tauri/tauri.conf.json` uses:

```json
"targets": "all"
```

Tauri will try to generate all configured Windows bundle targets.

Expected output is typically under:

```text
src-tauri\target\release\bundle\
```

## Suggested Software Delivery Checklist

When you hand this app to another person, give them these three things:

1. the Local Cortex installer or `.exe`
2. [check_local_cortex_requirements.bat](check_local_cortex_requirements.bat)
3. these exact setup commands:

```powershell
ollama pull llama3.2
```

## Runtime Notes

- Chat UI depends on Ollama chat API
- Agent mode depends on Ollama chat API
- Model selector depends on Ollama tags API
- RAG indexing depends on Ollama embeddings API
- Git panel depends on `git`
- live preview server depends on `python`

## Important Limitation

Local Cortex does not install Ollama itself. Once Ollama is installed and running, the first-run setup wizard pulls the models through it.

## Files Added for Installation Support

- [README.md](README.md)
- [check_local_cortex_requirements.bat](check_local_cortex_requirements.bat)

## Code signing policy

> **Status:** applied to the SignPath Foundation. Until the application is approved, releases are **not** code-signed; this line is removed when signing starts.

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

Team roles:

- Committers and reviewers: [Sangramjeet Ghosh (JeetInTech)](https://github.com/JeetInTech)
- Approvers: [Sangramjeet Ghosh (JeetInTech)](https://github.com/JeetInTech)

Every release is built from this repository by GitHub Actions ([build-release.yml](.github/workflows/build-release.yml)) when a version tag is pushed. Nothing built on a personal machine is signed, and each signing request is approved manually.

See the [privacy policy](#privacy) below.

## Privacy

Local Cortex runs entirely on your computer. Your chats, files and code are processed by your local Ollama install (`127.0.0.1:11434`) and never leave your machine. If you set `OLLAMA_HOST` to another machine, they are sent to that Ollama server instead.

The one automatic network request is an update check: when the app starts, it checks for updates via `latest.json` from this repository's [GitHub releases](https://github.com/JeetInTech/Local-Cortex-your-local-chatgpt-with-built-in-editor/releases/latest) to see whether a newer version exists. No personal data or content is sent with it; GitHub sees the request the way it sees any download. Updates are installed only when you choose to.

Local Cortex has no analytics, telemetry or accounts. It can be removed at any time with Windows' *Add or remove programs*.
