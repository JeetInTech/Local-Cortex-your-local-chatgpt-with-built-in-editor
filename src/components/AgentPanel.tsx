/**
 * AgentPanel — Native Tauri Agentic Task Executor
 * Communicates with Rust backend via invoke/listen (no HTTP server needed).
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  Bot, CheckCircle2, XCircle, Terminal,
  FileText, Search, FolderOpen, ChevronDown, ChevronRight,
  Loader2, Play, Square, Trash2, Copy, Check,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type EventType =
  | 'thought' | 'action' | 'observation' | 'approval_required'
  | 'approval_result' | 'final_answer' | 'error' | 'done' | 'user';

interface AgentEvent {
  type: EventType;
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  action_id?: string;
  approved?: boolean;
  error?: boolean;
}

interface Step {
  event: AgentEvent;
  id: string;
}

// ── Tool cosmetics ─────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, React.ReactElement> = {
  read_file:        <FileText size={13} />,
  write_file:       <FileText size={13} color="#f0a" />,
  create_file:      <FileText size={13} color="#0af" />,
  run_command:      <Terminal size={13} color="#fa0" />,
  list_directory:   <FolderOpen size={13} />,
  search_codebase:  <Search size={13} />,
};

const TOOL_COLORS: Record<string, string> = {
  write_file:      '#ff004422',
  create_file:     '#00aaff22',
  run_command:     '#ffaa0022',
  read_file:       '#00ff8822',
  list_directory:  '#88aaff22',
  search_codebase: '#aa88ff22',
};

function genId() { return Math.random().toString(36).slice(2, 9); }

// ── Sub-components ─────────────────────────────────────────────────────────────

function ThoughtBlock({ content }: { content: string }) {
  return (
    <div style={{
      display: 'flex', gap: '8px', padding: '8px 12px',
      background: 'rgba(100,100,255,0.06)', borderRadius: '6px',
      borderLeft: '2px solid #5555ff55', margin: '4px 0',
    }}>
      <Bot size={14} style={{ flexShrink: 0, marginTop: 2, color: '#8888ff' }} />
      <span style={{ fontSize: '12px', color: '#aaa', lineHeight: 1.5, fontStyle: 'italic' }}>
        {content}
      </span>
    </div>
  );
}

function ActionBlock({
  tool, args, actionId, onApprove, onReject, needsApproval, approved,
}: {
  tool: string;
  args: Record<string, unknown>;
  actionId?: string;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  needsApproval?: boolean;
  approved?: boolean | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const bg = TOOL_COLORS[tool] ?? 'rgba(255,255,255,0.04)';

  return (
    <div style={{
      background: bg, border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '6px', margin: '4px 0', overflow: 'hidden',
    }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px', cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}
      >
        {TOOL_ICONS[tool] ?? <Terminal size={13} />}
        <span style={{ fontSize: '12px', color: '#ddd', fontWeight: 600, fontFamily: 'monospace' }}>
          {tool}
        </span>
        {'path' in args && (
          <span style={{ fontSize: '11px', color: '#888', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {String(args.path)}
          </span>
        )}
        {'command' in args && (
          <span style={{ fontSize: '11px', color: '#fa0', fontFamily: 'monospace', flex: 1 }}>
            $ {String(args.command).slice(0, 60)}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', alignItems: 'center' }}>
          {approved === true  && <CheckCircle2 size={13} color="#4caf50" />}
          {approved === false && <XCircle size={13} color="#f44336" />}
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
      </div>

      {expanded && (
        <pre style={{
          margin: 0, padding: '8px 12px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          fontSize: '11px', color: '#ccc', overflowX: 'auto',
          background: 'rgba(0,0,0,0.2)',
        }}>
          {JSON.stringify(args, null, 2)}
        </pre>
      )}

      {needsApproval && approved === null && actionId && onApprove && onReject && (
        <div style={{
          display: 'flex', gap: '8px', padding: '8px 12px',
          borderTop: '1px solid rgba(255,165,0,0.3)',
          background: 'rgba(255,165,0,0.06)',
        }}>
          <span style={{ fontSize: '11px', color: '#fa0', flex: 1 }}>
            ⚠ Approve this {tool === 'run_command' ? 'command' : 'file operation'}?
          </span>
          <button onClick={() => onApprove(actionId)} style={{
            background: '#4caf5022', border: '1px solid #4caf5055', color: '#4caf50',
            padding: '4px 12px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: 600,
          }}>Approve</button>
          <button onClick={() => onReject(actionId)} style={{
            background: '#f4433622', border: '1px solid #f4433655', color: '#f44336',
            padding: '4px 12px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: 600,
          }}>Reject</button>
        </div>
      )}
    </div>
  );
}

function ObservationBlock({ content, error }: { content: string; error?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{
      background: error ? 'rgba(244,67,54,0.08)' : 'rgba(0,0,0,0.3)',
      borderRadius: '6px', margin: '4px 0',
      border: `1px solid ${error ? '#f4433633' : 'rgba(255,255,255,0.05)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <span style={{ fontSize: '10px', color: error ? '#f44' : '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {error ? 'Error' : 'Output'}
        </span>
        <div style={{ marginLeft: 'auto', cursor: 'pointer', color: '#666' }}
          onClick={async () => { await navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? <Check size={11} color="#4caf50" /> : <Copy size={11} />}
        </div>
      </div>
      <pre style={{
        margin: 0, padding: '8px 12px', fontSize: '11px', color: error ? '#f88' : '#aaa',
        overflowX: 'auto', maxHeight: '200px', overflowY: 'auto',
        fontFamily: "'Cascadia Code', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {content.slice(0, 2000)}{content.length > 2000 ? '\n… (truncated)' : ''}
      </pre>
    </div>
  );
}

function FinalAnswerBlock({ content }: { content: string }) {
  return (
    <div style={{ background: 'rgba(76,175,80,0.08)', border: '1px solid #4caf5044', borderRadius: '8px', padding: '12px', margin: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <CheckCircle2 size={15} color="#4caf50" />
        <span style={{ fontSize: '12px', color: '#4caf50', fontWeight: 600 }}>Task Complete</span>
      </div>
      <p style={{ margin: 0, fontSize: '13px', color: '#ccc', lineHeight: 1.6 }}>{content}</p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface AgentPanelProps {
  workspace?: string;
  model?: string;
  fontSize?: number;
}

const AgentPanel: React.FC<AgentPanelProps> = ({
  workspace = '.',
  model = 'llama3.2:latest',
  fontSize = 13,
}) => {
  const [task, setTask]                   = useState('');
  const [steps, setSteps]                 = useState<Step[]>([]);
  const [running, setRunning]             = useState(false);
  const [pendingApprovals, setPending]    = useState<Record<string, boolean | null>>({});
  const bottomRef                         = useRef<HTMLDivElement>(null);
  const unlistenRef                       = useRef<UnlistenFn | null>(null);


  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps]);

  const addStep = useCallback((event: AgentEvent) => {
    setSteps(prev => [...prev, { event, id: genId() }]);
  }, []);

  // ── Run agent ───────────────────────────────────────────────────────────────
  const handleRun = async () => {
    if (!task.trim() || running) return;

    // Cleanup previous listener
    if (unlistenRef.current) { unlistenRef.current(); unlistenRef.current = null; }

    const currentTask = task.trim();
    setPending({});
    setRunning(true);
    setTask('');

    // Add user prompt to history immediately
    addStep({ type: 'user', content: currentTask });

    try {
      const id = genId();

      // Listen for events emitted by Rust for this specific task FIRST
      const unlisten = await listen<AgentEvent>(`agent-event-${id}`, ev => {
        const event = ev.payload;
        addStep(event);

        if (event.type === 'approval_required' && event.action_id) {
          setPending(prev => ({ ...prev, [event.action_id!]: null }));
        }
        if (event.type === 'done') {
          setRunning(false);
        }
      });
      unlistenRef.current = unlisten;

      await invoke('start_agent', {
        id,
        task: currentTask,
        workspace,
        model,
      });

    } catch (err) {
      addStep({ type: 'error', content: `Failed to start agent: ${err}` });
      setRunning(false);
    }
  };

  // ── Approval handlers ───────────────────────────────────────────────────────
  const handleApprove = async (actionId: string) => {
    setPending(prev => ({ ...prev, [actionId]: true }));
    await invoke('agent_approve', { actionId, approved: true });
  };

  const handleReject = async (actionId: string) => {
    setPending(prev => ({ ...prev, [actionId]: false }));
    await invoke('agent_approve', { actionId, approved: false });
  };

  const handleCancel = async () => {
    // Resolve all pending approvals as rejected → unblocks the Rust loop
    for (const [id, val] of Object.entries(pendingApprovals)) {
      if (val === null) await invoke('agent_approve', { actionId: id, approved: false });
    }
    if (unlistenRef.current) { unlistenRef.current(); unlistenRef.current = null; }
    setRunning(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRun(); }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, width: '100%', background: 'transparent', fontFamily: "'Inter', sans-serif" }}>

      {/* Steps feed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {steps.length === 0 && !running && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', color: '#555', textAlign: 'center' }}>
            <Bot size={40} strokeWidth={1} />
            <div style={{ fontSize: '14px' }}>Describe a task and hit Enter</div>
            <div style={{ fontSize: '11px', maxWidth: '280px', lineHeight: 1.6 }}>
              The agent will plan, call tools, and ask your approval before any file writes or terminal commands.
            </div>
          </div>
        )}

        {steps.map(step => {
          const ev = step.event;
          switch (ev.type) {
            case 'user':
              return (
                <div key={step.id} style={{ 
                  background: 'rgba(255, 255, 255, 0.05)', 
                  padding: '10px 12px', 
                  borderRadius: '6px', 
                  margin: '12px 0 8px 0',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 500
                }}>
                  <span style={{ color: '#aaa', marginRight: '8px' }}>You:</span>
                  {ev.content}
                </div>
              );

            case 'thought':
              return <ThoughtBlock key={step.id} content={ev.content!} />;

            case 'action':
              return (
                <ActionBlock
                  key={step.id}
                  tool={ev.tool!}
                  args={ev.args ?? {}}
                  actionId={ev.action_id}
                  approved={ev.action_id !== undefined ? (pendingApprovals[ev.action_id] ?? undefined) : undefined}
                />
              );

            case 'approval_required':
              return (
                <ActionBlock
                  key={step.id}
                  tool={ev.tool!}
                  args={ev.args ?? {}}
                  actionId={ev.action_id}
                  needsApproval
                  approved={ev.action_id !== undefined ? pendingApprovals[ev.action_id] : null}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              );

            case 'observation':
              return <ObservationBlock key={step.id} content={ev.content!} error={ev.error} />;

            case 'final_answer':
              return <FinalAnswerBlock key={step.id} content={ev.content!} />;

            case 'error':
              return <ObservationBlock key={step.id} content={ev.content!} error />;

            default:
              return null;
          }
        })}

        {running && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', color: '#888' }}>
            <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: '12px' }}>Agent is thinking…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div style={{ padding: '12px', borderTop: '1px solid #333', background: '#1e1e1e' }}>
        {steps.length > 0 && !running && (
          <button
            onClick={() => setSteps([])}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: '1px solid #333', color: '#666', padding: '3px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', marginBottom: '8px' }}
          >
            <Trash2 size={11} /> Clear
          </button>
        )}
        <div style={{ display: 'flex', gap: '8px' }}>
          <textarea
            value={task}
            onChange={e => setTask(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Scan my project, find all TODO comments and create a TODO.md file…"
            disabled={running}
            rows={2}
            style={{
              flex: 1, minWidth: 0, background: '#2a2a2a', border: '1px solid #444',
              borderRadius: '6px', padding: '8px 12px', color: '#eee',
              fontSize: `${fontSize}px`, resize: 'vertical', outline: 'none',
              fontFamily: 'inherit', lineHeight: 1.5,
            }}
          />
          {running ? (
            <button onClick={handleCancel} style={{ background: '#f4433622', border: '1px solid #f4433655', color: '#f44336', borderRadius: '6px', padding: '0 14px', cursor: 'pointer' }}>
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={handleRun}
              disabled={!task.trim()}
              style={{
                background: task.trim() ? '#7c7cff22' : '#333',
                border: '1px solid #7c7cff55',
                color: task.trim() ? '#7c7cff' : '#555',
                borderRadius: '6px', padding: '0 14px',
                cursor: task.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              <Play size={14} />
            </button>
          )}
        </div>
        <div style={{ fontSize: '10px', color: '#555', marginTop: '6px' }}>
          Shift+Enter for newline · Agent asks before any file writes or commands
        </div>
      </div>
    </div>
  );
};

export default AgentPanel;
