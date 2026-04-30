import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Search, Replace, X, ChevronDown, ChevronRight,
  CaseSensitive, Regex as RegexIcon, WholeWord,
  Loader2, FileCode2, AlertCircle,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchMatch {
  file_path: string;
  line_number: number;
  line_content: string;
  match_start: number;
  match_end: number;
}

interface FileMatches {
  filePath: string;
  fileName: string;
  matches: SearchMatch[];
}

interface SearchPanelProps {
  rootCwd: string;
  onOpenFileAtLine: (path: string, name: string, lineNumber: number, ext?: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

const SearchPanel: React.FC<SearchPanelProps> = ({ rootCwd, onOpenFileAtLine }) => {
  const [query, setQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [results, setResults] = useState<FileMatches[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [replaceStatus, setReplaceStatus] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim() || !rootCwd) {
      setResults([]);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const raw = await invoke<SearchMatch[]>('search_in_files', {
        dir: rootCwd,
        query: q,
        isRegex: useRegex,
        caseSensitive,
        wholeWord,
      });

      // Group by file
      const grouped: Record<string, FileMatches> = {};
      for (const m of raw) {
        if (!grouped[m.file_path]) {
          const name = m.file_path.split(/[/\\]/).pop() ?? m.file_path;
          grouped[m.file_path] = { filePath: m.file_path, fileName: name, matches: [] };
        }
        grouped[m.file_path].matches.push(m);
      }
      const fileList = Object.values(grouped);
      setResults(fileList);
      // Auto-expand all files
      const expanded: Record<string, boolean> = {};
      for (const f of fileList) expanded[f.filePath] = true;
      setExpandedFiles(expanded);
    } catch (e: any) {
      setError(`${e}`);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [rootCwd, caseSensitive, useRegex, wholeWord]);

  // Debounced search as user types
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 400);
    return () => clearTimeout(debounceRef.current);
  }, [query, runSearch]);

  const handleReplaceInFile = async (filePath: string, fileName: string) => {
    if (!replaceQuery && replaceQuery !== '') return;
    try {
      await invoke('replace_in_file', {
        path: filePath,
        oldText: query,
        newText: replaceQuery,
        isRegex: useRegex,
        caseSensitive,
      });
      setReplaceStatus(`✓ Replaced in ${fileName}`);
      setTimeout(() => setReplaceStatus(''), 3000);
      await runSearch(query);
    } catch (e) {
      setReplaceStatus(`Error: ${e}`);
    }
  };

  const handleReplaceAll = async () => {
    for (const f of results) {
      await handleReplaceInFile(f.filePath, f.fileName);
    }
  };

  const toggleFile = (path: string) =>
    setExpandedFiles(p => ({ ...p, [path]: !p[path] }));

  const totalMatches = results.reduce((acc, f) => acc + f.matches.length, 0);

  // Highlight match within a line
  const highlightLine = (line: string, start: number, end: number) => {
    const before = line.slice(0, start);
    const match = line.slice(start, end);
    const after = line.slice(end);
    // Trim long lines
    const maxLen = 80;
    const trimStart = Math.max(0, start - 30);
    const displayBefore = (trimStart > 0 ? '…' : '') + before.slice(trimStart);
    const displayAfter = after.slice(0, maxLen - end);
    return { displayBefore, match, displayAfter };
  };

  return (
    <div className="search-panel">
      {/* Search input row */}
      <div className="search-input-area">
        <div className="search-toggle-btn" onClick={() => setShowReplace(r => !r)} title="Toggle Replace">
          {showReplace ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        <div style={{ flex: 1 }}>
          {/* Query row */}
          <div className="search-row">
            <div className="search-input-wrap">
              <Search size={13} style={{ flexShrink: 0, opacity: 0.5 }} />
              <input
                autoFocus
                className="search-input"
                placeholder="Search…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') runSearch(query); }}
              />
              {query && (
                <button className="search-clear-btn" onClick={() => { setQuery(''); setResults([]); }}>
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="search-toggles">
              <ToggleBtn active={caseSensitive} onClick={() => setCaseSensitive(v => !v)} title="Match Case (Alt+C)">
                <CaseSensitive size={13} />
              </ToggleBtn>
              <ToggleBtn active={wholeWord} onClick={() => setWholeWord(v => !v)} title="Match Whole Word (Alt+W)">
                <WholeWord size={13} />
              </ToggleBtn>
              <ToggleBtn active={useRegex} onClick={() => setUseRegex(v => !v)} title="Use Regular Expression (Alt+R)">
                <RegexIcon size={13} />
              </ToggleBtn>
            </div>
          </div>

          {/* Replace row */}
          {showReplace && (
            <div className="search-row" style={{ marginTop: '4px' }}>
              <div className="search-input-wrap">
                <Replace size={13} style={{ flexShrink: 0, opacity: 0.5 }} />
                <input
                  className="search-input"
                  placeholder="Replace…"
                  value={replaceQuery}
                  onChange={e => setReplaceQuery(e.target.value)}
                />
              </div>
              <div className="search-toggles">
                <button
                  className="search-replace-btn"
                  onClick={handleReplaceAll}
                  title="Replace All"
                  disabled={!query || results.length === 0}
                >
                  Replace All
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      {replaceStatus && (
        <div className="search-status">{replaceStatus}</div>
      )}
      {error && (
        <div className="search-error">
          <AlertCircle size={12} /> {error}
        </div>
      )}
      {!loading && query && results.length > 0 && (
        <div className="search-summary">
          {totalMatches} result{totalMatches !== 1 ? 's' : ''} in {results.length} file{results.length !== 1 ? 's' : ''}
        </div>
      )}
      {loading && (
        <div className="search-summary">
          <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Searching…
        </div>
      )}
      {!loading && query && results.length === 0 && !error && (
        <div className="search-summary">No results found</div>
      )}

      {/* Results */}
      <div className="search-results">
        {results.map(file => {
          const isExpanded = expandedFiles[file.filePath] !== false;
          const ext = file.fileName.includes('.') ? file.fileName.split('.').pop() : undefined;
          return (
            <div key={file.filePath} className="search-file-group">
              <div className="search-file-header" onClick={() => toggleFile(file.filePath)}>
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <FileCode2 size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
                <span className="search-file-name">{file.fileName}</span>
                <span className="search-file-path">
                  {file.filePath.replace(file.fileName, '').slice(0, -1)}
                </span>
                <span className="search-match-badge">{file.matches.length}</span>
                {showReplace && (
                  <button
                    className="search-replace-file-btn"
                    onClick={e => { e.stopPropagation(); handleReplaceInFile(file.filePath, file.fileName); }}
                    title={`Replace in ${file.fileName}`}
                  >
                    <Replace size={11} />
                  </button>
                )}
              </div>
              {isExpanded && file.matches.map((m, i) => {
                const { displayBefore, match, displayAfter } = highlightLine(
                  m.line_content.trim(), m.match_start, m.match_end
                );
                return (
                  <div
                    key={i}
                    className="search-match-row"
                    onClick={() => onOpenFileAtLine(file.filePath, file.fileName, m.line_number, ext)}
                    title={`Line ${m.line_number}`}
                  >
                    <span className="search-line-num">{m.line_number}</span>
                    <span className="search-line-content">
                      <span>{displayBefore}</span>
                      <mark className="search-highlight">{match}</mark>
                      <span>{displayAfter}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

function ToggleBtn({ children, active, onClick, title }: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: active ? 'rgba(0,122,204,0.3)' : 'none',
        border: active ? '1px solid rgba(0,122,204,0.5)' : '1px solid transparent',
        borderRadius: '3px', padding: '2px 4px', cursor: 'pointer',
        color: active ? '#007acc' : 'var(--vscode-text)', opacity: active ? 1 : 0.6,
        display: 'flex', alignItems: 'center', transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}

export default SearchPanel;
