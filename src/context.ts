import * as vscode from 'vscode';
import { HtmlPageMessage, IMessageSender, IVirtualLanguageElement, SelectionChangedCallback } from './types';
import { ITreeElement } from '@lhq/lhq-generators';
import { VirtualTreeElement } from './elements';
import { logger } from './utils';

const globalStateKeys = {
    languagesVisible: 'languagesVisible'
};

const contextKeys = {
    isEditorActive: 'lhqEditorIsActive',
    hasSelectedItem: 'lhqTreeHasSelectedItem',
    hasMultiSelection: 'lhqTreeHasMultiSelection',
    hasSelectedDiffParents: 'lhqTreeHasSelectedDiffParents',
    hasLanguageSelection: 'lhqTreeHasLanguageSelection',
    hasPrimaryLanguageSelected: 'lhqTreeHasPrimaryLanguageSelected',
    hasSelectedResource: 'lhqTreeHasSelectedResource',
    hasLanguagesVisible: 'lhqTreeHasLanguagesVisible',
};


export class AppContext {
    private _ctx!: vscode.ExtensionContext;
    private _isEditorActive = false;
    private activeTheme = ''; // not supported yet
    private _selectedElements: ITreeElement[] = [];
    private _onSelectionChanged:  SelectionChangedCallback | undefined;
    // private _messageSender: IMessageSender | undefined;

    // private _emitter = new vscode.EventEmitter<void>();
    // public readonly onSelectionChanged: vscode.Event<void> = this._emitter.event;

    public setSelectionChangedCallback(callback:  SelectionChangedCallback): void {
        this._onSelectionChanged = callback;
    }

    public init(ctx: vscode.ExtensionContext) {
        this._ctx = ctx;

        // to trigger setContext calls
        this.languagesVisible = this.languagesVisible;
        this.isEditorActive = false;
        this.setTreeViewHasSelectedItem([]);
    }

    public get languagesVisible(): boolean {
        return this._ctx.globalState.get<boolean>(globalStateKeys.languagesVisible, true);
    }

    public set languagesVisible(visible: boolean) {
        this._ctx.globalState.update(globalStateKeys.languagesVisible, visible);
        vscode.commands.executeCommand('setContext', contextKeys.hasLanguagesVisible, visible);
    }

    public get isEditorActive(): boolean {
        return this._isEditorActive;
    }

    public set isEditorActive(active: boolean) {
        if (this._isEditorActive !== active) {
            this._isEditorActive = active;
            vscode.commands.executeCommand('setContext', contextKeys.isEditorActive, active);
        }
    }

    public getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    public getFileUri = (...pathParts: string[]): vscode.Uri => {
        return vscode.Uri.joinPath(this._ctx.extensionUri, ...pathParts);
    };

    public getMediaUri = (webview: vscode.Webview, filename: string, themed: boolean = false): vscode.Uri => {
        const diskPath = themed
            ? vscode.Uri.joinPath(this._ctx.extensionUri, 'media', this.activeTheme, filename)
            : vscode.Uri.joinPath(this._ctx.extensionUri, 'media', filename);
        return webview.asWebviewUri(diskPath);
    };

    public get selectedElements(): ITreeElement[] {
        return this._selectedElements ?? [];
    }

    // public sendMessageToWebview(webview: vscode.Webview, message: HtmlPageMessage): void {
    //     if (webview) {
    //         webview.postMessage(message);
    //     }
    // }

    public setTreeViewHasSelectedItem(selectedElements: ITreeElement[]): void {
        this._selectedElements = selectedElements;
        if (this._onSelectionChanged) {
            logger().log('debug', `AppContext.setTreeViewHasSelectedItem, fire -> _onSelectionChanged (${selectedElements.length} items selected)`);
            // @ts-ignore
            // this._onSelectionChanged.call(this);
            this._onSelectionChanged(selectedElements);
        }

        // this._emitter.fire();

        const hasSelectedItem = selectedElements.length === 1;
        const hasMultiSelection = selectedElements.length > 1;
        let hasSelectedDiffParents = false;
        let hasLanguageSelection = false;
        let hasPrimaryLanguageSelected = false;
        let hasSelectedResource = hasSelectedItem && selectedElements[0].elementType === 'resource';

        if (selectedElements.length > 1) {
            const firstParent = selectedElements[0].parent;
            hasSelectedDiffParents = selectedElements.some(x => x.parent !== firstParent);
        }

        const virtualElements = selectedElements.filter(x => x instanceof VirtualTreeElement);
        if (virtualElements.length > 0) {
            hasLanguageSelection = virtualElements.some(x => x.virtualElementType === 'language' || x.virtualElementType === 'languages');
            hasPrimaryLanguageSelected = virtualElements.some(x => x.virtualElementType === 'language' && (x as unknown as IVirtualLanguageElement).isPrimary);
        }

        vscode.commands.executeCommand('setContext', contextKeys.hasSelectedItem, hasSelectedItem);
        vscode.commands.executeCommand('setContext', contextKeys.hasMultiSelection, hasMultiSelection);
        vscode.commands.executeCommand('setContext', contextKeys.hasSelectedDiffParents, hasSelectedDiffParents);
        vscode.commands.executeCommand('setContext', contextKeys.hasLanguageSelection, hasLanguageSelection);
        vscode.commands.executeCommand('setContext', contextKeys.hasPrimaryLanguageSelected, hasPrimaryLanguageSelected);
        vscode.commands.executeCommand('setContext', contextKeys.hasSelectedResource, hasSelectedResource);
    }
}

export const appContext = new AppContext();