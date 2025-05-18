import * as vscode from 'vscode';
import type { ICategoryLikeTreeElement, IRootModelElement, ITreeElement, LhqModel, LhqValidationResult, TreeElementType } from '@lhq/lhq-generators';
import { generatorUtils, isNullOrEmpty } from '@lhq/lhq-generators';
import {
    modify as jsonModify, parse as jsonParse, parseTree,
    findNodeAtLocation, visit as jsonVisit, JSONVisitor, getNodePath, Node as jsonNode,
    format as jsonFormat, findNodeAtOffset,
    getNodeValue, EditResult, FormattingOptions
} from 'jsonc-parser';

import { createTreeElementPaths, getElementFullPath, IdentationType, isEditorActive, isValidDocument, logger, renameJsonProperty, setEditorActive, showMessageBox } from './utils';

import { LhqTreeItem } from './treeItem';

// @ts-ignore
import detectIndent from 'detect-indent';
import { test1 } from './test1';
import { validateName } from './validator';
// import { createRequire } from 'module';
// // @ts-ignore
// const detectIndent = createRequire(import.meta.url)('detect-indent');

const defaultIdent: IdentationType = {
    amount: 2,
    type: 'space',
    indent: '  '
};

const actions = {
    refresh: 'lhqTreeView.refresh',
    addItem: 'lhqTreeView.addItem',
    renameItem: 'lhqTreeView.renameItem',
    deleteItem: 'lhqTreeView.deleteItem',
};

// const visitor: JSONVisitor = {
//   onObjectProperty: (property, _offset, _length, parent) => {
//     console.log('onObjectProperty', property, _offset, _length, parent);
//   }  
// };

export class LhqTreeDataProvider implements vscode.TreeDataProvider<ITreeElement>, vscode.TreeDragAndDropController<ITreeElement> {
    dropMimeTypes = ['application/vnd.code.tree.lhqTreeView'];
    dragMimeTypes = ['text/uri-list'];

    // flag whenever that last active editor (not null) is other type than LHQ (tasks window, etc...)
    private _lastActiveEditorNonLhq = false;

    private _onDidChangeTreeData: vscode.EventEmitter<(ITreeElement | undefined)[] | undefined> = new vscode.EventEmitter<ITreeElement[] | undefined>();
    readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

    private currentRootModel: IRootModelElement | null = null;
    private currentDocument: vscode.TextDocument | null = null;
    private currentJsonModel: LhqModel | null = null;
    private documentIndent: IdentationType = defaultIdent;
    private selectedElement: ITreeElement | undefined = undefined;

    constructor(private context: vscode.ExtensionContext) {

        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(e => this.onActiveEditorChanged(e)),
            vscode.window.onDidChangeVisibleTextEditors(e => this.onDidChangeVisibleTextEditors(e)),

            vscode.workspace.onDidChangeTextDocument(e => this.onDidChangeTextDocument(e)),
            vscode.workspace.onDidOpenTextDocument(e => this.onDidOpenTextDocument(e)),

            vscode.commands.registerCommand(actions.refresh, () => this.refresh()),
            vscode.commands.registerCommand(actions.addItem, args => this.addItem(args)),
            vscode.commands.registerCommand(actions.renameItem, args => this.renameItem(args)),
            vscode.commands.registerCommand(actions.deleteItem, args => this.deleteItem(args)),
        );

        this.onActiveEditorChanged(vscode.window.activeTextEditor);

        const view = vscode.window.createTreeView('lhqTreeView', {
            treeDataProvider: this,
            showCollapseAll: true,
            canSelectMany: true,
            dragAndDropController: this
        });
        context.subscriptions.push(view);

        context.subscriptions.push(
            view.onDidChangeSelection(e => {
                this.selectedElement = e.selection && e.selection.length > 0 ? e.selection[0]: undefined;
            })
        );
    }

    public async handleDrag(source: ITreeElement[], treeDataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        const items = source.filter(x => x.elementType !== 'model').map<DragTreeItem>(x => ({
            path: getElementFullPath(x),
            type: x.elementType as Exclude<TreeElementType, 'model'>,
        }));

        if (items.length === 0 || _token.isCancellationRequested) {
            return Promise.reject();
        }

        treeDataTransfer.set('application/vnd.code.tree.lhqTreeView', new vscode.DataTransferItem(items));
    }

    private getTreeItems(source: DragTreeItem[]): ITreeElement[] {
        return isNullOrEmpty(this.currentRootModel)
            ? []
            : source.map(item => {
                const treeItem = this.currentRootModel!.getElementByPath(createTreeElementPaths(item.path), item.type);
                return treeItem;
            }).filter(item => item !== undefined) as ITreeElement[];
    }

    public async handleDrop(target: ITreeElement | undefined, sources: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        if (!target) {
            return;
        }

        const transferItem = sources.get('application/vnd.code.tree.lhqTreeView');
        if (!transferItem || _token.isCancellationRequested) {
            return;
        }

        const items: DragTreeItem[] = transferItem.value;
        if (!items || items.length === 0) {
            return;
        }

        const treeItems = this.getTreeItems(items);
        const itemCount = treeItems.length;
        const firstParent = treeItems[0].parent;
        const elemText = `${itemCount} element(s)`;

        if (treeItems.length > 1) {
            if (!treeItems.every(item => item.parent === firstParent)) {
                showMessageBox('warn', `Cannot move ${elemText} with different parents.`);
                return;
            }
        }

        if (target === firstParent) {
            showMessageBox('warn', `Cannot move ${elemText} to the same parent element '${getElementFullPath(target)}'.`);
            return;
        }



        // const treeItems: Node[] = transferItem.value;
        // let roots = this._getLocalRoots(treeItems);
        // // Remove nodes that are already target's parent nodes
        // roots = roots.filter(r => !this._isChild(this._getTreeElement(r.key), target));
        // if (roots.length > 0) {
        // 	// Reload parents of the moving elements
        // 	const parents = roots.map(r => this.getParent(r));
        // 	roots.forEach(r => this._reparentNode(r, target));
        // 	this._onDidChangeTreeData.fire([...parents, target]);
        // }
    }

    private async deleteItem(element: ITreeElement): Promise<void> {
        const elementName = element.name;
        const parentPath = getElementFullPath(element);

        const confirmation = await showMessageBox('info',
            `Delete ${element.elementType} "${elementName}" ?`,
            { modal: true, detail: parentPath },
            'Yes',
            'No'
        );

        if (confirmation === 'Yes') {
            showMessageBox('info', `Item "${elementName}" deleted.`);
            // Add deletion logic here
        } else {
            showMessageBox('info', `Deletion of item "${elementName}" canceled.`);
        }
    }

    private async renameItem(element: ITreeElement): Promise<void> {
        if (!this.currentDocument) {
            showMessageBox('warn', 'No active document to rename item in.');
            return;
        }

        element = element || this.selectedElement;
        if (!element) {
            return;
        }

        const originalName = element.name;
        const elemPath = element.paths.getParentPath('/', true);

        const newName = await vscode.window.showInputBox({
            prompt: `Enter new name for ${element.elementType} '${originalName}' (${elemPath})`,
            value: originalName,
            validateInput: value => {
                const valRes = validateName(value);
                if (valRes === 'valid') {
                    if (value === originalName) {
                        return 'New name is the same as the old name.';
                    }
                } else {
                    switch (valRes) {
                        case 'nameIsEmpty':
                            return 'Name cannot be empty.';
                        case 'nameCannotBeginWithNumber':
                            return 'Name cannot start with a number.';
                        case 'nameCanContainOnlyAlphaNumeric':
                            return 'Name can only contain alphanumeric characters and underscores.';
                    }
                }

                return null;
            }
        });

        if (!newName || newName === originalName) {
            return;
        }

        const documentText = this.currentDocument.getText();
        let lhqModelFromFile: LhqModel;
        try {
            lhqModelFromFile = jsonParse(documentText) as LhqModel;
            if (!lhqModelFromFile) {
                throw new Error("Parsed model is null or undefined.");
            }
        } catch (e: any) {
            logger().log('error', `RenameItem: Failed to parse current document ${this.documentPath}: ${e.message}`, e);
            showMessageBox('err', `Failed to parse document. Cannot rename. Error: ${e.message}`);
            return;
        }

        let edits: EditResult | undefined;
        try {
            edits = renameJsonProperty(element, newName, documentText, this.documentIndent);
            if (!edits) {
                logger().log('debug', `RenameItem: jsonc-parser 'modify' produced no edits for path '${elemPath}' and new name '${newName}'. This might happen if the path is incorrect or value is already set.`);
                showMessageBox('info', 'No changes were applied. The name might already be set or the item structure is unexpected.');
                return;
            }
        } catch (error) {
            logger().log('error', `RenameItem: Error while renaming item '${originalName}' to '${newName}' (${elemPath})`, error as Error);
            showMessageBox('err', `Error while renaming item '${originalName}' to '${newName}': ${(error as Error).message}`);
            return;
        }

        const workspaceEdits: vscode.TextEdit[] = edits.map(edit =>
            new vscode.TextEdit(
                new vscode.Range(
                    this.currentDocument!.positionAt(edit.offset),
                    this.currentDocument!.positionAt(edit.offset + edit.length)
                ),
                edit.content
            )
        );

        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.set(this.currentDocument.uri, workspaceEdits);

        const success = await vscode.workspace.applyEdit(workspaceEdit);
        if (success) {
            element.name = newName;
        }

        //this._onDidChangeTreeData.fire([element]);

        if (!success) {
            logger().log('error', `RenameItem: vscode.workspace.applyEdit failed for '${originalName}' to '${newName}' (${elemPath})`);
            showMessageBox('err', `Failed to apply rename for item '${originalName}'.`);
        }
    }

    private addItem(element: ITreeElement): any {
        showMessageBox('info', `Add item '${element.name}' clicked`);
    }

    private onDidChangeVisibleTextEditors(e: readonly vscode.TextEditor[]): any {
        // const editor = e.find(x => x.document.fileName === vscode.window.activeTextEditor?.document.fileName);
        // if (editor) {
        //     logger().log('debug', `LhqTreeDataProvider.onDidChangeVisibleTextEditors: Active editor found: ${editor.document?.fileName ?? '-'}`);
        // } else {
        //     logger().log('debug', "LhqTreeDataProvider.onDidChangeVisibleTextEditors: No active editor found");
        // }
    }

    private onDidOpenTextDocument(e: vscode.TextDocument): any {
        // logger().log('debug', `LhqTreeDataProvider.onDidOpenTextDocument: ${e?.fileName ?? '-'}`);
    }


    private onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent): void {
        // logger().log('debug', `LhqTreeDataProvider.onDocumentChanged: ${e.document?.fileName ?? '-'}`);
        this.updateDocument(e.document);
    }

    public onActiveEditorChanged(e: vscode.TextEditor | undefined): void {
        // logger().log('debug', `LhqTreeDataProvider.onActiveEditorChanged: ${e?.document.fileName ?? '-'}`);
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

    public updateDocument(document: vscode.TextDocument | undefined, forceRefresh = false): void {
        if (document && !isValidDocument(document)) {
            this._lastActiveEditorNonLhq = true;
            // logger().log('debug', `LhqTreeDataProvider.updateDocument skipped due to invalid document.`);
            return;
        }

        // logger().log('debug', `LhqTreeDataProvider.updateDocument with: ${document?.fileName ?? '-'}`);
        if (isValidDocument(document)) {
            setEditorActive(true);
            if (this.currentDocument?.uri.toString() !== document.uri.toString() || !this.currentRootModel || forceRefresh === true) {
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
            this.currentJsonModel = null;

            this.currentRootModel = null;
            try {
                const docText = this.currentDocument.getText();
                this.currentJsonModel = docText?.length > 0 ? JSON.parse(docText) as LhqModel : null;

                this.documentIndent = docText?.length > 0 ? Object.assign({}, defaultIdent, detectIndent(docText)) : defaultIdent;

            } catch (ex) {
                const error = `Error parsing LHQ file '${this.documentPath}'`;
                logger().log('error', error, ex as Error);
                this.currentJsonModel = null;
                showMessageBox('err', error);
            }

            if (this.currentJsonModel) {
                let validateResult: LhqValidationResult | undefined;

                try {
                    validateResult = generatorUtils.validateLhqModel(this.currentJsonModel);
                    if (validateResult.success && validateResult.model) {
                        this.currentRootModel = generatorUtils.createRootElement(validateResult.model);
                    } else {
                        this.currentJsonModel = null;
                    }
                } catch (ex) {
                    this.currentJsonModel = null;
                    const error = `Error validating LHQ file '${this.documentPath}': ${ex}`;
                    logger().log('error', error, ex as Error);
                    showMessageBox('err', error);
                }

                if (this.currentRootModel === null || this.currentRootModel === undefined) {
                    const error = validateResult
                        ? `Validation errors while parsing LHQ file '${this.documentPath}': \n${validateResult.error}`
                        : `Error validating LHQ file '${this.documentPath}'`;
                    logger().log('error', error);
                    showMessageBox('err', error);
                }
            }

        } else {
            this.currentRootModel = null;
        }

        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ITreeElement): vscode.TreeItem {
        return new LhqTreeItem(element);
    }

    getChildren(element?: ITreeElement): Thenable<ITreeElement[]> {
        if (!this.currentRootModel) {
            return Promise.resolve([]);
        }

        let result: ITreeElement[] = [];

        if (element) {
            if (element.elementType === 'resource') {
                result.push(element);
            } else {
                const categLikeElement = element as ICategoryLikeTreeElement;
                result.push(...categLikeElement.categories);
                result.push(...categLikeElement.resources);
            }
        } else {
            result.push(this.currentRootModel);
        }

        return Promise.resolve(result);
    }
}

type DragTreeItem = {
    path: string;
    type: Exclude<TreeElementType, 'model'>;
}