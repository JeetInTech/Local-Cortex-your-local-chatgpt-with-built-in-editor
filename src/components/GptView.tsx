import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Plus, Send, Bot, Search, Trash2, MessageSquare,
  Copy, Check, Download, RotateCcw, StopCircle,
  Brain, X, Pencil, Sparkles,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ModelSelector from './ModelSelector';
import CodeBlock from './CodeBlock';
import type { EditorFile } from '../App';
import { DEFAULT_SYSTEM_PROMPT } from './SettingsModal';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL_STORAGE_KEY = 'localcortex-chat-model';
const RAG_BANNER_KEY    = 'localcortex-rag-banner-dismissed';
const MAX_CTX_MESSAGES  = 20;
const RAG_SCORE_MIN     = 0.25;
const RAG_TOP_K         = 5;

const SUGGESTED = [
  { icon: '🔍', label: 'Explain codebase',    prompt: 'Explain how this codebase is structured and what the main components do.' },
  { icon: '✨', label: 'Write a function',    prompt: 'Write a TypeScript function that ' },
  { icon: '🐛', label: 'Debug an error',      prompt: 'Help me debug this error:\n\n```\n\n```' },
  { icon: '📚', label: 'Explain a concept',   prompt: 'Explain the concept of ' },
  { icon: '⚡', label: 'Optimize code',        prompt: 'How can I optimize this code?\n\n```\n\n```' },
  { icon: '🏗️', label: 'Design architecture', prompt: "What's the best architecture for " },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'ai' | 'system';
  content: string;
}

interface ChatSession {
  id: string;
  title: string;
  created_at: number;
  messages: Message[];
}

interface RagResult {
  file_path: string;
  content: string;
  start_line: number;
  end_line: number;
  score: number;
}

interface GptViewProps {
  fontSize: number;
  onSendToEditor?: (file: EditorFile) => void;
  systemPrompt?: string;
  ragEnabled?: boolean;
  numCtx?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function genId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function sessionTitle(msgs: Message[]) {
  const first = msgs.find(m => m.role === 'user');
  if (!first) return 'New Chat';
  return first.content.slice(0, 50) + (first.content.length > 50 ? '…' : '');
}

function estimateTokens(text: string) { return Math.round(text.length / 4); }

function trimContext(msgs: Message[]): { msgs: Message[]; trimmed: boolean } {
  if (msgs.length <= MAX_CTX_MESSAGES) return { msgs, trimmed: false };
  return { msgs: msgs.slice(msgs.length - MAX_CTX_MESSAGES), trimmed: true };
}

function getWorkspace() { return localStorage.getItem('localcortex-cwd') || ''; }

// ─── Sub-components ──────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="gpt-action-btn" title="Copy" onClick={async () => {
      await navigator.clipboard.writeText(text);
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    }}>
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function AiActions({ content, onSend }: { content: string; onSend?: (n: string, c: string, l: string) => void }) {
  return (
    <div className="gpt-ai-actions">
      <CopyBtn text={content} />
      <button className="gpt-action-btn" title="Download" onClick={() => {
        const blob = new Blob([content], { type: 'text/markdown' });
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'response.md' });
        a.click(); URL.revokeObjectURL(a.href);
      }}><Download size={12} /> Download</button>
      {onSend && (
        <button className="gpt-action-btn" title="Open in Editor" onClick={() => onSend('response.md', content, 'markdown')}>
          <Sparkles size={12} /> Open in Editor
        </button>
      )}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

const GptView: React.FC<GptViewProps> = ({
  fontSize,
  onSendToEditor,
  systemPrompt,
  ragEnabled = true,
  numCtx = 8192,
}) => {
  const effectivePrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;

  const [currentModel, setCurrentModel] = useState<string>(
    () => localStorage.getItem(MODEL_STORAGE_KEY) ?? ''
  );
  const [sessions, setSessions]           = useState<ChatSession[]>([]);
  const [activeId, setActiveId]           = useState<string | null>(null);
  const [input, setInput]                 = useState('');
  const [searchQuery, setSearchQuery]     = useState('');
  const [isGenerating, setIsGenerating]   = useState(false);
  const [isSearchingRag, setIsSearchingRag] = useState(false);
  const [streamingText, setStreamingText] = useState('');   // live buffer
  const [contextTrimmed, setContextTrimmed] = useState(false);
  const [ragBannerOff, setRagBannerOff]   = useState(
    () => localStorage.getItem(RAG_BANNER_KEY) === 'true'
  );
  const [editingId, setEditingId]         = useState<string | null>(null);
  const [editDraft, setEditDraft]         = useState('');

  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stopRef     = useRef<(() => void) | null>(null);

  // ── model auto-detect ────────────────────────────────────────────────────
  useEffect(() => {
    invoke<{ id: string }[]>('list_models').then(models => {
      if (!models.length) return;
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      if (!saved || !models.some(m => m.id === saved)) {
        setCurrentModel(models[0].id);
        localStorage.setItem(MODEL_STORAGE_KEY, models[0].id);
      }
    }).catch(() => {});
  }, []);

  // ── load history ─────────────────────────────────────────────────────────
  useEffect(() => {
    invoke<ChatSession[]>('load_chat_history').then(loaded => {
      if (loaded.length) { setSessions(loaded); setActiveId(loaded[0].id); }
    }).catch(() => {});
  }, []);

  // ── scroll to bottom ─────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, streamingText]);

  const activeSession = sessions.find(s => s.id === activeId) ?? null;
  const messages: Message[] = activeSession?.messages ?? [];

  const saveSessions = useCallback((updated: ChatSession[]) => {
    invoke('save_chat_history', { sessions: updated }).catch(console.error);
  }, []);

  const handleModelSelect = useCallback((m: string) => {
    setCurrentModel(m); localStorage.setItem(MODEL_STORAGE_KEY, m);
  }, []);

  // ── new chat ─────────────────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    const s: ChatSession = { id: genId(), title: 'New Chat', created_at: Date.now(), messages: [] };
    setSessions(prev => { const u = [s, ...prev]; saveSessions(u); return u; });
    setActiveId(s.id); setInput(''); setStreamingText('');
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [saveSessions]);

  const handleDeleteSession = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions(prev => {
      const u = prev.filter(s => s.id !== id); saveSessions(u);
      if (activeId === id) setActiveId(u[0]?.id ?? null);
      return u;
    });
  }, [activeId, saveSessions]);

  // ── RAG context builder ──────────────────────────────────────────────────
  const buildRagContext = useCallback(async (query: string): Promise<string> => {
    if (!ragEnabled) return '';
    const ws = getWorkspace();
    if (!ws) return '';
    try {
      const results = await invoke<RagResult[]>('rag_search', {
        query, k: RAG_TOP_K, activeFile: null, recentFiles: [],
      });
      const good = results.filter(r => r.score >= RAG_SCORE_MIN);
      if (!good.length) return '';
      const snippets = good.map(r => {
        const fname = r.file_path.replace(/\\/g, '/').split('/').pop();
        return `### ${fname} (lines ${r.start_line}–${r.end_line})\n\`\`\`\n${r.content.slice(0, 600)}\n\`\`\``;
      }).join('\n\n');
      return `\n\n[WORKSPACE CONTEXT]\n${snippets}\n[END WORKSPACE CONTEXT]`;
    } catch { return ''; }
  }, [ragEnabled]);

  // ── core send ────────────────────────────────────────────────────────────
  const doSend = useCallback(async (prompt: string, baseSession: ChatSession) => {
    const clean = prompt.trim();
    if (!clean || isGenerating) return;

    // 1. RAG search
    setIsSearchingRag(true);
    const ragCtx = await buildRagContext(clean);
    setIsSearchingRag(false);

    // 2. Build system prompt
    const fullSystem = effectivePrompt + ragCtx;

    // 3. Build the new session state (trim for UI display)
    const userMsg: Message = { id: genId(), role: 'user', content: clean };
    const aiMsg:  Message  = { id: genId(), role: 'ai',   content: '' };
    const uiMsgs = [...baseSession.messages, userMsg];
    const newSession: ChatSession = {
      ...baseSession,
      title: baseSession.messages.length === 0 ? sessionTitle([userMsg]) : baseSession.title,
      messages: [...uiMsgs, aiMsg],
    };

    setSessions(prev => {
      const u = prev.map(s => s.id === newSession.id ? newSession : s);
      const final = prev.find(s => s.id === newSession.id) ? u : [newSession, ...u];
      saveSessions(final); return final;
    });
    setActiveId(newSession.id);
    setInput('');
    setIsGenerating(true);
    setStreamingText('');

    // 4. Stream
    const sid = genId();
    const aiId = aiMsg.id;
    let buffer = '';

    const unlisten1 = await listen<string>(`chat-stream-${sid}`, ev => {
      buffer += ev.payload;
      setStreamingText(buffer);
    });
    const unlisten2 = await listen(`chat-stream-done-${sid}`, () => {
      setIsGenerating(false); setStreamingText('');
      const finalContent = buffer;
      setSessions(prev => {
        const u = prev.map(s => {
          if (s.id !== newSession.id) return s;
          return { ...s, messages: s.messages.map(m => m.id === aiId ? { ...m, content: finalContent } : m) };
        });
        saveSessions(u); return u;
      });
      unlisten1(); unlisten2(); stopRef.current = null;
    });

    stopRef.current = () => { unlisten1(); unlisten2(); setIsGenerating(false); setStreamingText(''); };

    // Build api messages: previous context (trimmed) + current user message
    const prevTrimResult = trimContext(baseSession.messages);
    setContextTrimmed(prevTrimResult.trimmed);
    const apiMessages = prevTrimResult.msgs
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }))
      .filter(m => m.content.trim());
    apiMessages.push({ role: 'user', content: clean });

    try {
      await invoke('generate_response', {
        streamId: sid,
        model: currentModel,
        messages: apiMessages,
        systemPrompt: fullSystem,
        numCtx,
      });
    } catch (err) {
      setIsGenerating(false); setStreamingText('');
      const errMsg = `**Error:** Failed to connect to Ollama.\n\n\`${err}\``;
      setSessions(prev => {
        const u = prev.map(s => {
          if (s.id !== newSession.id) return s;
          return { ...s, messages: s.messages.map(m => m.id === aiId ? { ...m, content: errMsg } : m) };
        });
        saveSessions(u); return u;
      });
    }
  }, [isGenerating, buildRagContext, effectivePrompt, currentModel, numCtx, saveSessions]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isGenerating) return;
    const base = activeSession ?? { id: genId(), title: 'New Chat', created_at: Date.now(), messages: [] };
    await doSend(input, base);
  }, [input, isGenerating, activeSession, doSend]);

  // ── regenerate ───────────────────────────────────────────────────────────
  const handleRegenerate = useCallback(async () => {
    if (!activeSession || isGenerating) return;
    const msgs = activeSession.messages;
    const lastUser = [...msgs].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    // Find the index of the last AI message and trim from there
    let lastAiIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'ai') { lastAiIdx = i; break; }
    }
    const trimmed = lastAiIdx >= 0 ? msgs.slice(0, lastAiIdx) : msgs;
    const baseSession = { ...activeSession, messages: trimmed };
    await doSend(lastUser.content, baseSession);
  }, [activeSession, isGenerating, doSend]);

  // ── edit + resend ────────────────────────────────────────────────────────
  const handleEditSubmit = useCallback(async (msgId: string) => {
    if (!activeSession) return;
    const idx = activeSession.messages.findIndex(m => m.id === msgId);
    if (idx < 0) return;
    const trimmed = activeSession.messages.slice(0, idx);
    const baseSession = { ...activeSession, messages: trimmed };
    setEditingId(null);
    await doSend(editDraft, baseSession);
  }, [activeSession, editDraft, doSend]);

  const handleStop = useCallback(() => { stopRef.current?.(); }, []);

  const handleSendToEditor = useCallback((name: string, content: string, lang: string) => {
    onSendToEditor?.({ name, content, language: lang });
  }, [onSendToEditor]);

  const dismissRagBanner = () => {
    setRagBannerOff(true); localStorage.setItem(RAG_BANNER_KEY, 'true');
  };

  const filtered = sessions.filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase()));
  const inputTokens = estimateTokens(input);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="gpt-mode" style={{ fontSize: `${fontSize}px` }}>

      {/* ── Sidebar ── */}
      <div className="gpt-sidebar">
        <button className="gpt-new-chat-btn" onClick={handleNewChat}>
          <Plus size={15} /> New chat
        </button>
        <div className="gpt-search">
          <Search size={13} color="var(--gpt-text-muted)" />
          <input placeholder="Search chats…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        <div className="gpt-history-list">
          {filtered.length === 0 && (
            <div className="gpt-empty-hint">{searchQuery ? 'No results' : 'No chats yet'}</div>
          )}
          {filtered.map(s => (
            <div
              key={s.id}
              className={`gpt-history-item ${s.id === activeId ? 'active' : ''}`}
              onClick={() => { setActiveId(s.id); setStreamingText(''); }}
            >
              <MessageSquare size={11} style={{ opacity: 0.45, flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
              <button className="delete-session-btn" onClick={e => handleDeleteSession(s.id, e)} title="Delete">
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main ── */}
      <div className="gpt-main-chat">

        {/* Header */}
        <div className="chat-header-bar">
          <ModelSelector currentModel={currentModel} onSelect={handleModelSelect} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isSearchingRag && (
              <span className="gpt-rag-searching">
                <Brain size={12} className="spin" /> Searching workspace…
              </span>
            )}
            {isGenerating && !isSearchingRag && (
              <span className="gpt-generating-label">
                <span className="gpt-dot-pulse" /> Generating…
              </span>
            )}
          </div>
        </div>

        {/* Context trimmed banner */}
        {contextTrimmed && (
          <div className="gpt-trim-banner">
            Older messages trimmed to fit context window
          </div>
        )}

        {/* RAG index hint */}
        {!ragBannerOff && ragEnabled && !getWorkspace() && (
          <div className="gpt-rag-banner">
            <Brain size={13} />
            <span>Tip: Open a folder in the Editor and index it to give the AI knowledge of your codebase.</span>
            <button onClick={dismissRagBanner}><X size={12} /></button>
          </div>
        )}

        {/* Messages */}
        <div className="gpt-chat-messages">
          {messages.length === 0 ? (
            <div className="gpt-empty-state">
              <div className="gpt-empty-icon"><Bot size={40} strokeWidth={1.2} /></div>
              <div className="gpt-empty-title">Local Cortex</div>
              <div className="gpt-empty-sub">Your offline AI. Runs on your hardware, never leaves your machine.</div>
              <div className="gpt-suggested-grid">
                {SUGGESTED.map(s => (
                  <button key={s.label} className="gpt-suggested-card"
                    onClick={() => { setInput(s.prompt); requestAnimationFrame(() => textareaRef.current?.focus()); }}>
                    <span className="gpt-suggested-icon">{s.icon}</span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isLastAi = msg.role === 'ai' && idx === messages.length - 1;
              const liveContent = isLastAi && isGenerating ? streamingText : msg.content;
              const showCursor  = isLastAi && isGenerating;

              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="gpt-message user">
                    <div className="gpt-user-bubble">
                      {editingId === msg.id ? (
                        <div className="gpt-edit-wrap">
                          <textarea
                            className="gpt-edit-textarea"
                            value={editDraft}
                            onChange={e => setEditDraft(e.target.value)}
                            rows={3}
                            autoFocus
                          />
                          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                            <button className="gpt-edit-send" onClick={() => handleEditSubmit(msg.id)}>Send</button>
                            <button className="gpt-edit-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                          <button className="gpt-edit-btn" title="Edit message"
                            onClick={() => { setEditingId(msg.id); setEditDraft(msg.content); }}>
                            <Pencil size={11} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.id} className="gpt-message ai">
                  <div className="gpt-avatar ai"><Bot size={16} /></div>
                  <div className="gpt-ai-body">
                    {liveContent === '' && isGenerating ? (
                      <span className="gpt-thinking">thinking<span className="gpt-dots" /></span>
                    ) : (
                      <div className="gpt-message-content" style={{ fontSize }}>
                        <ReactMarkdown
                          components={{
                            code({ inline, className, children, ...props }: any) {
                              const lang = /language-(\w+)/.exec(className || '')?.[1];
                              const code = String(children).replace(/\n$/, '');
                              if (!inline && lang) return <CodeBlock code={code} language={lang} onSendToEditor={handleSendToEditor} />;
                              return <code style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: 3, fontFamily: "'Cascadia Code', monospace", fontSize: '0.9em' }} {...props}>{children}</code>;
                            },
                          }}
                        >
                          {liveContent}
                        </ReactMarkdown>
                        {showCursor && <span className="gpt-stream-cursor">█</span>}
                      </div>
                    )}
                    {!isGenerating && msg.content && (
                      <AiActions content={msg.content} onSend={handleSendToEditor} />
                    )}
                    {isLastAi && !isGenerating && msg.content && (
                      <button className="gpt-regen-btn" onClick={handleRegenerate} title="Regenerate">
                        <RotateCcw size={12} /> Regenerate
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="gpt-input-container">
          <form onSubmit={handleSubmit} className="gpt-input-wrapper">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
              placeholder={`Message ${currentModel || 'Local Cortex'}… (Shift+Enter for newline)`}
              className="gpt-input"
              rows={1}
              disabled={isGenerating}
              style={{ height: Math.min(input.split('\n').length * 24 + 8, 180) + 'px', fontSize }}
            />
            {isGenerating ? (
              <button type="button" className="gpt-stop-btn" onClick={handleStop} title="Stop">
                <StopCircle size={16} />
              </button>
            ) : (
              <button type="submit" className="gpt-send-btn" disabled={!input.trim()}>
                <Send size={14} />
              </button>
            )}
          </form>
          <div className="gpt-input-footer">
            <span>Enter to send · Shift+Enter for newline</span>
            {input && <span className="gpt-token-hint">~{inputTokens} tokens</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GptView;
