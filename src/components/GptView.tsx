import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Plus, Send, Bot, Search, Trash2, MessageSquare,
  Copy, Check, Download, RotateCcw, StopCircle,
  Brain, X, Pencil, Sparkles, Bug, BookOpen, Zap, Blocks,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ModelSelector from './ModelSelector';
import CodeBlock from './CodeBlock';
import type { EditorFile } from '../App';
import { DEFAULT_SYSTEM_PROMPT } from './SettingsModal';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL_STORAGE_KEY    = 'localcortex-chat-model';
const RAG_BANNER_KEY       = 'localcortex-rag-banner-dismissed';
const RESERVE_OUTPUT_TOKENS = 2048; // always reserve this for the model's reply
const RAG_SCORE_MIN        = 0.25;
const RAG_TOP_K            = 5;

const SUGGESTED = [
  { icon: <Search size={22} strokeWidth={1.5} style={{ color: '#3b82f6' }} />, label: 'Explain codebase',    prompt: 'Explain how this codebase is structured and what the main components do.' },
  { icon: <Sparkles size={22} strokeWidth={1.5} style={{ color: '#f59e0b' }} />, label: 'Write a function',    prompt: 'Write a TypeScript function that ' },
  { icon: <Bug size={22} strokeWidth={1.5} style={{ color: '#10b981' }} />, label: 'Debug an error',      prompt: 'Help me debug this error:\n\n```\n\n```' },
  { icon: <BookOpen size={22} strokeWidth={1.5} style={{ color: '#d946ef' }} />, label: 'Explain a concept',   prompt: 'Explain the concept of ' },
  { icon: <Zap size={22} strokeWidth={1.5} style={{ color: '#eab308' }} />, label: 'Optimize code',        prompt: 'How can I optimize this code?\n\n```\n\n```' },
  { icon: <Blocks size={22} strokeWidth={1.5} style={{ color: '#ef4444' }} />, label: 'Design architecture', prompt: "What's the best architecture for " },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'ai' | 'system';
  content: string;
  // AI regen branches
  branches?: string[];
  branchIndex?: number;
  // User edit branches
  editVersions?: { userContent: string; tail: Message[] }[];
  editVersionIdx?: number;
  // RAG sources used when generating this AI message
  ragSources?: RagResult[];
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
  temperature?: number;
  clarifyMode?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function genId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function sessionTitle(msgs: Message[]) {
  const first = msgs.find(m => m.role === 'user');
  if (!first) return 'New Chat';
  return first.content.slice(0, 50) + (first.content.length > 50 ? '…' : '');
}

function estimateTokens(text: string) { return Math.round(text.length / 4); }

/**
 * Token-budget sliding window.
 * Walks backwards from the newest message, accumulating token estimates
 * until the budget (numCtx - reservedOutput - systemPromptTokens) is full.
 * This matches how real LLM apps handle context: short chats keep all
 * history, long chats drop only the oldest messages.
 */
function trimContext(
  msgs: Message[],
  numCtx: number,
  systemPromptTokens: number,
): { msgs: Message[]; trimmed: boolean } {
  const budget = Math.max(512, numCtx - RESERVE_OUTPUT_TOKENS - systemPromptTokens);
  let used = 0;
  const kept: Message[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = estimateTokens(msgs[i].content);
    // Always keep at least 1 message even if it overflows
    if (used + t > budget && kept.length > 0) break;
    kept.unshift(msgs[i]);
    used += t;
  }
  return { msgs: kept, trimmed: kept.length < msgs.length };
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

// Branch navigator shown as  < 1 of 3 >
function BranchNav({ current, total, onPrev, onNext }: { current: number; total: number; onPrev: () => void; onNext: () => void }) {
  if (total <= 1) return null;
  return (
    <div className="branch-nav">
      <button className="branch-nav-btn" onClick={onPrev} disabled={current === 0}>
        <ChevronLeft size={11} />
      </button>
      <span className="branch-nav-label">{current + 1} / {total}</span>
      <button className="branch-nav-btn" onClick={onNext} disabled={current === total - 1}>
        <ChevronRight size={11} />
      </button>
    </div>
  );
}

// Collapsible RAG sources panel — shows which files the AI read
function RagSourcesPanel({ sources }: { sources: RagResult[] }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;
  return (
    <div className="rag-sources-panel">
      <button className="rag-sources-toggle" onClick={() => setOpen(o => !o)}>
        <Brain size={11} />
        <span>Read {sources.length} file{sources.length > 1 ? 's' : ''} from workspace</span>
        <ChevronRight size={11} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && (
        <div className="rag-sources-list">
          {sources.map((r, i) => {
            const fname = r.file_path.replace(/\\/g, '/').split('/').pop();
            return (
              <div key={i} className="rag-source-item">
                <span className="rag-source-file">{fname}</span>
                <span className="rag-source-lines">lines {r.start_line}–{r.end_line}</span>
                <span className="rag-source-score">{Math.round(r.score * 100)}%</span>
              </div>
            );
          })}
        </div>
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
  numCtx = 32768,
  temperature = 0.3,
  clarifyMode = false,
}) => {
  // When clarifyMode is on, prefix the system prompt with a restate instruction
  const effectivePrompt = (systemPrompt || DEFAULT_SYSTEM_PROMPT) + (
    clarifyMode
      ? `\n\nCLARIFY MODE: Before answering any question, start with a single sentence beginning with "Understanding your question:" that restates what you understood. If you detect any mixed-up technology names or contradictory concepts in the question, flag them explicitly before continuing.`
      : ''
  );

  const [currentModel, setCurrentModel] = useState<string>(
    () => localStorage.getItem(MODEL_STORAGE_KEY) ?? ''
  );
  const [sessions, setSessions]           = useState<ChatSession[]>([]);
  const [activeId, setActiveId]           = useState<string | null>(null);
  const [input, setInput]                 = useState('');
  const [searchQuery, setSearchQuery]     = useState('');
  const [isGenerating, setIsGenerating]   = useState(false);
  const [isSearchingRag, setIsSearchingRag] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [contextTrimmed, setContextTrimmed] = useState(false);
  const [ragBannerOff, setRagBannerOff]   = useState(
    () => localStorage.getItem(RAG_BANNER_KEY) === 'true'
  );
  const [editingId, setEditingId]         = useState<string | null>(null);
  const [editDraft, setEditDraft]         = useState('');
  // #4 — ephemeral error (never goes into chat history)
  const [sendError, setSendError]         = useState<string | null>(null);
  const [retryPayload, setRetryPayload]   = useState<{ prompt: string; session: ChatSession } | null>(null);
  // #6 — file attachments
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; content: string }[]>([]);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stopRef     = useRef<(() => void) | null>(null);

  // ── model auto-detect ────────────────────────────────────────────────────
  useEffect(() => {
    invoke<{ id: string }[]>('list_models').then(models => {
      if (!models.length) return;
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      if (!saved || !models.some(m => m.id === saved)) {
        // Prefer the ultimate coding model if installed, otherwise grab the first available
        const defaultModel = models.find(m => m.id.startsWith('qwen2.5-coder:7b'))?.id || models[0].id;
        setCurrentModel(defaultModel);
        localStorage.setItem(MODEL_STORAGE_KEY, defaultModel);
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
  const buildRagContext = useCallback(async (query: string): Promise<{ context: string; sources: RagResult[] }> => {
    if (!ragEnabled) return { context: '', sources: [] };
    const ws = getWorkspace();
    if (!ws) return { context: '', sources: [] };
    try {
      const results = await invoke<RagResult[]>('rag_search', {
        query, k: RAG_TOP_K, activeFile: null, recentFiles: [],
      });
      const good = results.filter(r => r.score >= RAG_SCORE_MIN);
      if (!good.length) return { context: '', sources: [] };
      const snippets = good.map(r => {
        const fname = r.file_path.replace(/\\/g, '/').split('/').pop();
        return `### ${fname} (lines ${r.start_line}–${r.end_line})\n\`\`\`\n${r.content.slice(0, 600)}\n\`\`\``;
      }).join('\n\n');
      const context = `[WORKSPACE CONTEXT]\n${snippets}\n[END WORKSPACE CONTEXT]\n\n`;
      return { context, sources: good };
    } catch { return { context: '', sources: [] }; }
  }, [ragEnabled]);

  // ── core send ────────────────────────────────────────────────────────────
  const doSend = useCallback(async (prompt: string, baseSession: ChatSession) => {
    const clean = prompt.trim();
    if (!clean || isGenerating) return;

    // 1. RAG search
    setIsSearchingRag(true);
    const { context: ragCtx, sources: ragSources } = await buildRagContext(clean);
    setIsSearchingRag(false);

    // 2. System prompt stays FIXED (Ollama can cache it across turns).
    //    RAG context goes as a prefix on the current user message instead.
    const fullSystem = effectivePrompt;
    const userContentWithRag = ragCtx ? `${ragCtx}User question: ${clean}` : clean;

    // 3. Build the new session state
    const userMsg: Message = { id: genId(), role: 'user', content: clean };
    const aiMsg:  Message  = { id: genId(), role: 'ai', content: '', ragSources: ragSources.length ? ragSources : undefined };
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

    // 5. Token-budget trim — system prompt is now fixed so tokens are stable
    const systemTokens = estimateTokens(fullSystem);
    const prevTrimResult = trimContext(
      baseSession.messages.filter(m => m.role !== 'system'),
      numCtx,
      systemTokens,
    );
    setContextTrimmed(prevTrimResult.trimmed);
    const apiMessages = prevTrimResult.msgs
      .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }))
      .filter(m => m.content.trim());
    // Current user message carries the RAG prefix
    apiMessages.push({ role: 'user', content: userContentWithRag });

    try {
      await invoke('generate_response', {
        streamId: sid,
        model: currentModel,
        messages: apiMessages,
        systemPrompt: fullSystem,
        numCtx,
        temperature,
      });
    } catch (err) {
      // #4 — Remove the empty AI placeholder, surface an ephemeral toast, allow retry
      setIsGenerating(false); setStreamingText('');
      setSessions(prev => {
        const u = prev.map(s => {
          if (s.id !== newSession.id) return s;
          // Strip the empty AI message slot — don't pollute history with error text
          return { ...s, messages: s.messages.filter(m => m.id !== aiId) };
        });
        saveSessions(u); return u;
      });
      const msg = err instanceof Error ? err.message : String(err);
      setSendError(`Failed to connect to Ollama: ${msg}`);
      setRetryPayload({ prompt: clean, session: newSession });
    }
  }, [isGenerating, buildRagContext, effectivePrompt, currentModel, numCtx, saveSessions]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isGenerating) return;
    setSendError(null);
    // #6 — prepend any attached file contents to the prompt
    let fullPrompt = input;
    if (attachedFiles.length > 0) {
      const fileCtx = attachedFiles.map(f => `[Attached: ${f.name}]\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
      fullPrompt = `${fileCtx}\n\n${input}`;
      setAttachedFiles([]);
    }
    const base = activeSession ?? { id: genId(), title: 'New Chat', created_at: Date.now(), messages: [] };
    await doSend(fullPrompt, base);
  }, [input, isGenerating, activeSession, doSend, attachedFiles]);

  // ── regenerate (non-destructive) ─────────────────────────────────────────
  const handleRegenerate = useCallback(async () => {
    if (!activeSession || isGenerating) return;
    const msgs = activeSession.messages;
    const lastUser = [...msgs].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    let lastAiIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'ai') { lastAiIdx = i; break; }
    }
    if (lastAiIdx < 0) return;
    const oldAiMsg = msgs[lastAiIdx];
    // Save current content into branches array
    const existingBranches = oldAiMsg.branches ?? [oldAiMsg.content];
    const newBranches = [...existingBranches, ''];
    const newBranchIndex = newBranches.length - 1;
    // Patch the AI message slot in-place — keep all messages after it too
    const patchedMsgs = msgs.map((m, i) =>
      i === lastAiIdx
        ? { ...m, content: '', branches: newBranches, branchIndex: newBranchIndex }
        : m
    );
    const patchedSession = { ...activeSession, messages: patchedMsgs };
    setSessions(prev => {
      const u = prev.map(s => s.id === patchedSession.id ? patchedSession : s);
      saveSessions(u); return u;
    });
    // Now send, targeting the existing AI message id
    const aiMsgId = oldAiMsg.id;
    const baseMessages = patchedMsgs.slice(0, lastAiIdx).filter(m => m.role !== 'system');
    // Build trimmed API context
    const { context: ragCtx } = await buildRagContext(lastUser.content);
    const fullSystem = effectivePrompt; // fixed — no RAG in system prompt
    const userContentWithRag = ragCtx ? `${ragCtx}User question: ${lastUser.content}` : lastUser.content;
    const systemTokens = estimateTokens(fullSystem);
    const { msgs: trimmedCtx, trimmed } = trimContext(baseMessages, numCtx, systemTokens);
    setContextTrimmed(trimmed);
    const apiMessages = trimmedCtx
      .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }))
      .filter(m => m.content.trim());
    apiMessages.push({ role: 'user', content: userContentWithRag });
    setIsGenerating(true);
    setStreamingText('');
    const sid = genId();
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
          if (s.id !== activeSession.id) return s;
          return {
            ...s, messages: s.messages.map(m => {
              if (m.id !== aiMsgId) return m;
              const updatedBranches = [...(m.branches ?? [m.content])];
              updatedBranches[m.branchIndex ?? updatedBranches.length - 1] = finalContent;
              return { ...m, content: finalContent, branches: updatedBranches };
            })
          };
        });
        saveSessions(u); return u;
      });
      unlisten1(); unlisten2(); stopRef.current = null;
    });
    stopRef.current = () => { unlisten1(); unlisten2(); setIsGenerating(false); setStreamingText(''); };
    try {
      await invoke('generate_response', { streamId: sid, model: currentModel, messages: apiMessages, systemPrompt: fullSystem, numCtx });
    } catch (err) {
      setIsGenerating(false); setStreamingText('');
      setSessions(prev => {
        const u = prev.map(s => {
          if (s.id !== activeSession.id) return s;
          return { ...s, messages: s.messages.map(m => m.id === aiMsgId ? { ...m, content: `**Error:** ${err}` } : m) };
        });
        saveSessions(u); return u;
      });
    }
  }, [activeSession, isGenerating, effectivePrompt, buildRagContext, currentModel, numCtx, saveSessions]);

  // ── switch AI branch (< >) ───────────────────────────────────────────────
  const handleAiBranchSwitch = useCallback((msgId: string, dir: -1 | 1) => {
    setSessions(prev => {
      const u = prev.map(s => {
        if (s.id !== activeId) return s;
        return {
          ...s, messages: s.messages.map(m => {
            if (m.id !== msgId || !m.branches) return m;
            const next = Math.max(0, Math.min(m.branches.length - 1, (m.branchIndex ?? m.branches.length - 1) + dir));
            return { ...m, branchIndex: next, content: m.branches[next] };
          })
        };
      });
      saveSessions(u); return u;
    });
  }, [activeId, saveSessions]);

  // ── edit + resend (non-destructive) ──────────────────────────────────────
  const handleEditSubmit = useCallback(async (msgId: string) => {
    if (!activeSession) return;
    const idx = activeSession.messages.findIndex(m => m.id === msgId);
    if (idx < 0) return;
    const oldUserMsg = activeSession.messages[idx];
    const tail = activeSession.messages.slice(idx + 1);
    // Save the old version into editVersions
    const existingVersions = oldUserMsg.editVersions ?? [{ userContent: oldUserMsg.content, tail }];
    const newVersions = [...existingVersions, { userContent: editDraft, tail: [] }];
    const newVersionIdx = newVersions.length - 1;
    const baseMessages = activeSession.messages.slice(0, idx);
    // Patch user message with new content + version history, strip old tail
    const patchedUserMsg: Message = { ...oldUserMsg, content: editDraft, editVersions: newVersions, editVersionIdx: newVersionIdx };
    const patchedSession = { ...activeSession, messages: [...baseMessages, patchedUserMsg] };
    setSessions(prev => {
      const u = prev.map(s => s.id === patchedSession.id ? patchedSession : s);
      saveSessions(u); return u;
    });
    setEditingId(null);
    await doSend(editDraft, patchedSession);
  }, [activeSession, editDraft, doSend, saveSessions]);

  // ── switch edit branch (< >) ─────────────────────────────────────────────
  const handleEditBranchSwitch = useCallback((msgId: string, dir: -1 | 1) => {
    setSessions(prev => {
      const u = prev.map(s => {
        if (s.id !== activeId) return s;
        const msgIdx = s.messages.findIndex(m => m.id === msgId);
        if (msgIdx < 0) return s;
        const msg = s.messages[msgIdx];
        if (!msg.editVersions) return s;
        const next = Math.max(0, Math.min(msg.editVersions.length - 1, (msg.editVersionIdx ?? msg.editVersions.length - 1) + dir));
        const version = msg.editVersions[next];
        const newMsg = { ...msg, content: version.userContent, editVersionIdx: next };
        const newMessages = [
          ...s.messages.slice(0, msgIdx),
          newMsg,
          ...version.tail,
        ];
        return { ...s, messages: newMessages };
      });
      saveSessions(u); return u;
    });
  }, [activeId, saveSessions]);

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

        {/* #4 — Ephemeral error toast (not stored in history) */}
        {sendError && (
          <div className="gpt-error-toast">
            <span>⚠ {sendError}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="gpt-error-retry" onClick={async () => {
                if (!retryPayload) return;
                setSendError(null);
                await doSend(retryPayload.prompt, retryPayload.session);
              }}>Retry</button>
              <button className="gpt-error-dismiss" onClick={() => setSendError(null)}>✕</button>
            </div>
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
                const editTotal = msg.editVersions?.length ?? 1;
                const editCurrent = msg.editVersionIdx ?? (editTotal - 1);
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
                    <BranchNav
                      current={editCurrent}
                      total={editTotal}
                      onPrev={() => handleEditBranchSwitch(msg.id, -1)}
                      onNext={() => handleEditBranchSwitch(msg.id, 1)}
                    />
                  </div>
                );
              }

              const aiBranches = msg.branches;
              const aiBranchIndex = msg.branchIndex ?? (aiBranches ? aiBranches.length - 1 : 0);
              const aiBranchTotal = aiBranches ? aiBranches.length : 1;

              return (
                <div key={msg.id} className="gpt-message ai">
                  <div className="gpt-avatar ai"><Bot size={16} /></div>
                  <div className="gpt-ai-body">
                    {liveContent === '' && isGenerating ? (
                      <span className="gpt-thinking">thinking<span className="gpt-dots" /></span>
                    ) : (
                      <div className="gpt-message-content" style={{ fontSize }}>
                        {/* #5 — During streaming: plain text (O(1) render, no parsing).
                            After streaming: full ReactMarkdown with syntax highlighting. */}
                        {showCursor ? (
                          <>
                            <span style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{liveContent}</span>
                            <span className="gpt-stream-cursor">█</span>
                          </>
                        ) : (
                          <ReactMarkdown
                            components={{
                              code({ inline, className, children, ...props }: any) {
                                const lang = /language-(\w+)/.exec(className || '')?.[1];
                                const code = String(children).replace(/\n$/, '');
                                if (!inline && lang) return <CodeBlock code={code} language={lang} onSendToEditor={handleSendToEditor} />;
                                return <code style={{ background: 'var(--vscode-input)', padding: '1px 5px', borderRadius: 3, fontFamily: "'Cascadia Code', monospace", fontSize: '0.9em' }} {...props}>{children}</code>;
                              },
                            }}
                          >
                            {liveContent}
                          </ReactMarkdown>
                        )}
                      </div>
                    )}
                    {!isGenerating && msg.content && (
                      <AiActions content={msg.content} onSend={handleSendToEditor} />
                    )}
                    {msg.ragSources && msg.ragSources.length > 0 && (
                      <RagSourcesPanel sources={msg.ragSources} />
                    )}
                    <div className="gpt-ai-footer">
                      <BranchNav
                        current={aiBranchIndex}
                        total={aiBranchTotal}
                        onPrev={() => handleAiBranchSwitch(msg.id, -1)}
                        onNext={() => handleAiBranchSwitch(msg.id, 1)}
                      />
                      {isLastAi && !isGenerating && msg.content && (
                        <button className="gpt-regen-btn" onClick={handleRegenerate} title="Regenerate">
                          <RotateCcw size={12} /> Regenerate
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="gpt-input-container">
          {/* #6 — Attachment chips */}
          {attachedFiles.length > 0 && (
            <div className="gpt-attachments">
              {attachedFiles.map((f, i) => (
                <div key={i} className="gpt-attachment-chip">
                  <span>{f.name}</span>
                  <button onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleSubmit} className="gpt-input-wrapper"
            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
            onDragLeave={e => e.currentTarget.classList.remove('drag-over')}
            onDrop={async e => {
              e.preventDefault();
              e.currentTarget.classList.remove('drag-over');
              const files = Array.from(e.dataTransfer.files);
              const read = await Promise.all(files.map(async f => {
                if (f.type.startsWith('image/')) return { name: f.name, content: `[Image: ${f.name}]` };
                try { return { name: f.name, content: await f.text() }; } catch { return null; }
              }));
              setAttachedFiles(prev => [...prev, ...read.filter(Boolean) as { name: string; content: string }[]]);
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
              onPaste={async e => {
                // #6 — paste image from clipboard
                const items = Array.from(e.clipboardData.items);
                const imgItem = items.find(it => it.type.startsWith('image/'));
                if (imgItem) {
                  e.preventDefault();
                  const file = imgItem.getAsFile();
                  if (file) setAttachedFiles(prev => [...prev, { name: file.name || 'pasted-image.png', content: `[Pasted image: ${file.name || 'image'}]` }]);
                }
                // text files pasted via file manager
                const fileItem = items.find(it => it.kind === 'file' && it.type === 'text/plain');
                if (fileItem && !imgItem) {
                  const file = fileItem.getAsFile();
                  if (file) { const text = await file.text(); setAttachedFiles(prev => [...prev, { name: file.name, content: text }]); e.preventDefault(); }
                }
              }}
              placeholder={`Message ${currentModel || 'Local Cortex'}… (Shift+Enter for newline, drag files here)`}
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
              <button type="submit" className="gpt-send-btn" disabled={!input.trim() && attachedFiles.length === 0}>
                <Send size={14} />
              </button>
            )}
          </form>
          <div className="gpt-input-footer">
            <span>Enter to send · Shift+Enter for newline · Drag & drop files</span>
            {input && <span className="gpt-token-hint">~{inputTokens} tokens</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GptView;
