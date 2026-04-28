import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal as TerminalIcon, X, Trash2, ChevronRight } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface TerminalLine {
  id: string;
  text: string;
  type: 'output' | 'input' | 'error' | 'info';
}

interface TerminalPanelProps {
  cwd: string;
  fontSize: number;
  onClose: () => void;
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Strip ANSI escape codes for display (basic)
function stripAnsi(str: string): { text: string; isError: boolean } {
  const isError = str.includes('\x1b[31m');
  const clean = str.replace(/\x1b\[[0-9;]*m/g, '');
  return { text: clean, isError };
}

const TerminalPanel: React.FC<TerminalPanelProps> = ({ cwd, fontSize, onClose }) => {
  const [lines, setLines] = useState<TerminalLine[]>([
    { id: '0', text: `Local Cortex Terminal  —  ${cwd}`, type: 'info' },
    { id: '1', text: 'Type a command and press Enter.', type: 'info' },
  ]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [currentCwd, setCurrentCwd] = useState(cwd);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const addLine = (text: string, type: TerminalLine['type']) => {
    setLines(prev => [...prev, { id: generateId(), text, type }]);
  };

  const handleCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    addLine(`${currentCwd}> ${trimmed}`, 'input');
    setHistory(prev => [trimmed, ...prev.slice(0, 49)]);
    setHistoryIdx(-1);
    setInput('');
    setIsRunning(true);

    // Handle built-in cd
    if (trimmed.startsWith('cd ') || trimmed === 'cd') {
      const target = trimmed.slice(3).trim() || cwd;
      try {
        // validate directory exists by reading it
        await invoke('read_directory', { path: target });
        setCurrentCwd(target);
        addLine(`Changed directory to: ${target}`, 'info');
      } catch {
        addLine(`cd: no such directory: ${target}`, 'error');
      }
      setIsRunning(false);
      return;
    }

    if (trimmed === 'clear' || trimmed === 'cls') {
      setLines([{ id: generateId(), text: `${currentCwd}`, type: 'info' }]);
      setIsRunning(false);
      return;
    }

    const streamId = generateId();

    const unlistenOut = await listen<string>(`terminal-out-${streamId}`, (event) => {
      const { text, isError } = stripAnsi(event.payload);
      addLine(text, isError ? 'error' : 'output');
    });

    const unlistenDone = await listen<number>(`terminal-done-${streamId}`, (event) => {
      const code = event.payload;
      if (code !== 0) {
        addLine(`Process exited with code ${code}`, 'error');
      }
      setIsRunning(false);
      unlistenOut();
      unlistenDone();
    });

    try {
      await invoke('run_terminal_command', {
        streamId,
        command: trimmed,
        cwd: currentCwd,
      });
    } catch (err) {
      addLine(`Error: ${err}`, 'error');
      setIsRunning(false);
      unlistenOut();
      unlistenDone();
    }
  }, [currentCwd, cwd]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCommand(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const nextIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(nextIdx);
      setInput(history[nextIdx] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(nextIdx);
      setInput(nextIdx === -1 ? '' : history[nextIdx]);
    }
  };

  const lineColor: Record<TerminalLine['type'], string> = {
    output: 'var(--vscode-text)',
    input: '#569cd6',
    error: '#f48771',
    info: '#4ec9b0',
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#0d0d0d',
      borderTop: '1px solid var(--vscode-border)',
      fontFamily: 'var(--font-mono)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '4px 12px',
        background: '#1a1a1a', borderBottom: '1px solid #333',
        fontSize: '12px', color: '#aaa', gap: '8px', flexShrink: 0,
      }}>
        <TerminalIcon size={13} />
        <span style={{ flex: 1, fontWeight: 'bold' }}>TERMINAL</span>
        <span style={{ opacity: 0.5, fontSize: '11px', flex: 1 }}>{currentCwd}</span>
        {isRunning && (
          <span style={{ color: '#4ec9b0', fontSize: '11px' }}>● Running</span>
        )}
        <button onClick={() => setLines([{ id: generateId(), text: currentCwd, type: 'info' }])}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: '2px' }}
          title="Clear terminal">
          <Trash2 size={13} />
        </button>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: '2px' }}
          title="Close terminal">
          <X size={13} />
        </button>
      </div>

      {/* Output */}
      <div
        style={{ flex: 1, overflowY: 'auto', padding: '8px 16px', fontSize: `${Math.max(11, fontSize - 2)}px` }}
        onClick={() => inputRef.current?.focus()}
      >
        {lines.map(line => (
          <div key={line.id} style={{ color: lineColor[line.type], lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '6px 12px',
        background: '#1a1a1a', borderTop: '1px solid #333', flexShrink: 0,
      }}>
        <ChevronRight size={13} color="#569cd6" style={{ marginRight: '6px', flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
          placeholder={isRunning ? 'Running…' : 'Enter command…'}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#569cd6',
            fontFamily: 'var(--font-mono)',
            fontSize: `${Math.max(11, fontSize - 2)}px`,
          }}
        />
      </div>
    </div>
  );
};

export default TerminalPanel;
