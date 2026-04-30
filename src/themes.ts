// Minimalist version of popular themes for Monaco Editor

export const BeardedTheme = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { background: '1A1C23' },
    { token: 'comment', foreground: '6b7394', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c586c0' },
    { token: 'string', foreground: 'ce9178' },
    { token: 'number', foreground: 'b5cea8' },
    { token: 'type', foreground: '4ec9b0' },
    { token: 'function', foreground: 'dcdcaa' },
    { token: 'variable', foreground: '9cdcfe' },
  ],
  colors: {
    'editor.background': '#1A1C23',
    'editor.foreground': '#D4D4D4',
    'editorCursor.foreground': '#f36',
    'editor.lineHighlightBackground': '#242732',
    'editorLineNumber.foreground': '#54586B',
    'editorIndentGuide.background': '#242732',
    'editorIndentGuide.activeBackground': '#3a3f55',
  }
};

export const GitHubDarkTheme = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { background: '0d1117' },
    { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ff7b72' },
    { token: 'string', foreground: 'a5d6ff' },
    { token: 'number', foreground: '79c0ff' },
    { token: 'type', foreground: 'ff7b72' },
    { token: 'function', foreground: 'd2a8ff' },
    { token: 'variable', foreground: 'c9d1d9' },
  ],
  colors: {
    'editor.background': '#0d1117',
    'editor.foreground': '#c9d1d9',
    'editorCursor.foreground': '#58a6ff',
    'editor.lineHighlightBackground': '#161b22',
    'editorLineNumber.foreground': '#484f58',
    'editorIndentGuide.background': '#21262d',
    'editorIndentGuide.activeBackground': '#484f58',
  }
};
