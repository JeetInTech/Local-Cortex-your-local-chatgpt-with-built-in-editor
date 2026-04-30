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
6. The embedding model used by this app's indexing feature:
   - required for RAG/indexing: `nomic-embed-text`

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

From reading the codebase, these are the important runtime assumptions:

- Chat requests are sent to Ollama at `http://127.0.0.1:11434/api/chat`
- Installed Ollama models are read from `http://127.0.0.1:11434/api/tags`
- RAG embeddings are requested from `http://127.0.0.1:11434/api/embeddings`
- The default chat model in the UI is `llama3.2:latest`
- The embedding model in Rust is hardcoded to `nomic-embed-text`

That means:

- if Ollama is missing, the app can open but AI features will fail
- if `llama3.2` is missing, the default chat flow will not work until the user picks another installed model
- if `nomic-embed-text` is missing, indexing and retrieval will fail

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

Install the embedding model used by Local Cortex indexing:

```powershell
ollama pull nomic-embed-text
```

You can verify installed models with:

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

- [check_local_cortex_requirements.bat](E:\Zen\projects\2026 - PROJECTS\Offline gpt\check_local_cortex_requirements.bat)

Run it before launching the app. It will:

- check whether Local Cortex exists
- check whether Ollama is installed
- check whether Ollama is reachable
- check whether `llama3.2` is installed
- check whether `nomic-embed-text` is installed
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

This repository already includes installers that may help on Windows:

- [rustup-init.exe](E:\Zen\projects\2026 - PROJECTS\Offline gpt\rustup-init.exe)
- [vs_BuildTools.exe](E:\Zen\projects\2026 - PROJECTS\Offline gpt\vs_BuildTools.exe)

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
2. [check_local_cortex_requirements.bat](E:\Zen\projects\2026 - PROJECTS\Offline gpt\check_local_cortex_requirements.bat)
3. these exact setup commands:

```powershell
ollama pull llama3.2
ollama pull nomic-embed-text
```

## Runtime Notes

- Chat UI depends on Ollama chat API
- Agent mode depends on Ollama chat API
- Model selector depends on Ollama tags API
- RAG indexing depends on Ollama embeddings API
- Git panel depends on `git`
- live preview server depends on `python`

## Important Limitation

This project does not currently auto-install Ollama or auto-pull the required models by itself. The installer/check script can guide the user, but the user still needs to:

1. install Ollama
2. run the model pull commands
3. re-run the checker

## Files Added for Installation Support

- [README.md](E:\Zen\projects\2026 - PROJECTS\Offline gpt\README.md)
- [check_local_cortex_requirements.bat](E:\Zen\projects\2026 - PROJECTS\Offline gpt\check_local_cortex_requirements.bat)
