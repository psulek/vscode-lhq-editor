import * as vscode from 'vscode';
import { ICategoryElement, ICategoryLikeTreeElement, IResourceElement, type IRootModelElement, ITreeElement, type LhqModel, LhqValidationResult, generatorUtils } from '@lhq/lhq-generators';

import { isEditorActive, isValidDocument, logger, setEditorActive } from './utils';

import { LhqTreeItem } from './treeItem';

export class LhqTreeDataProvider implements vscode.TreeDataProvider<LhqTreeItem> {
    // flag whenever that last active editor (not null) is other type than LHQ (tasks window, etc...)
    private _lastActiveEditorNonLhq = false;

    private _onDidChangeTreeData: vscode.EventEmitter<LhqTreeItem | undefined | null | void> = new vscode.EventEmitter<LhqTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<LhqTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private currentRootModel: IRootModelElement | null = null;
    private currentDocument: vscode.TextDocument | null = null;

    constructor(private context: vscode.ExtensionContext) {

        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(e => this.onActiveEditorChanged(e)),
            vscode.window.onDidChangeVisibleTextEditors(e => this.onDidChangeVisibleTextEditors(e)),

            vscode.workspace.onDidChangeTextDocument(e => this.onDidChangeTextDocument(e)),
            vscode.workspace.onDidOpenTextDocument(e => this.onDidOpenTextDocument(e))
        );

        this.onActiveEditorChanged(vscode.window.activeTextEditor);
    }

    private onDidChangeVisibleTextEditors(e: readonly vscode.TextEditor[]): any {
        const editor = e.find(x => x.document.fileName === vscode.window.activeTextEditor?.document.fileName);
        if (editor) {
            logger().log('debug', `LhqTreeDataProvider.onDidChangeVisibleTextEditors: Active editor found: ${editor.document?.fileName ?? '-'}`);
        } else {
            logger().log('debug', "LhqTreeDataProvider.onDidChangeVisibleTextEditors: No active editor found");
        }
    }

    private onDidOpenTextDocument(e: vscode.TextDocument): any {
        logger().log('debug', `LhqTreeDataProvider.onDidOpenTextDocument: ${e?.fileName ?? '-'}`);
    }


    private onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent): void {
        logger().log('debug', `LhqTreeDataProvider.onDocumentChanged: ${e.document?.fileName ?? '-'}`);
        this.updateDocument(e.document);
    }

    public onActiveEditorChanged(e: vscode.TextEditor | undefined): void {
        logger().log('debug', `LhqTreeDataProvider.onActiveEditorChanged: ${e?.document.fileName ?? '-'}`);
        this.updateDocument(e?.document);
    }

    public hasActiveDocument(): boolean {
        return this.currentDocument !== null && isEditorActive();
    }

    private get documentPath(): string {
        return this.currentDocument ? this.currentDocument.uri.fsPath : '';
    }

    public isSameDocument(document: vscode.TextDocument): boolean {
        return this.currentDocument !== null && this.currentDocument.uri.toString() === document.uri.toString();
    }

    public updateDocument(document: vscode.TextDocument | undefined) {
        if (document && !isValidDocument(document)) {
            this._lastActiveEditorNonLhq = true;
            logger().log('debug', `LhqTreeDataProvider.updateDocument skipped due to invalid document.`);
            return;
        }

        logger().log('debug', `LhqTreeDataProvider.updateDocument with: ${document?.fileName ?? '-'}`);
        if (isValidDocument(document)) {
            setEditorActive(true);
            if (this.currentDocument?.uri.toString() !== document.uri.toString() || !this.currentRootModel) {
                this.currentDocument = document;
                this.refresh();
            }
        } else {
            if (isEditorActive()) {
                if (!this._lastActiveEditorNonLhq) {
                    this._lastActiveEditorNonLhq = false;
                    setEditorActive(false);
                    this.currentDocument = null;
                    this.refresh();
                } else {
                    this._lastActiveEditorNonLhq = false;
                }
            }
        }
    }

    refresh(): void {
        if (this.currentDocument) {
            let jsonObj: LhqModel | undefined;

            this.currentRootModel = null;
            try {
                const test = this.currentDocument.getText();
                jsonObj = test?.length > 0 ? JSON.parse(test) as LhqModel : undefined;
            } catch (ex) {
                const error = `Error parsing LHQ file '${this.documentPath}'`;
                logger().log('error', error, ex as Error);
                jsonObj = undefined;
                vscode.window.showWarningMessage(error);
            }

            if (jsonObj) {
                let validateResult: LhqValidationResult | undefined;

                try {
                    validateResult = generatorUtils.validateLhqModel(jsonObj);
                    if (validateResult.success && validateResult.model) {
                        this.currentRootModel = generatorUtils.createRootElement(validateResult.model);
                    }
                } catch (ex) {
                    const error = `Error validating LHQ file '${this.documentPath}': ${ex}`;
                    logger().log('error', error, ex as Error);
                    vscode.window.showWarningMessage(error);
                }

                if (this.currentRootModel === null || this.currentRootModel === undefined) {
                    const error = validateResult
                        ? `Validation errors while parsing LHQ file '${this.documentPath}': \n${validateResult.error}`
                        : `Error validating LHQ file '${this.documentPath}'`;
                    logger().log('error', error);
                    vscode.window.showWarningMessage(error);
                }
            }

        } else {
            this.currentRootModel = null;
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: LhqTreeItem): vscode.TreeItem {
        return element;
    }

    createTreeItem(element: ITreeElement): LhqTreeItem[] {
        const mapResources = (resources: Readonly<IResourceElement[]>): LhqTreeItem[] =>
            resources.map(x => new LhqTreeItem(x.name, vscode.TreeItemCollapsibleState.None, x));

        const mapCategories = (categories: Readonly<ICategoryLikeTreeElement[]>): LhqTreeItem[] =>
            categories.map(x => new LhqTreeItem(x.name, x.hasCategories || x.hasResources ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, x));

        switch (element.elementType) {
            case 'model': {
                const model = element as IRootModelElement;
                const resources = mapResources(model.resources);
                const categories = mapCategories(model.categories);
                return categories.concat(resources);
            }
            case 'category': {
                const category = element as ICategoryElement;
                const resources = mapResources(category.resources);
                const categories = mapCategories(category.categories);
                return categories.concat(resources);
            }
            case 'resource': {
                const resource = element as IResourceElement;
                return [new LhqTreeItem(resource.name, vscode.TreeItemCollapsibleState.None, resource)];
            }
        }
    }

    getChildren(element?: LhqTreeItem): Thenable<LhqTreeItem[]> {
        if (!this.currentRootModel) {
            return Promise.resolve([]);
        }

        if (element) {
            return Promise.resolve(this.createTreeItem(element.element));
        }

        const rootItem = new LhqTreeItem(this.currentRootModel.name, vscode.TreeItemCollapsibleState.Expanded, this.currentRootModel);
        return Promise.resolve([rootItem]);
    }
}