import React from 'react';
import { GitBranch, AlertCircle, CheckCircle2, Loader2, Globe } from 'lucide-react';

interface StatusBarProps {
  language?: string;
  lineNumber?: number;
  column?: number;
  tabSize?: number;
  encoding?: string;
  gitBranch?: string;
  gitDirtyCount?: number;
  indexChunks?: number;
  indexing?: boolean;
  activeFileName?: string;
  onClickLanguage?: () => void;
  onClickTabSize?: () => void;
  isLiveServerEnabled?: boolean;
  onStartLiveServer?: () => void;
}

const StatusBar: React.FC<StatusBarProps> = ({
  language = 'Plain Text',
  lineNumber = 1,
  column = 1,
  tabSize = 2,
  encoding = 'UTF-8',
  gitBranch,
  gitDirtyCount = 0,
  indexChunks = 0,
  indexing = false,
  activeFileName,
  onClickLanguage,
  onClickTabSize,
  isLiveServerEnabled = false,
  onStartLiveServer,
}) => {
  return (
    <div className="status-bar">
      {/* ── Left side ── */}
      <div className="status-bar-left">
        {gitBranch && (
          <StatusItem
            title={`Branch: ${gitBranch}`}
            className="status-item status-item-git"
          >
            <GitBranch size={11} />
            <span>{gitBranch}</span>
            {gitDirtyCount > 0 && (
              <span className="status-git-dirty">
                <AlertCircle size={10} />
                {gitDirtyCount}
              </span>
            )}
          </StatusItem>
        )}

        {!gitBranch && (
          <StatusItem title="No git repository" className="status-item">
            <span style={{ opacity: 0.4 }}>No Git</span>
          </StatusItem>
        )}

        {/* Indexing status */}
        {indexing && (
          <StatusItem title="Indexing workspace…" className="status-item status-item-indexing">
            <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
            <span>Indexing…</span>
          </StatusItem>
        )}
        {!indexing && indexChunks > 0 && (
          <StatusItem title={`${indexChunks.toLocaleString()} indexed chunks`} className="status-item">
            <CheckCircle2 size={10} style={{ color: '#4caf50' }} />
            <span>{indexChunks.toLocaleString()} chunks</span>
          </StatusItem>
        )}
      </div>

      {/* ── Center ── */}
      <div className="status-bar-center">
        {activeFileName && (
          <span style={{ opacity: 0.5, fontSize: '11px' }}>{activeFileName}</span>
        )}
      </div>

      {/* ── Right side ── */}
      <div className="status-bar-right">
        {isLiveServerEnabled && language === 'html' && (
          <StatusItem
            title="Go Live (Start Local Server)"
            className="status-item clickable"
            onClick={onStartLiveServer}
          >
            <Globe size={11} color="#4caf50" />
            <span style={{ color: '#4caf50', fontWeight: 'bold' }}>Go Live</span>
          </StatusItem>
        )}

        <StatusItem title={`Ln ${lineNumber}, Col ${column}`} className="status-item">
          <span>Ln {lineNumber}, Col {column}</span>
        </StatusItem>

        <StatusItem
          title={`Spaces: ${tabSize} — Click to change`}
          className="status-item clickable"
          onClick={onClickTabSize}
        >
          <span>Spaces: {tabSize}</span>
        </StatusItem>

        <StatusItem title="File encoding" className="status-item">
          <span>{encoding}</span>
        </StatusItem>

        <StatusItem
          title={`Language: ${language} — Click to change`}
          className="status-item clickable"
          onClick={onClickLanguage}
        >
          <span>{language}</span>
        </StatusItem>

        <StatusItem title="Local Cortex" className="status-item status-item-brand">
          <span>⬡ Local Cortex</span>
        </StatusItem>
      </div>
    </div>
  );
};

function StatusItem({
  children,
  title,
  className,
  onClick,
}: {
  children: React.ReactNode;
  title?: string;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={className ?? 'status-item'}
      title={title}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      {children}
    </div>
  );
}

export default StatusBar;
