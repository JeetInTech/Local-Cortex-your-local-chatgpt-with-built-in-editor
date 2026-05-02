import { useState, useEffect } from "react";
import { AlertCircle, CheckCircle2, ChevronRight, Play, RefreshCw, ExternalLink, Download, Loader2 } from "lucide-react";
import { open } from '@tauri-apps/plugin-shell';

export interface SetupWizardProps {
  onComplete: () => void;
}

const OLLAMA_URL = "http://127.0.0.1:11434";

const COMPULSORY_MODELS = [
  { id: "llama3.2:latest",   name: "llama3.2:latest",   size: "1.9 GB",  description: "Core chat & reasoning — required" },
  { id: "nomic-embed-text", name: "nomic-embed-text", size: "274 MB", description: "Semantic search & RAG — required" },
];

const OPTIONAL_MODELS = [
  { id: "qwen2.5-coder:7b",   name: "qwen2.5-coder:7b",   size: "4.7 GB", description: "Advanced code generation" },
  { id: "qwen2.5-math:7b",    name: "qwen2.5-math:7b",    size: "4.7 GB", description: "Math reasoning & equations" },
  { id: "mistral-nemo:latest", name: "mistral-nemo:latest", size: "6.6 GB", description: "Large context, general purpose" },
  { id: "phi3:latest",         name: "phi3:latest",         size: "2.0 GB", description: "Fast reasoning from Microsoft" },
  { id: "llama3.1:8b",         name: "llama3.1:8b",         size: "4.6 GB", description: "Heavier, complex instructions" },
  { id: "dolphin-llama3:latest", name: "dolphin-llama3:latest", size: "4.3 GB", description: "Uncensored fine-tune of Llama 3" },
  { id: "mistral:latest",      name: "mistral:latest",      size: "4.1 GB", description: "Reliable general-purpose model" },
  { id: "llama3.2:1b",         name: "llama3.2:1b",         size: "1.2 GB", description: "Ultra-light, instant responses" },
];

type Step = 'CHECKING' | 'MISSING_OLLAMA' | 'SELECT_MODELS' | 'DOWNLOADING' | 'SUCCESS';

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<Step>('CHECKING');
  const [selectedOptional, setSelectedOptional] = useState<string[]>(["qwen2.5-coder:7b"]);
  const [downloadProgress, setDownloadProgress] = useState<{ [key: string]: { status: string; pct: number } }>({});
  const [currentDownload, setCurrentDownload] = useState<string | null>(null);

  const checkOllama = async () => {
    setStep('CHECKING');
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`);
      if (res.ok) {
        setStep('SELECT_MODELS');
      } else {
        setStep('MISSING_OLLAMA');
      }
    } catch {
      setStep('MISSING_OLLAMA');
    }
  };

  useEffect(() => { checkOllama(); }, []);

  const handleStartPull = async () => {
    setStep('DOWNLOADING');
    const modelsToPull = [...COMPULSORY_MODELS.map(m => m.id), ...selectedOptional];

    for (const model of modelsToPull) {
      setCurrentDownload(model);
      setDownloadProgress(prev => ({ ...prev, [model]: { status: "Connecting...", pct: 0 } }));

      try {
        const response = await fetch(`${OLLAMA_URL}/api/pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: model }),
        });
        if (!response.body) throw new Error("No body");
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n").filter(l => l.trim())) {
            try {
              const data = JSON.parse(line);
              let pct = 0;
              if (data.total && data.completed) pct = Math.round((data.completed / data.total) * 100);
              setDownloadProgress(prev => ({
                ...prev,
                [model]: { status: data.status ?? prev[model]?.status ?? "Downloading...", pct: pct || prev[model]?.pct || 0 },
              }));
            } catch { /* ignore partial JSON */ }
          }
        }
        setDownloadProgress(prev => ({ ...prev, [model]: { status: "done", pct: 100 } }));
      } catch (err) {
        console.error(`Failed to pull ${model}`, err);
        setDownloadProgress(prev => ({ ...prev, [model]: { status: "failed", pct: 0 } }));
      }
    }
    setTimeout(() => setStep('SUCCESS'), 800);
  };

  const toggle = (id: string) =>
    setSelectedOptional(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const openUrl = async (url: string) => {
    try { await open(url); } catch { window.open(url, '_blank'); }
  };

  const totalSelected = COMPULSORY_MODELS.length + selectedOptional.length;

  /* ── Styles ────────────────────────────────────────────────── */
  const card: React.CSSProperties = {
    width: 740,
    maxWidth: '96vw',
    background: 'var(--vscode-sidebar, #1e1e1e)',
    border: '1px solid var(--vscode-border, #2d2d2d)',
    borderRadius: 8,
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    overflow: 'hidden',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    fontSize: 13,
    color: 'var(--vscode-text, #ccc)',
  };

  const header: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px 20px',
    borderBottom: '1px solid var(--vscode-border, #2d2d2d)',
    background: 'var(--vscode-titlebar, #252526)',
  };

  const body: React.CSSProperties = { padding: '20px 24px' };

  const btnPrimary: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 16px',
    background: 'var(--vscode-accent, #007acc)',
    color: '#fff', border: 'none', borderRadius: 4,
    cursor: 'pointer', fontWeight: 600, fontSize: 12,
  };

  const btnGhost: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 14px',
    background: 'transparent',
    color: 'var(--vscode-text, #bbb)',
    border: '1px solid var(--vscode-border, #3a3a3a)',
    borderRadius: 4, cursor: 'pointer', fontSize: 12,
  };

  const modelRow = (selected: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '6px 10px', borderRadius: 4, cursor: 'pointer',
    background: selected ? 'rgba(0,122,204,0.08)' : 'transparent',
    border: `1px solid ${selected ? 'rgba(0,122,204,0.35)' : 'transparent'}`,
    transition: 'all 0.12s',
    userSelect: 'none',
  });

  const checkbox = (checked: boolean): React.CSSProperties => ({
    width: 14, height: 14, flexShrink: 0,
    borderRadius: 3,
    border: `1.5px solid ${checked ? 'var(--vscode-accent, #007acc)' : '#555'}`,
    background: checked ? 'var(--vscode-accent, #007acc)' : 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--vscode-bg, #141414)' }}>
      <div style={card}>

        {/* ── Header ── */}
        <div style={header}>
          <img src="/logo.jpeg" alt="Logo" style={{ width: 20, height: 20, borderRadius: 4 }} />
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--vscode-text-active, #ddd)' }}>Local Cortex — First-Time Setup</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#555' }}>v1.0</span>
        </div>

        <div style={body}>

          {/* ── CHECKING ── */}
          {step === 'CHECKING' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '24px 0' }}>
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', flexShrink: 0, color: 'var(--vscode-accent, #007acc)' }} />
              <span>Detecting Ollama on port 11434…</span>
            </div>
          )}

          {/* ── MISSING OLLAMA ── */}
          {step === 'MISSING_OLLAMA' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 16 }}>
                <AlertCircle size={16} color="#f14c4c" style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontWeight: 600, color: '#f14c4c', marginBottom: 4, fontSize: 13 }}>Ollama not detected</div>
                  <div style={{ lineHeight: 1.6, color: 'var(--vscode-text, #aaa)', fontSize: 12 }}>
                    Local Cortex needs <strong>Ollama</strong> to run AI models offline. Install it, launch it, then click <em>Check Again</em>.
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btnPrimary} onClick={() => openUrl('https://ollama.com/download')}>
                  <ExternalLink size={12} /> Download Ollama
                </button>
                <button style={btnGhost} onClick={checkOllama}>
                  <RefreshCw size={12} /> Check Again
                </button>
              </div>
            </div>
          )}

          {/* ── SELECT MODELS ── */}
          {step === 'SELECT_MODELS' && (
            <div>
              {/* Required */}
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#666', marginBottom: 8 }}>Required</div>
              {COMPULSORY_MODELS.map(m => (
                <div key={m.id} style={{ ...modelRow(true), cursor: 'default', marginBottom: 4 }}>
                  <div style={{ ...checkbox(true) }}>
                    <CheckCircle2 size={10} color="#fff" />
                  </div>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--vscode-text-active, #ddd)', flex: 1 }}>{m.name}</span>
                  <span style={{ fontSize: 11, color: '#888', marginRight: 12 }}>{m.description}</span>
                  <span style={{ fontSize: 11, color: 'var(--vscode-accent, #007acc)', fontFamily: 'monospace' }}>{m.size}</span>
                </div>
              ))}

              {/* Optional */}
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#666', margin: '16px 0 8px' }}>Optional</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 260, overflowY: 'auto', paddingRight: 2 }}>
                {OPTIONAL_MODELS.map(m => {
                  const sel = selectedOptional.includes(m.id);
                  return (
                    <div key={m.id} style={modelRow(sel)} onClick={() => toggle(m.id)}>
                      <div style={checkbox(sel)}>
                        {sel && <CheckCircle2 size={10} color="#fff" />}
                      </div>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: sel ? 'var(--vscode-text-active, #ddd)' : '#999', flex: 1 }}>{m.name}</span>
                      <span style={{ fontSize: 11, color: '#777', marginRight: 12 }}>{m.description}</span>
                      <span style={{ fontSize: 11, color: '#666', fontFamily: 'monospace' }}>{m.size}</span>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--vscode-border, #2d2d2d)' }}>
                <span style={{ fontSize: 12, color: '#666' }}>{totalSelected} model{totalSelected !== 1 ? 's' : ''} selected</span>
                <button style={btnPrimary} onClick={handleStartPull}>
                  <Download size={12} /> Start Download <ChevronRight size={12} />
                </button>
              </div>
            </div>
          )}

          {/* ── DOWNLOADING ── */}
          {step === 'DOWNLOADING' && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#666', marginBottom: 12 }}>Pulling models</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 320, overflowY: 'auto' }}>
                {[...COMPULSORY_MODELS, ...OPTIONAL_MODELS.filter(m => selectedOptional.includes(m.id))].map(model => {
                  const state = downloadProgress[model.id] || { status: 'queued', pct: 0 };
                  const isCurrent = currentDownload === model.id;
                  const isDone = state.status === 'done';
                  const isFailed = state.status === 'failed';

                  return (
                    <div key={model.id}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                        {isFailed
                          ? <AlertCircle size={12} color="#f14c4c" />
                          : isDone
                            ? <CheckCircle2 size={12} color="#4ec994" />
                            : isCurrent
                              ? <Loader2 size={12} color="var(--vscode-accent, #007acc)" style={{ animation: 'spin 1s linear infinite' }} />
                              : <div style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid #444' }} />
                        }
                        <span style={{ fontFamily: 'monospace', fontSize: 12, color: isCurrent ? 'var(--vscode-text-active, #ddd)' : '#888', flex: 1 }}>{model.name}</span>
                        <span style={{ fontSize: 11, color: isDone ? '#4ec994' : isFailed ? '#f14c4c' : '#666' }}>
                          {isDone ? 'done' : isFailed ? 'failed' : isCurrent ? `${state.pct}%` : 'queued'}
                        </span>
                      </div>
                      <div style={{ width: '100%', height: 3, background: '#2a2a2a', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', width: `${state.pct}%`,
                          background: isDone ? '#4ec994' : isFailed ? '#f14c4c' : 'var(--vscode-accent, #007acc)',
                          transition: 'width 0.25s ease',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 16 }}>
                Download speed depends on your internet connection. Do not close this window.
              </div>
            </div>
          )}

          {/* ── SUCCESS ── */}
          {step === 'SUCCESS' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <CheckCircle2 size={16} color="#4ec994" />
                <span style={{ fontWeight: 600, color: 'var(--vscode-text-active, #ddd)', fontSize: 13 }}>Setup complete — all models ready</span>
              </div>

              <pre style={{
                fontFamily: 'monospace', fontSize: 11, lineHeight: 1.3,
                color: 'var(--vscode-accent, #007acc)',
                background: 'rgba(0,122,204,0.06)', border: '1px solid rgba(0,122,204,0.15)',
                borderRadius: 4, padding: '12px 16px', marginBottom: 20,
                overflowX: 'auto',
              }}>{`    ><(((°>    ><(((°>    ><(((°>
  Local Cortex is ready to use!`}</pre>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button style={{ ...btnPrimary, justifyContent: 'center', padding: '10px 16px', fontSize: 13 }} onClick={onComplete}>
                  <Play size={14} /> Launch Local Cortex
                </button>
                <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                  <button style={{ ...btnGhost, flex: 1, justifyContent: 'center' }}
                    onClick={() => openUrl('https://github.com/JeetInTech/Local-Cortex-your-local-chatgpt-with-built-in-editor')}>
                    <ExternalLink size={11} /> Open Source on GitHub
                  </button>
                  <button style={{ ...btnGhost, flex: 1, justifyContent: 'center' }}
                    onClick={() => openUrl('https://www.linkedin.com/in/jeet-bhatia/')}>
                    <ExternalLink size={11} /> Connect on LinkedIn
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
