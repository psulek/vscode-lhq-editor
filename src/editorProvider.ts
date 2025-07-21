import * as vscode from 'vscode';
import { LhqTreeDataProvider } from './treeDataProvider';
import { isValidDocument, logger, showMessageBox } from './utils';
import { AppToPageMessage, SelectionChangedCallback } from './types';
import debounce from 'lodash.debounce';
import { ITreeElement } from '@lhq/lhq-generators';
import { DocumentContext } from './documentContext';

export class LhqEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'lhq.customEditor';

    private readonly _editors = new Map<string, DocumentContext>();
    private readonly _debouncedOnSelectionChanged: SelectionChangedCallback = undefined!;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly treeDataProvider: LhqTreeDataProvider
    ) {
        this._debouncedOnSelectionChanged = debounce(this.onSelectionChanged.bind(this), 200, { leading: false, trailing: true });
        appContext.setSelectionChangedCallback(this._debouncedOnSelectionChanged);
    }

    private get activeDocumentContext(): DocumentContext | undefined {
        for (const editor of this._editors.values()) {
            if (editor.isActive) {
                return editor;
            }
        }
        return undefined;
    }

    private onSelectionChanged(selectedElements: ITreeElement[]): void {
        logger().log(this, 'debug', `[LhqEditorProvider] onSelectionChanged -> ${selectedElements ? selectedElements.length : 0} elements selected.`);
        const ctx = this.activeDocumentContext;
        if (ctx) {
            logger().log(this, 'debug', `[LhqEditorProvider] onSelectionChanged -> updating selection on document context (${ctx.documentUri}).`);
            ctx.onSelectionChanged(selectedElements);
        } else {
            logger().log(this, 'debug', '[LhqEditorProvider] onSelectionChanged -> No active document context found. Skipping selection update.');
        }
    }

    public sendMessageToHtmlPage(message: AppToPageMessage): void {
        const ctx = this.activeDocumentContext;
        if (ctx) {
            logger().log(this, 'debug', `[LhqEditorProvider] sendMessageToHtmlPage -> Sending message '${message.command}' to webview for document ${ctx.documentUri}`);
            ctx.sendMessageToHtmlPage(message);
        } else {
            logger().log(this, 'warn', '[LhqEditorProvider] sendMessageToHtmlPage -> No active document context found. Cannot send message.');
        }
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        logger().log(this, 'debug', `resolveCustomTextEditor -> for document: ${document.fileName}`);

        const documentUri = document.uri.toString();
        if (this._editors.has(documentUri)) {
            return await showMessageBox('err', `Editor for ${document.fileName} is already open.`, { modal: true });
        }

        const onDocContextDisposed = () => {
            this._editors.delete(documentUri);

            // NOTE: Test if needed this delay thingy at all
            setTimeout(async () => {

                const treeHasActiveDoc = this.treeDataProvider.hasActiveDocument();
                if (treeHasActiveDoc && !this.treeDataProvider.isSameDocument(document)) {
                    logger().log(this, 'debug', "onDidDispose -> No active document or same document. Nothing to do.");
                } else {
                    logger().log(this, 'debug', "onDidDispose -> Triggering treeDataProvider.updateDocument");
                    const activeDocument = vscode.window.activeTextEditor?.document;

                    // if not active document or not valid document, update tree data provider to clear/hide tree
                    if (!activeDocument || !isValidDocument(activeDocument)) {
                        await this.treeDataProvider.updateDocument(undefined);
                    }
                }

            }, 100);
        };

        const docCtx = new DocumentContext(this.context, document, webviewPanel, onDocContextDisposed);
        this._editors.set(documentUri, docCtx);

        try {

            // 1st - set html page to 'empty' , showing msg: loading $file ...
            await docCtx.loadEmptyPage();

            // 2nd - update tree data provider with the document
            await this.treeDataProvider.updateDocument(document);

            // 3rd - update webview content with the document
            await docCtx.updateWebviewContent();

            // 4th - select root element in the tree , this will reflect the selection to the webview
            await this.treeDataProvider.selectRootElement();
            appContext.isEditorActive = true;
        } catch (error) {
            logger().log(this, 'error', `resolveCustomTextEditor -> Error while resolving custom text editor: ${error}`);

            // clear and hide the tree if error occurs
            await this.treeDataProvider.updateDocument(undefined);
        }
    }
}
