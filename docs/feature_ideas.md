# IDE Feature Ideas for Local Cortex

To elevate Local Cortex from a basic code viewer/chat tool into a professional, daily-driver IDE (similar to VS Code or Cursor), here are the key user-facing components and features you should add.

## 1. Source Control (Git) Panel
A real editor needs native version control.
- **Dedicated Sidebar Tab**: A source control view showing modified, added, and deleted files.
- **Inline Git Actions**: Buttons to Stage, Commit, Push, and Pull.
- **Editor Gutter Indicators**: Visual markers next to the line numbers in Monaco showing which lines have been added (green), modified (blue), or deleted (red).
- **Diff Viewer**: Clicking a modified file opens a split-pane "Diff Editor" to compare changes before committing.

## 2. Global Search & Replace
Currently, you have a file name search. You need content search.
- **Search Panel (`Ctrl+Shift+F`)**: A sidebar panel to search for text across the entire workspace.
- **Regex and Case-Sensitivity**: Toggles for regex matching, whole words, and case-sensitivity.
- **Global Replace**: The ability to replace terms across multiple files simultaneously with a preview of the changes.

## 3. Advanced AI Code Editing (Cursor-Style)
Instead of just a chat panel, integrate AI directly into the code.
- **Inline Generation (`Ctrl+K`)**: A floating input box directly inside the Monaco editor. You type "add error handling here", and the AI generates code inline.
- **AI Autocomplete (Ghost Text)**: As the user types, the local LLM predicts the rest of the line or function in grey "ghost text" that can be accepted with `Tab`.
- **Diff Accept/Reject**: When the AI edits a file, show a red/green diff view with "Accept" and "Reject" buttons.

## 4. Comprehensive Bottom Panel
Currently, the terminal is a toggle. A real IDE uses a robust bottom panel.
- **Multi-Tab Bottom Panel**: Move the terminal here and add additional tabs:
  - **Terminal**: Support for multiple terminal instances (+ button).
  - **Problems**: Parse output for syntax errors and display them in a list.
  - **Output**: Logs from the Local Cortex backend (indexing progress, AI model loading).
- **Collapsible/Draggable**: Easily drag it up from the bottom of the screen.

## 5. Status Bar
A small bar at the very bottom of the window provides essential context.
- **Left Side**: Current Git branch, indexing status, sync status.
- **Right Side**: Line/Column numbers, Tab spacing (e.g., "Spaces: 2"), Encoding (UTF-8), and Language Mode (TypeScript).

## 6. Breadcrumbs and Split Editors
- **Breadcrumbs**: A navigation bar just above the text editor showing the file path (e.g., `src > components > EditorView.tsx`). Clicking a folder in the breadcrumb opens a dropdown of sibling files.
- **Split Panes**: The ability to open files side-by-side or top-and-bottom. Essential for referencing one file while editing another.

## 7. Markdown & Image Previews
- **Markdown Preview**: A toggle to render `.md` files in a split pane, showing live updates as you type.
- **Media Viewer**: If the user clicks a `.png` or `.svg` in the file tree, render the image in the editor area instead of showing an "Unsupported format" text view.

## 8. Outline / Symbol Explorer
- **Outline Sidebar Tab**: A panel below the file tree that lists the classes, functions, and variables in the currently active file. Clicking one jumps the editor to that line.

---

### Suggested Implementation Order
If you want to start building these out, I recommend this order for maximum impact:
1. **Status Bar & Bottom Panel (Terminal)**: Easy to implement and instantly makes it look like an IDE.
2. **Global Search**: Highly requested utility for any codebase.
3. **Inline AI Generation (`Ctrl+K`)**: Differentiates your IDE from just a text editor + chat box.
4. **Git Integration**: Complex, but strictly necessary for daily use.
