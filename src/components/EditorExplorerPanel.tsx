import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FolderOpen, RotateCw, Search, Folder, FileCode2, FileJson, FileType } from 'lucide-react';
import type { FileNode } from './EditorView';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FILE_ICON_COLORS: Record<string, string> = {
  ts: '#519aba', tsx: '#519aba', js: '#cbcb41', jsx: '#cbcb41',
  json: '#cbcb41', py: '#3572A5', rs: '#dea584', css: '#563d7c',
  html: '#e34c26', md: '#888', yaml: '#cb171e', yml: '#cb171e',
};

export function FileIcon({ ext, isDir }: { ext?: string; isDir: boolean }) {
  const color = FILE_ICON_COLORS[ext ?? ''] ?? '#858585';
  if (isDir) return <Folder size={14} color="#c09553" />;
  switch (ext) {
    case 'ts': case 'tsx': case 'js': case 'jsx': return <FileCode2 size={14} color={color} />;
    case 'json': return <FileJson size={14} color={color} />;
    default: return <FileType size={14} color={color} />;
  }
}

// ─── FileTree Node ───────────────────────────────────────────────────────────

export function FileTreeNode({
  node, depth, onFileClick, activeFilePath, searchQuery,
}: {
  node: FileNode; depth: number;
  onFileClick: (node: FileNode) => void;
  activeFilePath: string; searchQuery: string;
}) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const isActive = node.path === activeFilePath;
  const matchesSearch = !searchQuery ||
    node.name.toLowerCase().includes(searchQuery.toLowerCase());

  if (!matchesSearch && !node.is_dir) return null;

  return (
    <div>
      <div
        className={`file-item ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={() => {
          if (node.is_dir) setIsExpanded(e => !e);
          else onFileClick(node);
        }}
      >
        {node.is_dir && (
          isExpanded
            ? <ChevronDown size={12} style={{ flexShrink: 0 }} />
            : <ChevronRight size={12} style={{ flexShrink: 0 }} />
        )}
        <FileIcon ext={node.extension} isDir={node.is_dir} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.name}
        </span>
      </div>
      {node.is_dir && isExpanded && node.children && (
        <div>
          {node.children.map(child => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileClick={onFileClick}
              activeFilePath={activeFilePath}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Panel Component ─────────────────────────────────────────────────────────

interface EditorExplorerPanelProps {
  rootName: string;
  rootCwd: string;
  fileTree: FileNode[];
  fileSearch: string;
  setFileSearch: (s: string) => void;
  activeFilePath: string;
  onOpenFolder: () => void;
  onRefreshTree: () => void;
  onFileClick: (node: FileNode) => void;
}

const EditorExplorerPanel: React.FC<EditorExplorerPanelProps> = ({
  rootName,
  rootCwd,
  fileTree,
  fileSearch,
  setFileSearch,
  activeFilePath,
  onOpenFolder,
  onRefreshTree,
  onFileClick,
}) => {
  return (
    <>
      <div className="editor-sidebar-header" style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', padding: '10px 12px 10px 20px',
      }}>
        <span style={{ opacity: 0.7, fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Explorer
        </span>
        <button onClick={onOpenFolder} title="Open Folder"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-text)', opacity: 0.7, padding: '2px' }}>
          <FolderOpen size={16} />
        </button>
        {rootCwd && (
          <button onClick={onRefreshTree} title="Refresh Explorer"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-text)', opacity: 0.7, padding: '2px' }}>
            <RotateCw size={14} />
          </button>
        )}
      </div>

      <div className="editor-search">
        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--vscode-input)', border: '1px solid var(--vscode-border)', padding: '2px 6px' }}>
          <Search size={12} color="var(--vscode-text)" style={{ opacity: 0.5, marginRight: '4px', flexShrink: 0 }} />
          <input
            placeholder="Search files…"
            value={fileSearch}
            onChange={e => setFileSearch(e.target.value)}
            style={{ background: 'transparent', border: 'none', color: 'var(--vscode-text)', fontSize: '12px', outline: 'none', width: '100%' }}
          />
        </div>
      </div>

      <div className="file-tree">
        <div className="file-item" style={{ color: 'var(--vscode-text)', fontWeight: 'bold', opacity: 0.8, paddingLeft: '12px' }}>
          <ChevronDown size={14} /> {rootName}
        </div>
        {fileTree.length === 0 ? (
          rootCwd ? (
            <div style={{ padding: '16px 20px', fontSize: '12px', color: 'var(--vscode-text)', opacity: 0.5, lineHeight: 1.6 }}>
              Folder is empty.<br />
              <span style={{ color: 'var(--vscode-accent)', cursor: 'pointer' }} onClick={onRefreshTree}>Click to Refresh</span>
            </div>
          ) : (
            <div onClick={onOpenFolder}
              style={{ padding: '16px 20px', fontSize: '12px', color: 'var(--vscode-text)', opacity: 0.5, cursor: 'pointer', lineHeight: 1.6 }}>
              No folder open.<br />
              <span style={{ color: 'var(--vscode-accent)' }}>Click to Open Folder</span>
            </div>
          )
        ) : (
          fileTree.map(node => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={1}
              onFileClick={onFileClick}
              activeFilePath={activeFilePath}
              searchQuery={fileSearch}
            />
          ))
        )}
      </div>
    </>
  );
};

export default EditorExplorerPanel;
