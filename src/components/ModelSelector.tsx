import React, { useState, useRef, useEffect } from 'react';
import { Plus, ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface DiscoveredModel {
  id: string;
  name: string;
  category: string;
  model_type: string;
  size: string | null;
  source: string;
}

interface ModelSelectorProps {
  currentModel: string;
  onSelect: (model: string) => void;
  iconOnly?: boolean;
  direction?: 'up' | 'down';
}

// Category display order
const CATEGORY_ORDER = [
  'Ollama LLMs',
  'Ollama Code Models',
  'Ollama Embedding Models',
  'Hugging Face Models',
  'Keras Models',
];

const SOURCE_COLORS: Record<string, string> = {
  ollama: '#007acc',
  huggingface: '#ff9d00',
  keras: '#d00000',
};

const ModelSelector: React.FC<ModelSelectorProps> = ({
  currentModel,
  onSelect,
  iconOnly = false,
  direction = 'down',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load models on mount so the current model name resolves immediately
  useEffect(() => {
    invoke<DiscoveredModel[]>('list_models')
      .then(setModels)
      .catch(() => {});
  }, []);

  const loadModels = async () => {
    setIsOpen(prev => !prev);
    // If we already have models, just toggle — don't re-fetch
    if (models.length > 0) return;
    setLoading(true);
    try {
      const result = await invoke<DiscoveredModel[]>('list_models');
      setModels(result);
    } catch (e) {
      console.error('Failed to load models:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setModels([]);
    setLoading(true);
    try {
      const result = await invoke<DiscoveredModel[]>('list_models');
      setModels(result);
    } catch (e) {
      console.error('Failed to refresh models:', e);
    } finally {
      setLoading(false);
    }
  };

  const filteredModels = models.filter(m =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group by category
  const grouped = CATEGORY_ORDER.reduce<Record<string, DiscoveredModel[]>>((acc, cat) => {
    const items = filteredModels.filter(m => m.category === cat);
    if (items.length > 0) acc[cat] = items;
    return acc;
  }, {});

  // Add any categories not in our order list
  filteredModels.forEach(m => {
    if (!CATEGORY_ORDER.includes(m.category)) {
      if (!grouped[m.category]) grouped[m.category] = [];
      if (!grouped[m.category].find(x => x.id === m.id)) {
        grouped[m.category].push(m);
      }
    }
  });

  const currentModelObj = models.find(m => m.id === currentModel);
  const displayName = currentModelObj?.name ?? currentModel;

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <div
        className="model-selector-btn"
        onClick={loadModels}
        title="Select Model"
      >
        {iconOnly ? (
          loading ? <Loader2 size={16} className="spin" /> : <Plus size={16} />
        ) : (
          <>
            <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
            </span>
            {loading ? <Loader2 size={14} className="spin" /> : <ChevronDown size={14} />}
          </>
        )}
      </div>

      {isOpen && (
        <div
          className="popover-container"
          style={{
            top: direction === 'down' ? '100%' : 'auto',
            bottom: direction === 'up' ? '100%' : 'auto',
            right: iconOnly ? 0 : 'auto',
            left: iconOnly ? 'auto' : 0,
            marginTop: direction === 'down' ? '4px' : 0,
            marginBottom: direction === 'up' ? '4px' : 0,
            width: '280px',
            maxHeight: '400px',
            overflowY: 'auto',
          }}
        >
          {/* Popover header: search + refresh */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--modal-border)', display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              autoFocus
              placeholder="Search models..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onClick={e => e.stopPropagation()}
              style={{
                flex: 1,
                background: 'var(--vscode-input)',
                border: '1px solid var(--vscode-border)',
                color: 'var(--vscode-text)',
                padding: '4px 8px',
                fontSize: '12px',
                outline: 'none',
                borderRadius: '4px',
              }}
            />
            <button
              onClick={handleRefresh}
              title="Refresh model list"
              disabled={loading}
              style={{
                background: 'none',
                border: 'none',
                cursor: loading ? 'default' : 'pointer',
                color: 'var(--vscode-text)',
                opacity: loading ? 0.4 : 0.7,
                padding: '2px 4px',
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <RefreshCw size={13} className={loading ? 'spin' : ''} />
            </button>
          </div>

          {loading ? (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--vscode-text)', opacity: 0.6, fontSize: '13px' }}>
              Scanning installed models...
            </div>
          ) : Object.keys(grouped).length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--vscode-text)', opacity: 0.6, fontSize: '13px' }}>
              No models found. Is Ollama running?
            </div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <div style={{
                  padding: '8px 12px 4px',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  color: 'var(--vscode-text)',
                  opacity: 0.5,
                  borderTop: '1px solid var(--modal-border)',
                }}>
                  {category}
                </div>
                {items.map(model => (
                  <div
                    key={model.id}
                    className="popover-item"
                    onClick={() => { onSelect(model.id); setIsOpen(false); }}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontWeight: currentModel === model.id ? 'bold' : 'normal',
                      whiteSpace: 'nowrap',
                      gap: '8px',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                      {currentModel === model.id ? '✓ ' : ''}{model.name}
                    </span>
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      <span style={{
                        fontSize: '10px',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        background: SOURCE_COLORS[model.source] ?? '#555',
                        color: '#fff',
                      }}>
                        {model.model_type}
                      </span>
                      {model.size && (
                        <span style={{ fontSize: '10px', opacity: 0.6 }}>{model.size}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
