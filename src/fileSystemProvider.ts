// import * as vscode from 'vscode';

// export class LhqFileSystemProvider implements vscode.FileSystemProvider {

//     private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
//     readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

//     watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
//         // For this simple provider, we don't need to watch for file changes.
//         return new vscode.Disposable(() => { });
//     }

//     stat(uri: vscode.Uri): vscode.FileStat {
//         // For a readonly provider, we can return a simplified stat.
//         return {
//             type: vscode.FileType.File,
//             ctime: Date.now(),
//             mtime: Date.now(),
//             size: 0 // We don't know the size beforehand, so we can put 0.
//         };
//     }

//     readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] {
//         // This provider is for files only, so we don't implement this.
//         throw vscode.FileSystemError.NoPermissions('Not a directory');
//     }

//     createDirectory(_uri: vscode.Uri): void {
//         // Readonly provider.
//         throw vscode.FileSystemError.NoPermissions('Readonly provider');
//     }

//     async readFile(uri: vscode.Uri): Promise<Uint8Array> {
//         // The core logic: when asked for `lhq:/path/to/file.lhq`,
//         // we read the content from `file:///path/to/file.lhq`.
//         const fileUri = vscode.Uri.file(uri.path);
//         try {
//             const content = await vscode.workspace.fs.readFile(fileUri);
//             return content;
//         } catch (e) {
//             console.error(e);
//             throw vscode.FileSystemError.FileNotFound(uri);
//         }
//     }

//     writeFile(uri: vscode.Uri, content: Uint8Array, _options: { create: boolean; overwrite: boolean; }): void {
//         // This is a readonly provider for simplicity, but you could implement
//         // writing back to the original file URI here.
//         throw vscode.FileSystemError.NoPermissions('Readonly provider');
//     }

//     delete(_uri: vscode.Uri, _options: { recursive: boolean; }): void {
//         // Readonly provider.
//         throw vscode.FileSystemError.NoPermissions('Readonly provider');
//     }

//     rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { overwrite: boolean; }): void {
//         // Readonly provider.
//         throw vscode.FileSystemError.NoPermissions('Readonly provider');
//     }
// }