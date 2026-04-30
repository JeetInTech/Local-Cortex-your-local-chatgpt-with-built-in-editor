import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, X, Check, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InlineAIWidgetProps {
  visible: boolean;
  lineNumber: number;
  fileContent: string;
  fileName: string;
  language: string;
  model: string;
  onAccept: (newContent: string) => void;
  onDismiss: () => void;
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

const InlineAIWidget: React.FC<InlineAIWidgetProps> = ({
  visible,
  lineNumber,
  fileContent,
  fileName,
  language,
  model,
  onAccept,
  onDismiss,
}) => {
  const [instruction, setInstruction] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      setInstruction('');
      setResult('');
      setShowDiff(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  const handleGenerate = useCallback(async () => {
    if (!instruction.trim() || generating) return;
    setGenerating(true);
    setResult('');
    setShowDiff(false);

    const lines = fileContent.split('\n');
    const contextStart = Math.max(0, lineNumber - 20);
    const contextEnd = Math.min(lines.length, lineNumber + 20);
    const contextLines = lines.slice(contextStart, contextEnd).join('\n');

    const systemPrompt = `You are an expert ${language} developer inside "Local Cortex" IDE.
The user has the file "${fileName}" open. They want to edit around line ${lineNumber}.

Current file context (lines ${contextStart + 1}–${contextEnd}):
\`\`\`${language}
${contextLines}
\`\`\`

Their instruction: "${instruction}"

Respond ONLY with the complete modified file content (no explanations, no markdown fences). Preserve all code outside the edit scope exactly.`;

    const messages = [
      { role: 'user', content: systemPrompt },
    ];

    const streamId = generateId();
    let accumulated = '';

    const unlistenStream = await listen<string>(`chat-stream-${streamId}`, (event) => {
      accumulated += event.payload;
      setResult(accumulated);
    });

    const unlistenDone = await listen(`chat-stream-done-${streamId}`, () => {
      setGenerating(false);
      setShowDiff(true);
      unlistenStream();
      unlistenDone();
    });

    try {
      await invoke('generate_response', { streamId, model, messages });
    } catch (error) {
      setGenerating(false);
      setResult(`Error: ${error}`);
      unlistenStream();
      unlistenDone();
    }
  }, [instruction, generating, fileContent, fileName, language, lineNumber, model]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); }
    if (e.key === 'Escape') onDismiss();
  };

  if (!visible) return null;

  // Clean result — strip markdown fences if the model wrapped it
  const cleanResult = result
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();

  // Diff: compute added/removed lines for preview
  const originalLines = fileContent.split('\n');
  const newLines = cleanResult.split('\n');

  return (
    <div className="inline-ai-widget" style={{ position: 'absolute', zIndex: 50, inset: 0, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'all',
          width: 'min(680px, 90%)',
          background: 'var(--modal-bg)',
          border: '1px solid var(--modal-border)',
          borderRadius: '10px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          maxHeight: '70vh',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '10px 14px', borderBottom: '1px solid var(--modal-border)',
          background: 'rgba(124,124,255,0.06)',
          flexShrink: 0,
        }}>
          <Sparkles size={14} style={{ color: '#7c7cff' }} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#7c7cff' }}>
            Inline AI Edit — Line {lineNumber}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onDismiss}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-text)', opacity: 0.5, display: 'flex' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Instruction input */}
        <div style={{ padding: '12px 14px', display: 'flex', gap: '8px', flexShrink: 0 }}>
          <input
            ref={inputRef}
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your edit (e.g. 'add error handling', 'convert to async/await')…"
            disabled={generating}
            style={{
              flex: 1, background: 'var(--vscode-input)', border: '1px solid var(--vscode-border)',
              borderRadius: '6px', padding: '8px 12px', color: 'var(--vscode-text)',
              fontSize: '13px', outline: 'none',
            }}
          />
          <button
            onClick={handleGenerate}
            disabled={!instruction.trim() || generating}
            style={{
              background: instruction.trim() && !generating ? '#7c7cff' : '#333',
              border: 'none', borderRadius: '6px', padding: '8px 16px',
              color: instruction.trim() && !generating ? '#fff' : '#555',
              cursor: instruction.trim() && !generating ? 'pointer' : 'not-allowed',
              fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px',
              transition: 'all 0.2s', flexShrink: 0,
            }}
          >
            {generating ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={13} />}
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>

        {/* Result / diff preview */}
        {(generating || result) && (
          <div style={{
            flex: 1, overflowY: 'auto', borderTop: '1px solid var(--modal-border)',
            minHeight: 0,
          }}>
            {generating && !result && (
              <div style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--vscode-text)', opacity: 0.6 }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                Generating edit…
              </div>
            )}

            {result && (
              <div style={{ padding: '0' }}>
                {/* Diff toggle header */}
                <div style={{
                  display: 'flex', alignItems: 'center', padding: '6px 14px',
                  background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--modal-border)',
                  fontSize: '11px', color: 'var(--vscode-text)', opacity: 0.7,
                  gap: '8px',
                }}>
                  <span>Preview — {newLines.length} lines</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ color: '#4caf50' }}>+{newLines.length}</span>
                  <span style={{ color: '#f44336' }}>-{originalLines.length}</span>
                </div>

                {/* Diff lines preview */}
                <div style={{
                  fontFamily: "'Cascadia Code', monospace",
                  fontSize: '12px', lineHeight: '1.5',
                  maxHeight: '300px', overflowY: 'auto',
                }}>
                  {newLines.slice(0, 60).map((line, i) => {
                    const origLine = originalLines[i];
                    const isAdded = origLine === undefined || origLine !== line;
                    return (
                      <div
                        key={i}
                        style={{
                          padding: '1px 14px',
                          background: isAdded ? 'rgba(76,175,80,0.08)' : 'transparent',
                          borderLeft: isAdded ? '3px solid #4caf5055' : '3px solid transparent',
                          color: isAdded ? '#a8d8a8' : 'var(--vscode-text)',
                          whiteSpace: 'pre',
                        }}
                      >
                        <span style={{ opacity: 0.3, userSelect: 'none', marginRight: '8px', minWidth: '3ch', display: 'inline-block' }}>
                          {i + 1}
                        </span>
                        {line}
                      </div>
                    );
                  })}
                  {newLines.length > 60 && (
                    <div style={{ padding: '4px 14px', opacity: 0.4, fontSize: '11px' }}>
                      …{newLines.length - 60} more lines
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Accept / Reject buttons */}
        {showDiff && cleanResult && (
          <div style={{
            display: 'flex', gap: '8px', padding: '10px 14px',
            borderTop: '1px solid var(--modal-border)', flexShrink: 0,
            background: 'rgba(0,0,0,0.1)',
          }}>
            <button
              onClick={() => { onAccept(cleanResult); onDismiss(); }}
              style={{
                background: 'rgba(76,175,80,0.15)', border: '1px solid #4caf5055',
                color: '#4caf50', borderRadius: '6px', padding: '6px 18px',
                cursor: 'pointer', fontWeight: 600, fontSize: '13px',
                display: 'flex', alignItems: 'center', gap: '6px',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(76,175,80,0.25)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(76,175,80,0.15)'}
            >
              <Check size={13} /> Accept
            </button>
            <button
              onClick={() => { setResult(''); setShowDiff(false); setInstruction(''); }}
              style={{
                background: 'rgba(244,67,54,0.12)', border: '1px solid #f4433655',
                color: '#f44336', borderRadius: '6px', padding: '6px 18px',
                cursor: 'pointer', fontWeight: 600, fontSize: '13px',
                display: 'flex', alignItems: 'center', gap: '6px',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(244,67,54,0.22)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(244,67,54,0.12)'}
            >
              <X size={13} /> Discard
            </button>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: '11px', color: 'var(--vscode-text)', opacity: 0.4, alignSelf: 'center' }}>
              Esc to dismiss
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default InlineAIWidget;
