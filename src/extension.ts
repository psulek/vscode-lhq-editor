// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// Sample data for the TreeView
const sampleLhqData = {
  "project": {
    "name": "My LHQ Project",
    "version": "1.0.0",
    "folders": [
      {
        "name": "src",
        "files": [
          { "name": "main.lhq" },
          { "name": "utils.lhq" }
        ]
      },
      {
        "name": "docs",
        "files": [
          { "name": "readme.md" }
        ]
      }
    ]
  }
};

class LhqTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private currentData: any = null;
  private currentDocument: vscode.TextDocument | null = null;

  constructor() {}

  public updateDocument(document: vscode.TextDocument | null) {
    this.currentDocument = document;
    this.refresh();
  }

  refresh(): void {
    if (this.currentDocument && this.currentDocument.fileName.endsWith('.lhq')) {
      try {
        // Attempt to parse the document content as JSON for the tree view
        // In a real scenario, you'd parse your specific LHQ format
        this.currentData = JSON.parse(this.currentDocument.getText());
      } catch (e) {
        console.error("Error parsing LHQ file for TreeView:", e);
        // Fallback to sample data or clear if parsing fails
        this.currentData = sampleLhqData; // Or set to null to show an empty tree
        vscode.window.showWarningMessage("Could not parse LHQ file for TreeView. Displaying sample data.");
      }
    } else {
      this.currentData = null;
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (!this.currentData) {
      return Promise.resolve([]);
    }

    let items: vscode.TreeItem[] = [];
    if (!element) { // Root
      if (this.currentData.project && this.currentData.project.name) {
        items.push(new LhqTreeItem(this.currentData.project.name, vscode.TreeItemCollapsibleState.Expanded, this.currentData.project));
      } else { // If no project structure, maybe list top-level keys
        Object.keys(this.currentData).forEach(key => {
          const value = this.currentData[key];
          const collapsibleState = typeof value === 'object' && value !== null ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
          items.push(new LhqTreeItem(key, collapsibleState, value));
        });
      }
    } else if (element instanceof LhqTreeItem && element.data) {
      const data = element.data;
      if (data.folders && Array.isArray(data.folders)) {
        items = data.folders.map((folder: any) => new LhqTreeItem(folder.name, vscode.TreeItemCollapsibleState.Collapsed, folder));
      } else if (data.files && Array.isArray(data.files)) {
        items = data.files.map((file: any) => new LhqTreeItem(file.name, vscode.TreeItemCollapsibleState.None, file));
      } else if (typeof data === 'object') { // Generic object explorer
         Object.keys(data).forEach(key => {
          const value = data[key];
          const collapsibleState = typeof value === 'object' && value !== null && Object.keys(value).length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
          items.push(new LhqTreeItem(key, collapsibleState, value));
        });
      }
    }
    return Promise.resolve(items);
  }
}

class LhqTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly data?: any // Store original data
  ) {
    super(label, collapsibleState);
    this.tooltip = `${this.label}`;
    if (data && typeof data !== 'object') {
        this.description = String(data);
    }
    // Assign context value based on data type for icons or specific actions
    if (data && data.folders) {
        this.contextValue = 'projectNode';
    } else if (data && data.files) {
        this.contextValue = 'folderNode';
    } else if (typeof data === 'object' && data !== null) {
        this.contextValue = 'objectNode';
    } else {
        this.contextValue = 'valueNode';
    }
  }
}

class LhqCustomEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'lhq.customEditor';
  private treeDataProvider: LhqTreeDataProvider;

  constructor(
    private readonly context: vscode.ExtensionContext,
    treeDataProvider: LhqTreeDataProvider
    ) {
      this.treeDataProvider = treeDataProvider;
    }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
    };

    this.updateWebviewContent(webviewPanel, document);
    // Initial update for the tree when this specific editor is opened.
    // The global active editor handler will also run if it becomes the *active* one.
    if (document.fileName.endsWith('.lhq')) {
        this.treeDataProvider.updateDocument(document);
    }

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString() && document.fileName.endsWith('.lhq')) {
        this.updateWebviewContent(webviewPanel, e.document);
        this.treeDataProvider.updateDocument(e.document); // Update tree on content change
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      // No longer directly updating treeDataProvider here.
      // The global onDidChangeActiveTextEditor handler will manage
      // updating the context and tree based on the new active editor.
    });
  }

  private updateWebviewContent(webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument) {
    const jsonContent = document.getText();
    webviewPanel.webview.html = this.getHtmlForWebview(jsonContent);
  }

  private getHtmlForWebview(content: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" width="device-width, initial-scale=1.0">
    <title>LHQ Editor</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        pre { background-color: #f4f4f4; padding: 10px; border: 1px solid #ddd; white-space: pre-wrap; word-wrap: break-word; }
    </style>
</head>
<body>
    <h1>LHQ File Content</h1>
    <p>This is a custom editor for .lhq files.</p>
    <pre>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    <script>
        // You can add scripts here to interact with the webview content
        // or communicate with the extension.
        // const vscode = acquireVsCodeApi();
        // vscode.postMessage({ command: 'alert', text: 'Webview loaded!' });
    </script>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "lhq-editor-extension" is now active!');

  const lhqTreeDataProvider = new LhqTreeDataProvider();
  vscode.window.registerTreeDataProvider('lhqTreeView', lhqTreeDataProvider);

  const customEditorProvider = new LhqCustomEditorProvider(context, lhqTreeDataProvider);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(LhqCustomEditorProvider.viewType, customEditorProvider, {
        webviewOptions: {
            retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
    })
  );

  // Function to update context key, tree data, and focus the TreeView
  const updateEditorStateAndTreeView = (editor: vscode.TextEditor | undefined) => {
    console.log('updateEditorStateAndTreeView called. Active editor:', editor?.document.fileName);
    const isLhqEditorActive = editor && editor.document.fileName.endsWith('.lhq');

    vscode.commands.executeCommand('setContext', 'lhqFileIsActiveEditor', isLhqEditorActive);

    if (isLhqEditorActive) {
      lhqTreeDataProvider.updateDocument(editor.document);
      setTimeout(() => {
        vscode.commands.executeCommand('workbench.actions.treeView.lhqTreeView.focus');
      }, 150);
    } else {
      lhqTreeDataProvider.updateDocument(null);
    }
  };

  // Initial check for the active editor when the extension activates
  updateEditorStateAndTreeView(vscode.window.activeTextEditor);

  // Listen for changes to the active text editor
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
    updateEditorStateAndTreeView(editor);
  }));

  let disposableCommand = vscode.commands.registerCommand('lhq-editor-extension.helloWorld', () => {
    vscode.window.showInformationMessage('Hello World from LHQ Editor Extension!');
  });
  context.subscriptions.push(disposableCommand);
}

export function deactivate() {}
