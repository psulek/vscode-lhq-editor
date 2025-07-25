import path from 'node:path';
import * as vscode from 'vscode';
import { LhqTreeDataProvider } from './treeDataProvider';
import { delay, getGeneratorAppErrorMessage, isValidDocument, logger, showMessageBox } from './utils';
import { AppToPageMessage, SelectionChangedCallback } from './types';
import debounce from 'lodash.debounce';
import { Generator, isNullOrEmpty, ITreeElement } from '@lhq/lhq-generators';
import { DocumentContext } from './documentContext';
import { AvailableCommands, Commands, GlobalCommands } from './context';
import { CodeGenStatus } from './codeGenStatus';

export class LhqEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'lhq.customEditor';

    private readonly _editors = new Map<string, DocumentContext>();
    private readonly _debouncedOnSelectionChanged: SelectionChangedCallback = undefined!;

    private _codeGenStatus!: CodeGenStatus;
    private _debouncedRunCodeGenerator: () => void;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly treeDataProvider: LhqTreeDataProvider
    ) {
        this._debouncedOnSelectionChanged = debounce(this.onSelectionChanged.bind(this), 200, { leading: false, trailing: true });
        appContext.setSelectionChangedCallback(this._debouncedOnSelectionChanged);
        appContext.setCheckAnyActiveDocumentCallback(this.hasAnyActiveDocument);

        this._codeGenStatus = new CodeGenStatus(context);
        this._debouncedRunCodeGenerator = debounce(this.runCodeGenerator.bind(this), 200, { leading: true, trailing: false });

        for (const command of Object.values(Commands)) {
            context.subscriptions.push(
                vscode.commands.registerCommand(command, args => this.handleVsCommand(command, args))
            );
        }

        context.subscriptions.push(
            vscode.commands.registerCommand(GlobalCommands.runGenerator, () => this._debouncedRunCodeGenerator()),
        );
    }

    private handleVsCommand(command: AvailableCommands, treeElement: ITreeElement): Promise<void> {
        const activeDoc = this.activeDocument;
        if (!activeDoc) {
            logger().log(this, 'warn', `handleVsCommand -> No active document context found. Cannot handle command '${command}'.`);
            return Promise.resolve();
        }

        return activeDoc.handleVsCommand(command, treeElement);
    }

    private get activeDocument(): DocumentContext | undefined {
        for (const editor of this._editors.values()) {
            if (editor.isActive) {
                return editor;
            }
        }
        return undefined;
    }

    hasAnyActiveDocument = (): boolean => {
        for (const editor of this._editors.values()) {
            if (editor.isActive) {
                return true;
            }
        }
        return false;
    };

    private onSelectionChanged(selectedElements: ITreeElement[]): void {
        logger().log(this, 'debug', `[LhqEditorProvider] onSelectionChanged -> ${selectedElements ? selectedElements.length : 0} elements selected.`);
        const activeDoc = this.activeDocument;
        if (activeDoc) {
            logger().log(this, 'debug', `[LhqEditorProvider] onSelectionChanged -> updating selection on document context (${activeDoc.documentUri}).`);
            activeDoc.onSelectionChanged(selectedElements);
        } else {
            logger().log(this, 'debug', '[LhqEditorProvider] onSelectionChanged -> No active document context found. Skipping selection update.');
        }
    }

    public sendMessageToHtmlPage(message: AppToPageMessage): void {
        const activeDoc = this.activeDocument;
        if (activeDoc) {
            logger().log(this, 'debug', `[LhqEditorProvider] sendMessageToHtmlPage -> Sending message '${message.command}' to webview for document ${activeDoc.documentUri}`);
            activeDoc.sendMessageToHtmlPage(message);
        } else {
            logger().log(this, 'warn', '[LhqEditorProvider] sendMessageToHtmlPage -> No active document context found. Cannot send message.');
            //void showMessageBox('warn', 'No active lhq document found. Please reopen lhq file.');
        }
    }

    public async runCodeGenerator(): Promise<void> {
        const activeDoc = this.activeDocument;
        if (!activeDoc) {
            logger().log(this, 'warn', 'runCodeGenerator -> No active document context found. Cannot run code generator.');
            void showMessageBox('warn', 'No active lhq document found. Please open a lhq file to run the code generator.');
            return;
        }

        if (!activeDoc.jsonModel) {
            logger().log(this, 'debug', 'runCodeGenerator -> No current document or model found.');
            return;
        }

        if (this._codeGenStatus.inProgress) {
            logger().log(this, 'debug', 'runCodeGenerator -> Code generator is already in progress.');
            void showMessageBox('info', 'Code generator is already running ...');
            return;
        }

        logger().log(this, 'debug', `runCodeGenerator -> Running code generator for document ${activeDoc.documentUri}`);


        const fileName = activeDoc.fileName;
        if (isNullOrEmpty(fileName)) {
            logger().log(this, 'debug', `runCodeGenerator -> Document fileName is not valid (${fileName}). Cannot run code generator.`);
            return;
        }

        const templateId = activeDoc.codeGeneratorTemplateId;
        logger().log(this, 'info', `Running code generator template '${templateId}' for document: ${fileName}`);

        this._codeGenStatus.inProgress = true;

        let beginStatusUid = '';
        let idleStatusOnEnd = true;

        try {
            beginStatusUid = this._codeGenStatus.updateGeneratorStatus(templateId, { kind: 'active', filename: fileName });

            const startTime = Date.now();
            const generator = new Generator();
            const result = generator.generate(fileName, activeDoc.jsonModel, {});
            const generationTime = Date.now() - startTime;

            // artificially delay the status update to show the spinner ...
            if (generationTime < 500) {
                await delay(500 - generationTime);
            }

            if (result.generatedFiles) {
                const lhqFileFolder = path.dirname(fileName);
                const fileNames = result.generatedFiles.map(f => path.join(lhqFileFolder, f.fileName));
                logger().log(this, 'info', `Code generator template '${templateId}' successfully generated ${fileNames.length} files:\n` +
                    `${fileNames.join('\n')}`);

                this._codeGenStatus.updateGeneratorStatus(templateId, {
                    kind: 'status',
                    message: `Generated ${result.generatedFiles.length} files.`,
                    success: true,
                    timeout: 2000
                });
            } else {
                this._codeGenStatus.updateGeneratorStatus(templateId, { kind: 'error', message: 'Error generating files.', timeout: 5000 });
            }
        }
        catch (error) {
            const msg = `Code generator template '${templateId}' failed.`;
            logger().log(this, 'error', msg, error as Error);

            this._codeGenStatus.updateGeneratorStatus(templateId, { kind: 'error', message: msg, error: error as Error });
        } finally {
            this._codeGenStatus.inProgress = false;

            if (idleStatusOnEnd) {
                setTimeout(() => {
                    if (beginStatusUid === this._codeGenStatus.lastStatus?.uid) {
                        this._codeGenStatus.updateGeneratorStatus('', { kind: 'idle' });
                    }
                }, 2000);
            }
        }
    }

    public resetGeneratorStatus(): void {
        if (this._codeGenStatus.lastStatus === undefined || this._codeGenStatus.lastStatus.kind === 'error' || !this._codeGenStatus.inProgress) {
            this._codeGenStatus.updateGeneratorStatus('', { kind: 'idle' });
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
            if (this._editors.has(documentUri)) {
                const doc = this._editors.get(documentUri);
                this._editors.delete(documentUri);

                // NOTE: Test if needed this delay thingy at all
                setTimeout(async () => {

                    //const treeHasActiveDoc = this.treeDataProvider.hasActiveDocument();
                    // if (treeHasActiveDoc && !this.treeDataProvider.isSameDocument(document)) {
                    const docIsActive = doc?.isActive ?? false;

                    if (docIsActive && !doc?.isSameDocument(document)) {
                        logger().log(this, 'debug', "onDidDispose -> No active document or same document. Nothing to do.");
                    } else {
                        logger().log(this, 'debug', "onDidDispose -> Triggering treeDataProvider.updateDocument");
                        const activeDocument = vscode.window.activeTextEditor?.document;


                        // if not active document or not valid document, update tree data provider to clear/hide tree
                        if (!activeDocument || !isValidDocument(activeDocument)) {
                            // await this.treeDataProvider.updateDocument(undefined);
                            const treeDoc = this.treeDataProvider.activeDocument;
                            if (!treeDoc || treeDoc.isSameDocument(document) || treeDoc === doc) {
                                await doc!.update(undefined);
                            }
                        }
                    }

                }, 100);
            }
        };

        const docCtx = new DocumentContext(this.context, webviewPanel, this._codeGenStatus, onDocContextDisposed);
        this._editors.set(documentUri, docCtx);

        try {

            // 1st - set html page to 'empty' , showing msg: loading $file ...
            await docCtx.loadEmptyPage();

            // 2nd - update tree data provider with the document
            await docCtx.update(document, { forceRefresh: true });

            // 3rd - update webview content with the document
            await docCtx.updateWebviewContent();

            // 4th - select root element in the tree , this will reflect the selection to the webview
            await this.treeDataProvider.selectRootElement();

            // appContext.isEditorActive = true;
            appContext.enableEditorActive();
        } catch (error) {
            logger().log(this, 'error', `resolveCustomTextEditor -> Error while resolving custom text editor: ${error}`);

            // clear and hide the tree if error occurs
            // await this.treeDataProvider.updateDocument(undefined, false);
            await docCtx.update(undefined);
        }
    }

    public onWillSaveTextDocument(event: vscode.TextDocumentWillSaveEvent) {
        const activeDoc = this.activeDocument;
        if (!activeDoc) {
            logger().log(this, 'warn', 'onWillSaveTextDocument -> No active document context found. Cannot handle will save event.');
            return;
        }

        if (activeDoc.isSameDocument(event.document)) {
            const validationError = activeDoc.lastValidationError;

            // TODO: If error, run 'processBeforeSave' to edit with original content (with no error) to be saved to file!!
            if (validationError) {
                void showMessageBox('warn', validationError.message, { detail: validationError.detail, modal: true });
            } else {
                // event.waitUntil(this.processBeforeSave(event.document));
            }
        }
    }

    public async onUndoRedo(document: vscode.TextDocument): Promise<void> {
        const activeDoc = this.activeDocument;
        if (!activeDoc) {
            logger().log(this, 'warn', 'onUndoRedo -> No active document context found. Cannot handle undo/redo event.');
            return;
        }

        if (activeDoc.isSameDocument(document)) {
            logger().log(this, 'debug', `onUndoRedo -> Document ${document.fileName} is active. Updating tree and webview.`);

            await activeDoc.update(document, { forceRefresh: true });
            //activeDoc.sendMessageToHtmlPage({ command: 'requestPageReload' });
        } else {
            logger().log(this, 'debug', `onUndoRedo -> Document ${document.fileName} is not active. Skipping update.`);
        }
    }
}
