import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, Send, Bot, User, Search, Trash2, MessageSquare } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ModelSelector from './ModelSelector';

// ─── Types ───────────────────────────────────────────────────────────────────

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

interface GptViewProps {
  fontSize: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sessionTitle(messages: Message[]): string {
  const first = messages.find(m => m.role === 'user');
  if (!first) return 'New Chat';
  return first.content.slice(0, 48) + (first.content.length > 48 ? '…' : '');
}

const WELCOME_MSG: Message = {
  id: 'welcome',
  role: 'ai',
  content: 'Hello! I\'m your **Local Cortex** research assistant. Ask me anything — I run fully offline on your local hardware.',
};

// ─── Component ───────────────────────────────────────────────────────────────

const GptView: React.FC<GptViewProps> = ({ fontSize }) => {
  const [currentModel, setCurrentModel] = useState('llama3.2:latest');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Derived: active session messages ──────────────────────────────────────

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null;
  const messages: Message[] = activeSession?.messages ?? [WELCOME_MSG];

  // ── Persistence: load on mount ────────────────────────────────────────────

  useEffect(() => {
    invoke<ChatSession[]>('load_chat_history')
      .then(loaded => {
        if (loaded.length > 0) {
          setSessions(loaded);
          setActiveSessionId(loaded[0].id);
        }
      })
      .catch(() => {/* first run, no history */});
  }, []);

  // ── Persistence: save on change ───────────────────────────────────────────

  const saveSessions = useCallback((updated: ChatSession[]) => {
    invoke('save_chat_history', { sessions: updated }).catch(console.error);
  }, []);

  // ── Auto scroll ───────────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── New Chat ──────────────────────────────────────────────────────────────

  const handleNewChat = () => {
    const newSession: ChatSession = {
      id: generateId(),
      title: 'New Chat',
      created_at: Date.now(),
      messages: [],
    };
    const updated = [newSession, ...sessions];
    setSessions(updated);
    setActiveSessionId(newSession.id);
    saveSessions(updated);
  };

  // ── Delete session ────────────────────────────────────────────────────────

  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = sessions.filter(s => s.id !== id);
    setSessions(updated);
    saveSessions(updated);
    if (activeSessionId === id) {
      setActiveSessionId(updated[0]?.id ?? null);
    }
  };

  // ── Send Message ──────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isGenerating) return;

    const userMsg: Message = { id: generateId(), role: 'user', content: input };

    // Create or update session
    let targetSession: ChatSession;
    let allSessions: ChatSession[];

    if (!activeSession) {
      targetSession = {
        id: generateId(),
        title: sessionTitle([userMsg]),
        created_at: Date.now(),
        messages: [userMsg],
      };
      allSessions = [targetSession, ...sessions];
    } else {
      targetSession = {
        ...activeSession,
        title: activeSession.messages.length === 0 ? sessionTitle([userMsg]) : activeSession.title,
        messages: [...activeSession.messages, userMsg],
      };
      allSessions = sessions.map(s => s.id === targetSession.id ? targetSession : s);
    }

    // Add empty AI placeholder
    const aiPlaceholder: Message = { id: generateId(), role: 'ai', content: '' };
    const withAi: ChatSession = { ...targetSession, messages: [...targetSession.messages, aiPlaceholder] };
    const withAiAll = allSessions.map(s => s.id === withAi.id ? withAi : s);

    setSessions(withAiAll);
    setActiveSessionId(withAi.id);
    setInput('');
    setIsGenerating(true);

    const streamId = generateId();
    const aiMsgId = aiPlaceholder.id;

    // Per-request isolated listener
    const unlistenStream = await listen<string>(`chat-stream-${streamId}`, (event) => {
      setSessions(prev => prev.map(s => {
        if (s.id !== withAi.id) return s;
        const lastIdx = s.messages.findIndex(m => m.id === aiMsgId);
        if (lastIdx < 0) return s;
        const updated = [...s.messages];
        updated[lastIdx] = { ...updated[lastIdx], content: updated[lastIdx].content + event.payload };
        return { ...s, messages: updated };
      }));
    });

    const unlistenDone = await listen(`chat-stream-done-${streamId}`, () => {
      setIsGenerating(false);
      unlistenStream();
      unlistenDone();
      // Save after stream completes
      setSessions(prev => { saveSessions(prev); return prev; });
    });

    const apiMessages = withAi.messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content }))
      .filter(m => m.content.trim() !== '');

    try {
      await invoke('generate_response', { streamId, model: currentModel, messages: apiMessages });
    } catch (error) {
      setIsGenerating(false);
      unlistenStream();
      unlistenDone();
      setSessions(prev => prev.map(s => {
        if (s.id !== withAi.id) return s;
        const idx = s.messages.findIndex(m => m.id === aiMsgId);
        if (idx < 0) return s;
        const updated = [...s.messages];
        updated[idx] = { ...updated[idx], content: `**Error:** Failed to connect to Ollama.\n\nMake sure Ollama is running, then try again.\n\n\`${error}\`` };
        return { ...s, messages: updated };
      }));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // ── Filtered history ──────────────────────────────────────────────────────

  const filteredSessions = sessions.filter(s =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="gpt-mode" style={{ fontSize: `${fontSize}px` }}>

      {/* ── Sidebar ── */}
      <div className="gpt-sidebar">
        <button className="gpt-new-chat-btn" onClick={handleNewChat}>
          <Plus size={16} />
          New chat
        </button>

        <div className="gpt-search">
          <Search size={14} color="var(--gpt-text-muted)" />
          <input
            placeholder="Search chats..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="gpt-history-list">
          {filteredSessions.length === 0 && (
            <div style={{ padding: '12px', fontSize: '12px', color: 'var(--gpt-text-muted)', textAlign: 'center' }}>
              {searchQuery ? 'No results' : 'No chats yet'}
            </div>
          )}
          {filteredSessions.map(session => (
            <div
              key={session.id}
              className={`gpt-history-item ${session.id === activeSessionId ? 'active' : ''}`}
              onClick={() => setActiveSessionId(session.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: session.id === activeSessionId ? 'rgba(255,255,255,0.08)' : undefined,
              }}
            >
              <MessageSquare size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {session.title}
              </span>
              <button
                onClick={e => handleDeleteSession(session.id, e)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--gpt-text-muted)', opacity: 0, padding: '2px',
                  flexShrink: 0,
                }}
                className="delete-session-btn"
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main Chat Area ── */}
      <div className="gpt-main-chat">
        <div className="chat-header-bar">
          <ModelSelector currentModel={currentModel} onSelect={setCurrentModel} />
          {isGenerating && (
            <span style={{ fontSize: '11px', color: 'var(--gpt-text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="spin" style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid var(--gpt-text-muted)', borderTopColor: 'transparent', borderRadius: '50%' }} />
              Generating…
            </span>
          )}
        </div>

        {/* Messages */}
        <div className="gpt-chat-messages">
          {messages.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '100%', gap: '16px',
              color: 'var(--gpt-text-muted)', opacity: 0.6,
            }}>
              <Bot size={48} strokeWidth={1} />
              <div style={{ fontSize: '18px', fontWeight: 600 }}>How can I help you today?</div>
              <div style={{ fontSize: '14px' }}>Running locally on <strong>{currentModel}</strong></div>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className="gpt-message">
                <div className={`gpt-avatar ${msg.role}`}>
                  {msg.role === 'ai' ? <Bot size={18} /> : <User size={18} />}
                </div>
                <div className="gpt-message-content" style={{ fontSize: `${fontSize}px` }}>
                  {msg.role === 'ai' && msg.content === '' ? (
                    <span className="spin" style={{
                      display: 'inline-block', width: 14, height: 14,
                      border: '2px solid var(--gpt-text-muted)',
                      borderTopColor: 'transparent', borderRadius: '50%',
                    }} />
                  ) : (
                    <ReactMarkdown
                      components={{
                        code({ node, inline, className, children, ...props }: any) {
                          const match = /language-(\w+)/.exec(className || '');
                          return !inline && match ? (
                            <SyntaxHighlighter style={vscDarkPlus as any} language={match[1]} PreTag="div" {...props}>
                              {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          ) : (
                            <code className={className} {...props}>{children}</code>
                          );
                        }
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="gpt-input-container">
          <form onSubmit={handleSubmit} className="gpt-input-wrapper">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${currentModel}… (Shift+Enter for newline)`}
              className="gpt-input"
              rows={1}
              style={{
                height: Math.min(input.split('\n').length * 24 + 8, 200) + 'px',
                fontSize: `${fontSize}px`,
              }}
            />
            <button type="submit" className="gpt-send-btn" disabled={!input.trim() || isGenerating}>
              <Send size={14} />
            </button>
          </form>
          <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--gpt-text-muted)', marginTop: '12px' }}>
            Local Cortex can make mistakes. Consider verifying important information.
          </div>
        </div>
      </div>
    </div>
  );
};

export default GptView;
