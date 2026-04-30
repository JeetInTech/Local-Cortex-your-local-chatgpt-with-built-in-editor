import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Plus, X, Maximize2,
  Terminal as TerminalIcon, Trash2, AlertCircle,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TerminalLine {
  id: string;
  text: string;
  type: 'output' | 'command' | 'error' | 'info' | 'prompt';
}

interface TerminalInstance {
  id: string;
  name: string;
  cwd: string;
  lines: TerminalLine[];
  history: string[];
  historyIdx: number;
}

interface TerminalPanelProps {
  cwd: string;
  fontSize: number;
  onClose: () => void;
  onMaximize?: () => void;
  onCommandDone?: () => void;
}

type PanelTab = 'terminal' | 'output' | 'problems' | 'debug' | 'ports';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeInstance(cwd: string, name = 'powershell'): TerminalInstance {
  return {
    id: genId(),
    name,
    cwd,
    lines: [
      { id: genId(), text: `Windows PowerShell`, type: 'info' },
      { id: genId(), text: `Copyright (C) Microsoft Corporation. All rights reserved.`, type: 'info' },
      { id: genId(), text: ``, type: 'output' },
    ],
    history: [],
    historyIdx: -1,
  };
}

function stripAnsi(str: string): { text: string; isError: boolean } {
  const isError = str.includes('\x1b[31m');
  return { text: str.replace(/\x1b\[[0-9;]*m/g, ''), isError };
}

// ─── Component ────────────────────────────────────────────────────────────────

const TerminalPanel: React.FC<TerminalPanelProps> = ({ cwd, fontSize, onClose, onMaximize, onCommandDone }) => {
  const [activeTab, setActiveTab] = useState<PanelTab>('terminal');
  const [instances, setInstances] = useState<TerminalInstance[]>(() => [makeInstance(cwd)]);
  const [activeInstanceId, setActiveInstanceId] = useState<string>(() => '');
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  // Init active instance id
  useEffect(() => {
    setActiveInstanceId(instances[0]?.id ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync cwd prop → update all instances that still have the default cwd ──
  useEffect(() => {
    if (!cwd || cwd === 'C:\\') return;
    setInstances(prev => prev.map(inst =>
      // Only update instances that were created with the fallback cwd
      inst.cwd === 'C:\\' || inst.cwd === '' ? { ...inst, cwd } : inst
    ));
  }, [cwd]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeInstance = instances.find(i => i.id === activeInstanceId) ?? instances[0];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeInstance?.lines]);

  useEffect(() => {
    if (activeTab === 'terminal') inputRef.current?.focus();
  }, [activeTab, activeInstanceId]);

  // ── Add new terminal instance ──────────────────────────────────────────────

  const addInstance = () => {
    const inst = makeInstance(activeInstance?.cwd ?? cwd);
    setInstances(prev => [...prev, inst]);
    setActiveInstanceId(inst.id);
  };

  // ── Kill an instance ───────────────────────────────────────────────────────

  const killInstance = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setInstances(prev => {
      const next = prev.filter(i => i.id !== id);
      if (activeInstanceId === id && next.length > 0) setActiveInstanceId(next[next.length - 1].id);
      return next;
    });
  };

  // ── Mutate a specific instance's lines ────────────────────────────────────

  const addLine = (instId: string, text: string, type: TerminalLine['type']) => {
    setInstances(prev => prev.map(inst => inst.id !== instId ? inst : {
      ...inst,
      lines: [...inst.lines, { id: genId(), text, type }],
    }));
  };

  // ── Run command ───────────────────────────────────────────────────────────

  const handleRun = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    const instId = activeInstance?.id;
    if (!instId || !trimmed) return;

    const currentCwd = activeInstance.cwd;

    addLine(instId, `PS ${currentCwd}> ${trimmed}`, 'command');
    setInstances(prev => prev.map(inst => inst.id !== instId ? inst : {
      ...inst,
      history: [trimmed, ...inst.history.slice(0, 49)],
      historyIdx: -1,
    }));
    setInput('');
    setIsRunning(true);

    // Built-in: clear / cls
    if (trimmed === 'clear' || trimmed === 'cls') {
      setInstances(prev => prev.map(inst => inst.id !== instId ? inst : { ...inst, lines: [] }));
      setIsRunning(false);
      return;
    }

    // cd — let PowerShell resolve the path (handles .., relative, absolute)
    const cdMatch = trimmed.match(/^(?:cd|Set-Location|sl)\s+(.+)$/i);
    if (cdMatch || trimmed === 'cd') {
      const target = cdMatch ? cdMatch[1].replace(/^['"]|['"]$/g, '').trim() : currentCwd;
      const streamId = genId();
      let capturedPath = '';

      const unlistenOut = await listen<string>(`terminal-out-${streamId}`, event => {
        const { text } = stripAnsi(event.payload);
        const t = text.trim();
        if (t) capturedPath = t;
      });
      const unlistenDone = await listen<number>(`terminal-done-${streamId}`, event => {
        if (event.payload === 0 && capturedPath) {
          // Update cwd to the path PowerShell resolved
          setInstances(prev => prev.map(inst =>
            inst.id !== instId ? inst : { ...inst, cwd: capturedPath }
          ));
        } else if (event.payload !== 0) {
          addLine(instId, `Cannot find path '${target}' because it does not exist.`, 'error');
        }
        setIsRunning(false);
        unlistenOut();
        unlistenDone();
      });

      try {
        // Run cd then immediately emit the resolved path — the ONLY stdout is the new cwd
        await invoke('run_terminal_command', {
          streamId,
          command: `Set-Location '${target.replace(/'/g, "''")}'; (Get-Location).Path`,
          cwd: currentCwd,
        });
      } catch (err) {
        addLine(instId, `Error: ${err}`, 'error');
        setIsRunning(false);
        unlistenOut();
        unlistenDone();
      }
      return;
    }

    const streamId = genId();
    const unlistenOut = await listen<string>(`terminal-out-${streamId}`, event => {
      const { text, isError } = stripAnsi(event.payload);
      addLine(instId, text, isError ? 'error' : 'output');
    });
    const unlistenDone = await listen<number>(`terminal-done-${streamId}`, event => {
      if (event.payload !== 0) {
        addLine(instId, `Process exited with code ${event.payload}`, 'error');
      }
      setIsRunning(false);
      onCommandDone?.();  // refresh the file explorer tree
      unlistenOut();
      unlistenDone();
    });

    try {
      await invoke('run_terminal_command', { streamId, command: trimmed, cwd: currentCwd });
    } catch (err) {
      addLine(instId, `Error: ${err}`, 'error');
      setIsRunning(false);
      unlistenOut();
      unlistenDone();
    }
  }, [activeInstance, cwd]);

  // ── Listen for remote commands (e.g. from Code Runner) ──────────────
  useEffect(() => {
    const unlisten = listen<{ command: string }>('run-terminal-command', (e) => {
      // Switch to terminal tab if it's not active
      setActiveTab('terminal');
      handleRun(e.payload.command);
    });
    return () => { unlisten.then(f => f()); };
  }, [handleRun]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleRun(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!activeInstance) return;
      const nextIdx = Math.min(activeInstance.historyIdx + 1, activeInstance.history.length - 1);
      setInstances(prev => prev.map(inst => inst.id !== activeInstance.id ? inst : { ...inst, historyIdx: nextIdx }));
      setInput(activeInstance.history[nextIdx] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!activeInstance) return;
      const nextIdx = Math.max(activeInstance.historyIdx - 1, -1);
      setInstances(prev => prev.map(inst => inst.id !== activeInstance.id ? inst : { ...inst, historyIdx: nextIdx }));
      setInput(nextIdx === -1 ? '' : activeInstance.history[nextIdx]);
    }
  };

  // ── Colors ─────────────────────────────────────────────────────────────────

  const lineColor: Record<TerminalLine['type'], string> = {
    output: '#cccccc',
    command: '#569cd6',
    error: '#f48771',
    info: '#888888',
    prompt: '#4ec9b0',
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const panelTabs: { id: PanelTab; label: string; badge?: number }[] = [
    { id: 'problems', label: 'Problems' },
    { id: 'output', label: 'Output' },
    { id: 'debug', label: 'Debug Console' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'ports', label: 'Ports' },
  ];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#1e1e1e', fontFamily: "'Cascadia Code', 'Consolas', monospace",
      borderTop: '1px solid #333',
    }}>

      {/* ── VS Code-style Tab Strip ── */}
      <div style={{
        display: 'flex', alignItems: 'center', height: '35px',
        background: '#252526', borderBottom: '1px solid #333',
        flexShrink: 0, paddingLeft: '4px',
      }}>
        {/* Left tabs: Problems | Output | Debug Console | Terminal | Ports */}
        <div style={{ display: 'flex', alignItems: 'stretch', height: '100%' }}>
          {panelTabs.map(tab => (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '0 14px', cursor: 'pointer', fontSize: '12px',
                color: activeTab === tab.id ? '#fff' : '#888',
                borderBottom: activeTab === tab.id ? '1px solid #007acc' : '1px solid transparent',
                userSelect: 'none',
                transition: 'color 0.1s',
              }}
              onMouseEnter={e => { if (activeTab !== tab.id) (e.currentTarget as HTMLElement).style.color = '#ccc'; }}
              onMouseLeave={e => { if (activeTab !== tab.id) (e.currentTarget as HTMLElement).style.color = '#888'; }}
            >
              {tab.id === 'problems' && <AlertCircle size={12} />}
              {tab.label}
            </div>
          ))}
        </div>

        {/* Right controls */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '2px', paddingRight: '8px' }}>
          <TermBtn onClick={addInstance} title="New Terminal (Ctrl+Shift+`)"><Plus size={14} /></TermBtn>
          <TermBtn onClick={() => {
            if (!activeInstance) return;
            setInstances(prev => prev.map(i => i.id !== activeInstance.id ? i : { ...i, lines: [] }));
          }} title="Clear Terminal"><Trash2 size={13} /></TermBtn>
          <div style={{ width: '1px', height: '16px', background: '#555', margin: '0 4px' }} />
          <TermBtn onClick={onMaximize} title="Maximize Panel"><Maximize2 size={13} /></TermBtn>
          <TermBtn onClick={onClose} title="Close Panel"><X size={14} /></TermBtn>
        </div>
      </div>

      {/* ── Content area ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* Non-terminal tabs: placeholder */}
        {activeTab !== 'terminal' ? (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#555', fontSize: '13px',
          }}>
            No {panelTabs.find(t => t.id === activeTab)?.label} output
          </div>
        ) : (
          <>
            {/* One scrollable area: lines + inline input prompt at bottom */}
              <div
                style={{ flex: 1, overflowY: 'auto', padding: '6px 12px', fontSize: `${fontSize}px`, cursor: 'text' }}
                onClick={() => inputRef.current?.focus()}
              >
                {(activeInstance?.lines ?? []).map(line => (
                  <div
                    key={line.id}
                    style={{
                      color: lineColor[line.type],
                      lineHeight: '1.5',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      minHeight: line.text === '' ? '0.8em' : undefined,
                    }}
                  >
                    {line.text}
                  </div>
                ))}

                {/* Inline prompt — sits right after last output line */}
                <div style={{ display: 'flex', alignItems: 'center', lineHeight: '1.5' }}>
                  <span style={{ color: '#4ec9b0', whiteSpace: 'nowrap', marginRight: '6px', userSelect: 'none', flexShrink: 0 }}>
                    PS {activeInstance?.cwd ?? cwd}&gt;
                  </span>
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isRunning}
                    style={{
                      flex: 1, background: 'transparent', border: 'none', outline: 'none',
                      color: isRunning ? '#666' : '#cccccc',
                      fontFamily: 'inherit', fontSize: 'inherit',
                      caretColor: '#fff', minWidth: 0,
                    }}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {isRunning && (
                    <span style={{ color: '#4ec9b0', fontSize: '11px', marginLeft: '8px', animation: 'pulse 1s infinite', flexShrink: 0 }}>
                      ●
                    </span>
                  )}
                </div>
                <div ref={bottomRef} />
              </div>

            {/* ── Instances sidebar ── */}
            <div style={{
              width: '154px', flexShrink: 0,
              borderLeft: '1px solid #333',
              overflowY: 'auto',
              background: '#252526',
            }}>
              {instances.map(inst => (
                <div
                  key={inst.id}
                  onClick={() => setActiveInstanceId(inst.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '6px 8px', cursor: 'pointer', fontSize: '12px',
                    background: inst.id === activeInstanceId ? '#37373d' : 'transparent',
                    color: inst.id === activeInstanceId ? '#fff' : '#888',
                    position: 'relative',
                    userSelect: 'none',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#2a2d2e'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = inst.id === activeInstanceId ? '#37373d' : 'transparent'; }}
                >
                  <TerminalIcon size={12} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {inst.name}
                  </span>
                  <button
                    onClick={e => killInstance(inst.id, e)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: '#888', padding: '0 2px', opacity: 0,
                      lineHeight: 1, display: 'flex',
                    }}
                    className="kill-inst-btn"
                    title="Kill Terminal"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ─── Small icon button ────────────────────────────────────────────────────────

function TermBtn({ children, onClick, title }: { children: React.ReactNode; onClick?: () => void; title?: string }) {
  return (
    <div
      onClick={onClick}
      title={title}
      style={{
        width: '24px', height: '24px', display: 'flex', alignItems: 'center',
        justifyContent: 'center', cursor: 'pointer', borderRadius: '4px',
        color: '#888',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = '#3c3c3c';
        (e.currentTarget as HTMLElement).style.color = '#fff';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
        (e.currentTarget as HTMLElement).style.color = '#888';
      }}
    >
      {children}
    </div>
  );
}

export default TerminalPanel;
