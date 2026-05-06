import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import ReactMarkdown from 'react-markdown';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Code2,
  Copy,
  FileText,
  Filter,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react';
import ModelSelector from './ModelSelector';
import CodeBlock from './CodeBlock';

const AGENT_MODEL_KEY = 'localcortex-agent-model';

type EventType =
  | 'thought'
  | 'action'
  | 'observation'
  | 'approval_required'
  | 'approval_result'
  | 'final_answer'
  | 'error'
  | 'done'
  | 'user';

interface AgentEvent {
  type: EventType;
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  action_id?: string;
  error?: boolean;
}

interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

interface PersistedSession {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  keep_forever: boolean;
  model: string;
  workspace?: string | null;
  messages: PersistedMessage[];
}

interface PendingApproval {
  actionId: string;
  tool: string;
  args: Record<string, unknown>;
  status: boolean | null;
}

interface AgentLog {
  id: string;
  type: 'thought' | 'action' | 'observation' | 'error';
  label: string;
  content: string;
  error?: boolean;
}

interface AssistantDraft {
  id: string;
  sessionId: string;
  content: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  approvals: PendingApproval[];
  logs: AgentLog[];
}

interface AgentPanelProps {
  workspace?: string;
  model?: string;
  onModelChange?: (model: string) => void;
  fontSize?: number;
  onWorkspaceChanged?: () => void;
  systemPrompt?: string;
  numCtx?: number;
  temperature?: number;
}

type ExecutionEnvironment = 'local' | 'remote';
type ApprovalMode = 'default' | 'auto' | 'manual';
type ComposerMode = 'agent' | 'code';

const TOOL_ICONS: Record<string, React.ReactElement> = {
  read_file: <FileText size={13} />,
  write_file: <FileText size={13} />,
  create_file: <FileText size={13} />,
  delete_file: <Trash2 size={13} />,
  run_command: <Terminal size={13} />,
  list_directory: <FolderOpen size={13} />,
  search_codebase: <Search size={13} />,
};


function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowMs() {
  return Date.now();
}

function buildSessionTitle(messages: PersistedMessage[]) {
  const firstUser = messages.find((message) => message.role === 'user');
  if (!firstUser) return 'New thread';
  const text = firstUser.content.trim().replace(/\s+/g, ' ');
  return text.length > 54 ? `${text.slice(0, 54)}...` : text || 'New thread';
}

function formatRelativeTime(timestamp: number) {
  const deltaMs = Math.max(0, nowMs() - timestamp);
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function toolDescriptor(tool?: string, args?: Record<string, unknown>) {
  if (!tool) return 'Agent activity';
  if (args && 'path' in args) return `${tool} - ${String(args.path)}`;
  if (args && 'command' in args) return `${tool} - $ ${String(args.command)}`;
  if (args && 'query' in args) return `${tool} - ${String(args.query)}`;
  return tool;
}

function formatLogSummary(logs: AgentLog[]) {
  const usefulLogs = logs.filter((log) => log.type === 'action' || log.type === 'observation' || log.type === 'error');
  if (usefulLogs.length === 0) return 'Done.';

  const lines = usefulLogs.slice(-10).map((log) => {
    const prefix = log.error || log.type === 'error' ? 'Error' : log.type === 'action' ? 'Action' : 'Output';
    const detail = log.content ? `\n${log.content.slice(0, 700)}` : '';
    return `- ${prefix}: ${log.label}${detail}`;
  });

  return `Completed workspace run.\n\n${lines.join('\n')}`;
}

function toolMutatesWorkspace(tool?: string) {
  return tool === 'write_file' || tool === 'create_file' || tool === 'delete_file' || tool === 'run_command';
}

function IconButton({
  children,
  title,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      className={`agent-icon-btn ${active ? 'active' : ''}`}
      title={title}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
      {children}
    </button>
  );
}

function SelectControl<T extends string>({
  icon,
  value,
  options,
  onChange,
  title,
}: {
  icon: React.ReactNode;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  title: string;
}) {
  return (
    <label className="agent-select-control" title={title}>
      {icon}
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} />
    </label>
  );
}

function ApprovalCard({
  approval,
  onApprove,
  onReject,
}: {
  approval: PendingApproval;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="agent-approval-card">
      <div className="agent-approval-head">
        <div className="agent-log-icon">{TOOL_ICONS[approval.tool] ?? <Terminal size={13} />}</div>
        <div className="agent-approval-copy">
          <strong>Approval required</strong>
          <span>{toolDescriptor(approval.tool, approval.args)}</span>
        </div>
        <IconButton title="Toggle details" onClick={() => setExpanded((value) => !value)}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </IconButton>
      </div>

      {expanded && <pre className="agent-log-pre">{JSON.stringify(approval.args, null, 2)}</pre>}

      <div className="agent-approval-actions">
        <button
          type="button"
          className="agent-approve-btn"
          disabled={approval.status !== null}
          onClick={() => onApprove(approval.actionId)}
        >
          {approval.status === true ? 'Approved' : 'Approve'}
        </button>
        <button
          type="button"
          className="agent-reject-btn"
          disabled={approval.status !== null}
          onClick={() => onReject(approval.actionId)}
        >
          {approval.status === false ? 'Rejected' : 'Reject'}
        </button>
      </div>
    </div>
  );
}

function ExecutionLogs({ logs }: { logs: AgentLog[] }) {
  const [openLogs, setOpenLogs] = useState(true);
  if (logs.length === 0) return null;

  return (
    <div className="agent-execution">
      <button type="button" className="agent-execution-toggle" onClick={() => setOpenLogs((value) => !value)}>
        {openLogs ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Terminal size={13} />
        <span>Execution</span>
        <span className="agent-count">{logs.length}</span>
      </button>
      {openLogs && (
        <div className="agent-log-list">
          {logs.map((log) => (
            <div key={log.id} className={`agent-log-row ${log.error ? 'error' : ''}`}>
              <div className="agent-log-meta">
                {log.type === 'error' ? <CircleAlert size={13} /> : log.type === 'action' ? <Wrench size={13} /> : <Terminal size={13} />}
                <span>{log.label}</span>
              </div>
              {log.content && <pre>{log.content}</pre>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssistantBubble({
  message,
  draft,
  fontSize,
  onApprove,
  onReject,
  onRerun,
  onApproveAll,
}: {
  message: PersistedMessage;
  draft?: AssistantDraft;
  fontSize: number;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRerun: () => void;
  onApproveAll: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const content = draft ? draft.content : message.content;

  return (
    <article className={`agent-message assistant ${draft?.status === 'error' ? 'error' : ''}`}>
      <div className="agent-avatar assistant">
        <Bot size={15} />
      </div>
      <div className="agent-message-body">
        <div className="agent-message-card">
          {draft?.status === 'running' && !content && (
            <div className="agent-streaming">
              <Loader2 size={14} className="spin" />
              Working in the workspace
            </div>
          )}

          {content && (
            <div className="agent-markdown" style={{ fontSize: `${fontSize}px` }}>
              <ReactMarkdown
                components={{
                  code({ inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '');
                    const code = String(children).replace(/\n$/, '');
                    if (!inline && match) {
                      return <CodeBlock code={code} language={match[1]} />;
                    }
                    return (
                      <code className="agent-inline-code" {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          )}

          <ExecutionLogs logs={draft?.logs ?? []} />

          {draft?.approvals.length ? (
            <div className="agent-approval-stack">
              {draft.approvals.some((approval) => approval.status === null) && (
                <button type="button" className="agent-approve-all-btn" onClick={onApproveAll}>
                  Approve all and continue
                </button>
              )}
              {draft.approvals.map((approval) => (
                <ApprovalCard key={approval.actionId} approval={approval} onApprove={onApprove} onReject={onReject} />
              ))}
            </div>
          ) : null}
        </div>

        <div className="agent-message-actions">
          <span>{draft?.status === 'running' ? 'streaming' : formatRelativeTime(message.created_at)}</span>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(content || '');
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
            disabled={!content}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={onRerun}>
            <RotateCcw size={12} />
            Rerun
          </button>
        </div>
      </div>
    </article>
  );
}

const AgentPanel: React.FC<AgentPanelProps> = ({
  workspace = '.',
  model = '',
  onModelChange,
  fontSize = 13,
  onWorkspaceChanged,
  systemPrompt,
  numCtx,
  temperature,
}) => {
  const [sessions, setSessions] = useState<PersistedSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [task, setTask] = useState('');
  const [running, setRunning] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // Initialize from localStorage, then fall back to the prop, then empty string
  const [currentModel, setCurrentModel] = useState<string>(
    () => localStorage.getItem(AGENT_MODEL_KEY) || model || ''
  );
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AssistantDraft | null>(null);
  const [filterKept, setFilterKept] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(
    () => localStorage.getItem('localcortex-agent-history-visible') !== 'false',
  );
  const [composerMode, setComposerMode] = useState<ComposerMode>('agent');
  const [executionEnvironment, setExecutionEnvironment] = useState<ExecutionEnvironment>('local');
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('default');
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Sync prop only when a non-empty model is passed in from outside
  useEffect(() => {
    if (model) setCurrentModel(model);
  }, [model]);

  // ── Auto-detect model on startup ────────────────────────────────────────
  // If no model is saved or the saved model is no longer installed,
  // pick the first available LLM automatically.
  useEffect(() => {
    invoke<{ id: string; name: string; category: string; model_type: string; size: string | null; source: string }[]>('list_models')
      .then(models => {
        if (models.length === 0) return;
        const saved = localStorage.getItem(AGENT_MODEL_KEY);
        const savedExists = saved && models.some(m => m.id === saved);
        if (!savedExists) {
          const first = models[0];
          setCurrentModel(first.id);
          localStorage.setItem(AGENT_MODEL_KEY, first.id);
          onModelChange?.(first.id);
        }
      })
      .catch(() => {
        // Ollama may not be running yet — leave whatever is stored
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem('localcortex-agent-history-visible', String(showHistory));
  }, [showHistory]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const loaded = await invoke<PersistedSession[]>('load_agent_history');
      setSessions(loaded);
      setActiveSessionId((current) => current ?? loaded[0]?.id ?? null);
    } catch (error) {
      setHistoryError(String(error));
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, draft]);

  useEffect(() => {
    return () => {
      if (unlistenRef.current) unlistenRef.current();
    };
  }, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const activeMessages = activeSession?.messages ?? [];

  const visibleSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return sessions.filter((session) => {
      if (filterKept && !session.keep_forever) return false;
      if (!query) return true;
      return session.title.toLowerCase().includes(query);
    });
  }, [filterKept, searchQuery, sessions]);

  const createSession = useCallback(
    (): PersistedSession => ({
      id: genId(),
      title: 'New thread',
      created_at: nowMs(),
      updated_at: nowMs(),
      keep_forever: false,
      model: currentModel,
      workspace,
      messages: [],
    }),
    [currentModel, workspace],
  );

  const updateSession = useCallback(
    (sessionId: string, updater: (session: PersistedSession) => PersistedSession) => {
      setSessions((currentSessions) => {
        let changed = false;
        const nextSessions = currentSessions.map((session) => {
          if (session.id !== sessionId) return session;
          changed = true;
          return updater(session);
        });
        if (changed) {
          const sorted = [...nextSessions].sort((a, b) => b.updated_at - a.updated_at);
          invoke('save_agent_history', { sessions: sorted }).catch((error) => setHistoryError(String(error)));
          return sorted;
        }
        return currentSessions;
      });
    },
    [],
  );

  const handleNewThread = useCallback(() => {
    const session = createSession();
    setSessions((currentSessions) => {
      const nextSessions = [session, ...currentSessions];
      const sorted = [...nextSessions].sort((a, b) => b.updated_at - a.updated_at);
      invoke('save_agent_history', { sessions: sorted }).catch((error) => setHistoryError(String(error)));
      return sorted;
    });
    setActiveSessionId(session.id);
    setDraft(null);
    setTask('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [createSession]);

  const handleDeleteSession = useCallback(
    (sessionId: string, event?: React.MouseEvent) => {
      event?.stopPropagation();
      setSessions((currentSessions) => {
        const nextSessions = currentSessions.filter((session) => session.id !== sessionId);
        const sorted = [...nextSessions].sort((a, b) => b.updated_at - a.updated_at);
        invoke('save_agent_history', { sessions: sorted }).catch((error) => setHistoryError(String(error)));
        
        if (activeSessionId === sessionId) {
          setActiveSessionId(sorted[0]?.id ?? null);
          setDraft(null);
        }
        return sorted;
      });
    },
    [activeSessionId],
  );

  const handleRenameSession = useCallback(
    (sessionId: string) => {
      const title = renameValue.trim();
      if (!title) {
        setRenameSessionId(null);
        return;
      }
      updateSession(sessionId, (session) => ({ ...session, title, updated_at: nowMs() }));
      setRenameSessionId(null);
    },
    [renameValue, updateSession],
  );

  const appendUserAndPlaceholder = useCallback(
    (session: PersistedSession, prompt: string) => {
      const userMessage: PersistedMessage = {
        id: genId(),
        role: 'user',
        content: prompt,
        created_at: nowMs(),
      };
      const assistantMessage: PersistedMessage = {
        id: genId(),
        role: 'assistant',
        content: '',
        created_at: nowMs(),
      };
      const messages = [...session.messages, userMessage, assistantMessage];
      return {
        assistantMessage,
        session: {
          ...session,
          title: buildSessionTitle(messages),
          updated_at: nowMs(),
          model: currentModel,
          workspace,
          messages,
        },
      };
    },
    [currentModel, workspace],
  );

  const persistDraftResult = useCallback(
    (sessionId: string, draftId: string, finalContent: string) => {
      updateSession(sessionId, (existing) => {
        const messages = existing.messages.map((message) =>
          message.id === draftId ? { ...message, content: finalContent } : message,
        );
        return {
          ...existing,
          title: buildSessionTitle(messages),
          updated_at: nowMs(),
          model: currentModel,
          workspace,
          messages,
        };
      });
    },
    [currentModel, updateSession, workspace],
  );

  const runPrompt = useCallback(
    async (rawPrompt: string) => {
      const cleanPrompt = rawPrompt.trim();
      if (!cleanPrompt || running) return;

      if (executionEnvironment === 'remote') {
        setHistoryError('Remote execution is not configured for this workspace. Switch to Local to run the agent.');
        return;
      }

      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      const prompt = composerMode === 'code' ? `Focus on code changes and verification.\n\n${cleanPrompt}` : cleanPrompt;
      const baseSession = activeSession ?? createSession();
      const { assistantMessage, session } = appendUserAndPlaceholder(baseSession, prompt);
      const contextMessages = baseSession.messages.map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      }));

      setSessions((currentSessions) => {
        const activeItem = currentSessions.find((s) => s.id === session.id);
        const nextSessions = activeItem
          ? currentSessions.map((item) => (item.id === session.id ? session : item))
          : [session, ...currentSessions];
        
        const sorted = [...nextSessions].sort((a, b) => b.updated_at - a.updated_at);
        invoke('save_agent_history', { sessions: sorted }).catch((error) => setHistoryError(String(error)));
        return sorted;
      });
      setActiveSessionId(session.id);
      setTask('');
      setRunning(true);
      setHistoryError(null);

      const taskId = genId();
      setCurrentTaskId(taskId);
      setDraft({
        id: assistantMessage.id,
        sessionId: session.id,
        content: '',
        status: 'running',
        approvals: [],
        logs: [],
      });

      try {
        const unlisten = await listen<AgentEvent>(`agent-event-${taskId}`, (eventWrapper) => {
          const event = eventWrapper.payload;

          setDraft((currentDraft) => {
            if (!currentDraft || currentDraft.sessionId !== session.id) return currentDraft;
            const nextDraft: AssistantDraft = {
              ...currentDraft,
              approvals: [...currentDraft.approvals],
              logs: [...currentDraft.logs],
            };

            if (event.type === 'thought' && event.content) {
              nextDraft.logs.push({
                id: genId(),
                type: 'thought',
                label: 'Thought',
                content: event.content,
              });
            }

            if (event.type === 'action' && event.tool) {
              nextDraft.logs.push({
                id: event.action_id ?? genId(),
                type: 'action',
                label: toolDescriptor(event.tool, event.args),
                content: event.args ? JSON.stringify(event.args, null, 2) : '',
              });
            }

            if (event.type === 'observation') {
              if (!event.error && toolMutatesWorkspace(event.tool)) {
                onWorkspaceChanged?.();
              }
              nextDraft.logs.push({
                id: event.action_id ? `${event.action_id}-observation` : genId(),
                type: event.error ? 'error' : 'observation',
                label: event.error ? 'Error' : `Output${event.tool ? ` from ${event.tool}` : ''}`,
                content: event.content ?? '',
                error: event.error,
              });
            }

            if (event.type === 'approval_required' && event.action_id && event.tool) {
              nextDraft.approvals.push({
                actionId: event.action_id,
                tool: event.tool,
                args: event.args ?? {},
                status: approvalMode === 'auto' ? true : null,
              });
              if (approvalMode === 'auto') {
                invoke('agent_approve', { actionId: event.action_id, approved: true }).catch(console.error);
              }
            }

            if (event.type === 'approval_result' && event.action_id) {
              nextDraft.approvals = nextDraft.approvals.map((approval) =>
                approval.actionId === event.action_id
                  ? { ...approval, status: event.content === 'approved' }
                  : approval,
              );
            }

            if (event.type === 'final_answer') {
              nextDraft.content = event.content ?? nextDraft.content;
              nextDraft.status = 'done';
            }

            if (event.type === 'error') {
              nextDraft.content = event.content ?? nextDraft.content;
              nextDraft.status = event.content === 'Agent run cancelled.' ? 'cancelled' : 'error';
              nextDraft.logs.push({
                id: genId(),
                type: 'error',
                label: 'Agent error',
                content: event.content ?? 'Unknown error',
                error: true,
              });
            }

            return nextDraft;
          });

          if (event.type === 'done') {
            setRunning(false);
            setCurrentTaskId(null);
            if (unlistenRef.current) {
              unlistenRef.current();
              unlistenRef.current = null;
            }

            setDraft((currentDraft) => {
              if (!currentDraft || currentDraft.sessionId !== session.id) return null;
              const finalContent = currentDraft.content || (currentDraft.status === 'cancelled' ? 'Stopped.' : formatLogSummary(currentDraft.logs));
              persistDraftResult(session.id, currentDraft.id, finalContent);
              onWorkspaceChanged?.();
              return null;
            });
          }
        });

        unlistenRef.current = unlisten;

        await invoke('start_agent', {
          id: taskId,
          task: prompt,
          workspace,
          model: currentModel,
          contextMessages,
          systemPrompt,
          numCtx,
          temperature,
        });
      } catch (error) {
        setRunning(false);
        setCurrentTaskId(null);
        const message = `Failed to start agent: ${error}`;
        setHistoryError(message);
        persistDraftResult(session.id, assistantMessage.id, message);
        setDraft(null);
      }
    },
    [
      activeSession,
      appendUserAndPlaceholder,
      approvalMode,
      composerMode,
      createSession,
      currentModel,
      executionEnvironment,
      persistDraftResult,
      running,
      sessions,
      onWorkspaceChanged,
      workspace,
    ],
  );

  const handleRun = useCallback(() => {
    runPrompt(task);
  }, [runPrompt, task]);

  const handleApprove = async (actionId: string) => {
    setDraft((currentDraft) =>
      currentDraft
        ? {
            ...currentDraft,
            approvals: currentDraft.approvals.map((approval) =>
              approval.actionId === actionId ? { ...approval, status: true } : approval,
            ),
          }
        : currentDraft,
    );
    await invoke('agent_approve', { actionId, approved: true });
  };

  const handleReject = async (actionId: string) => {
    setDraft((currentDraft) =>
      currentDraft
        ? {
            ...currentDraft,
            approvals: currentDraft.approvals.map((approval) =>
              approval.actionId === actionId ? { ...approval, status: false } : approval,
            ),
          }
        : currentDraft,
    );
    await invoke('agent_approve', { actionId, approved: false });
  };

  const handleApproveAll = async () => {
    const pending = draft?.approvals.filter((approval) => approval.status === null) ?? [];
    if (pending.length === 0) return;
    setApprovalMode('auto');
    setDraft((currentDraft) =>
      currentDraft
        ? {
            ...currentDraft,
            approvals: currentDraft.approvals.map((approval) =>
              approval.status === null ? { ...approval, status: true } : approval,
            ),
          }
        : currentDraft,
    );
    await Promise.all(
      pending.map((approval) => invoke('agent_approve', { actionId: approval.actionId, approved: true })),
    );
  };

  const handleCancel = async () => {
    if (draft) {
      for (const approval of draft.approvals) {
        if (approval.status === null) {
          await invoke('agent_approve', { actionId: approval.actionId, approved: false });
        }
      }
    }
    if (currentTaskId) await invoke('cancel_agent', { id: currentTaskId });
  };

  const handleAttach = async () => {
    const selected = await open({ multiple: true });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    const attachmentText = paths.map((path) => `@file ${path}`).join('\n');
    setTask((current) => (current.trim() ? `${current}\n${attachmentText}` : attachmentText));
    inputRef.current?.focus();
  };

  const handleRerunFrom = (index: number) => {
    for (let i = index; i >= 0; i -= 1) {
      const message = activeMessages[i];
      if (message?.role === 'user') {
        runPrompt(message.content);
        return;
      }
    }
  };

  return (
    <div className={`agent-shell ${showHistory ? '' : 'history-hidden'}`}>
      <aside className={`agent-sidebar ${showHistory ? '' : 'hidden'}`}>
        <header className="agent-sidebar-header">
          <div className="agent-section-title active">CHAT</div>
          <div className="agent-sidebar-actions">
            <IconButton title="Hide chat history" onClick={() => setShowHistory(false)}>
              <PanelLeftClose size={16} />
            </IconButton>
            <IconButton title="New thread" onClick={handleNewThread}>
              <Plus size={16} />
            </IconButton>
          </div>
        </header>

        <section className="agent-session-section">
          <div className="agent-section-label">SESSIONS</div>
          <div className="agent-search-box">
            <Search size={15} />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search threads" />
          </div>

          <div className="agent-thread-list">
            {loadingHistory ? (
              <div className="agent-list-state">
                <Loader2 size={14} className="spin" />
                Loading sessions
              </div>
            ) : visibleSessions.length === 0 ? (
              <div className="agent-list-state">{searchQuery ? 'No threads found' : 'No threads yet'}</div>
            ) : (
              visibleSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`agent-thread ${session.id === activeSessionId ? 'active' : ''}`}
                  onClick={() => {
                    setActiveSessionId(session.id);
                    setDraft(null);
                  }}
                >
                  <Bot size={14} className="agent-thread-icon" />
                  <div className="agent-thread-main">
                    {renameSessionId === session.id ? (
                      <input
                        className="agent-rename-input"
                        value={renameValue}
                        autoFocus
                        onChange={(event) => setRenameValue(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={() => handleRenameSession(session.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') handleRenameSession(session.id);
                          if (event.key === 'Escape') setRenameSessionId(null);
                        }}
                      />
                    ) : (
                      <span className="agent-thread-title">{session.title}</span>
                    )}
                    <span className="agent-thread-time">{formatRelativeTime(session.updated_at)}</span>
                  </div>
                  <div className="agent-thread-actions">
                    <button
                      type="button"
                      title="Rename"
                      onClick={(event) => {
                        event.stopPropagation();
                        setRenameSessionId(session.id);
                        setRenameValue(session.title);
                      }}
                    >
                      <MoreHorizontal size={13} />
                    </button>
                    <button type="button" title="Delete" onClick={(event) => handleDeleteSession(session.id, event)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>
      </aside>

      <main className="agent-main">
        <header className="agent-topbar">
          <div className="agent-topbar-title">
            {!showHistory && (
              <IconButton title="Show chat history" onClick={() => setShowHistory(true)}>
                <PanelLeftOpen size={16} />
              </IconButton>
            )}
            <Sparkles size={14} />
            <span>{activeSession?.title ?? 'New thread'}</span>
          </div>
          <div className="agent-topbar-actions">
            {showHistory && (
              <IconButton title="Hide chat history" onClick={() => setShowHistory(false)}>
                <PanelLeftClose size={16} />
              </IconButton>
            )}
            <IconButton title="New thread" onClick={handleNewThread}>
              <Plus size={16} />
            </IconButton>
            <IconButton title="Settings" active={showSettings} onClick={() => setShowSettings((value) => !value)}>
              <Settings size={16} />
            </IconButton>
            <IconButton title="Refresh sessions" onClick={loadHistory} disabled={loadingHistory}>
              <RefreshCw size={16} className={loadingHistory ? 'spin' : ''} />
            </IconButton>
            <IconButton title="Show kept threads only" active={filterKept} onClick={() => setFilterKept((value) => !value)}>
              <Filter size={16} />
            </IconButton>
          </div>
        </header>

        {showSettings && (
          <div className="agent-settings-strip">
            <div>
              <strong>Workspace</strong>
              <span title={workspace}>{workspace}</span>
            </div>
            <button
              type="button"
              onClick={() => activeSession && updateSession(activeSession.id, (session) => ({
                ...session,
                keep_forever: !session.keep_forever,
                updated_at: nowMs(),
              }))}
              disabled={!activeSession}
            >
              <Clock3 size={13} />
              {activeSession?.keep_forever ? 'Kept forever' : 'Expire after 30 days'}
            </button>
          </div>
        )}

        <section className="agent-chat-scroll">
          {historyError && (
            <div className="agent-error-banner">
              <CircleAlert size={15} />
              <span>{historyError}</span>
            </div>
          )}

          {activeMessages.length === 0 && !draft ? (
            <div className="agent-empty-state">
              <div className="agent-empty-icon">
                <Bot size={38} />
              </div>
              <h2>Autonomous workspace agent</h2>
              <p>It plans, edits files, runs commands, observes errors, and repeats until the task is working.</p>
            </div>
          ) : (
            activeMessages.map((message, index) => {
              const activeDraft = draft && draft.id === message.id ? draft : undefined;
              if (message.role === 'user') {
                return (
                  <article key={message.id} className="agent-message user">
                    <div className="agent-message-body">
                      <div className="agent-user-card" style={{ fontSize: `${fontSize}px` }}>
                        {message.content}
                      </div>
                    </div>
                  </article>
                );
              }

              return (
                <AssistantBubble
                  key={message.id}
                  message={message}
                  draft={activeDraft}
                  fontSize={fontSize}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onRerun={() => handleRerunFrom(index)}
                  onApproveAll={handleApproveAll}
                />
              );
            })
          )}
          <div ref={bottomRef} />
        </section>

        <footer className="agent-composer-wrap">
          <div className="agent-composer">
            <textarea
              ref={inputRef}
              value={task}
              onChange={(event) => setTask(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleRun();
                }
              }}
              placeholder="Describe what to build"
              disabled={running}
              rows={3}
            />

            <div className="agent-composer-toolbar">
              <div className="agent-tool-left">
                <IconButton title="Attach files" onClick={handleAttach}>
                  <Paperclip size={16} />
                </IconButton>
                <IconButton
                  title={composerMode === 'agent' ? 'Agent mode' : 'Code mode'}
                  active={composerMode === 'code'}
                  onClick={() => setComposerMode((value) => (value === 'agent' ? 'code' : 'agent'))}
                >
                  {composerMode === 'agent' ? <Wrench size={16} /> : <Code2 size={16} />}
                </IconButton>
              </div>

              <div className="agent-model-inline">
                <ModelSelector
                  currentModel={currentModel}
                  onSelect={(nextModel) => {
                    setCurrentModel(nextModel);
                    localStorage.setItem(AGENT_MODEL_KEY, nextModel);
                    onModelChange?.(nextModel);
                  }}
                  direction="up"
                />
              </div>

              <div className="agent-run-controls">
                <SelectControl
                  title="Execution environment"
                  icon={<Terminal size={14} />}
                  value={executionEnvironment}
                  onChange={setExecutionEnvironment}
                  options={[
                    { value: 'local', label: 'Local' },
                    { value: 'remote', label: 'Remote' },
                  ]}
                />
                <SelectControl
                  title="Approval mode"
                  icon={<Shield size={14} />}
                  value={approvalMode}
                  onChange={setApprovalMode}
                  options={[
                    { value: 'default', label: 'Default' },
                    { value: 'auto', label: 'Auto' },
                    { value: 'manual', label: 'Manual' },
                  ]}
                />
                {running ? (
                  <IconButton title="Stop agent" onClick={handleCancel}>
                    <Square size={16} />
                  </IconButton>
                ) : (
                  <button type="button" className="agent-send-btn" onClick={handleRun} disabled={!task.trim()}>
                    <Send size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="agent-composer-hint">
            <span>Enter to send</span>
            <span>Shift+Enter for newline</span>
            <span>
              <SlidersHorizontal size={12} />
              {approvalMode} approvals
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
};

export default AgentPanel;
