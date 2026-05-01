# Backend Implementation Plan: Local Cortex

The frontend interface is complete and fully functional in the browser. The next phase is to build the **Rust backend** that will turn this into a native Windows application and connect it to a local AI.

## > [!WARNING]
## Prerequisite: Installing Rust
I detected that **Rust is not currently installed** on your system. Tauri requires Rust to compile the native desktop application.
Before we can write the backend code, you will need to install it:
1. Download and run `rustup-init.exe` from [https://rustup.rs/](https://rustup.rs/).
2. You may also need the **C++ build tools** for Visual Studio (the installer will prompt you if you do).
3. Once installed, you will need to restart your terminal/VS Code so that the `cargo` command is recognized.

## > [!IMPORTANT]
## Open Question: AI Integration Architecture
We know we are connecting to a local, offline AI. However, there are two primary ways we can architect the backend to do this. **Please let me know which path you prefer:**

### Option 1: The "Ollama" Bridge (Recommended & Easiest)
- **How it works:** You install [Ollama](https://ollama.com/) separately on your computer. Our Rust backend simply acts as a secure bridge, talking to Ollama in the background.
- **Pros:** Extremely fast setup, incredibly stable, automatically manages hardware acceleration, keeps our app file size tiny, and gives you access to a huge library of models.
- **Cons:** Requires you to have Ollama running in the background.

### Option 2: The Self-Contained "Sidecar" 
- **How it works:** We bundle a pre-compiled `llama.cpp` server directly inside the app. When you double-click Local Cortex, it silently starts the AI engine itself.
- **Pros:** Truly standalone. No external software needed.
- **Cons:** Much more complex to build, requires managing large `.gguf` model files directly on your hard drive, and hardware acceleration (like using your GPU) can be finicky across different computers.

---

## Proposed Changes

### 1. Environment Setup
- Wait for user to install Rust.
- Initialize the Tauri Rust backend properly if any files are missing in `src-tauri`.
- Add required Rust crates (e.g., `reqwest` or `ollama-rs` for HTTP communication, `serde` for JSON).

### 2. The Rust Backend (`src-tauri/src/main.rs`)
- Create a Tauri "Command" (a Rust function callable from React) named `generate_response`.
- This command will take the chat history and the selected model name as inputs.
- It will stream the response back to the frontend event system so the UI updates in real-time.

### 3. Frontend Integration
#### [MODIFY] `src/components/GptView.tsx` & `src/components/EditorView.tsx`
- Replace the current mock `setTimeout` logic.
- Import `@tauri-apps/api/core` to invoke the `generate_response` command.
- Implement a listener to handle real-time streaming chunks from the backend.

## Verification Plan
1. Compile the app as a native `.exe` using `npm run tauri build` (or run in dev mode via `npm run tauri dev`).
2. Type a message into the GPT chat interface and verify that a real, local AI processes the prompt and streams the text back into the UI.
