import * as vscode from 'vscode';
import { AppContext } from './context';

export async function activate(context: vscode.ExtensionContext) {
    const appContext = new AppContext();
    (globalThis as any).appContext = appContext;
    await appContext.init(context);
}

export function deactivate() { }