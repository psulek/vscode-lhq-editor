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

        const originalName = element.name;

        const newName = await vscode.window.showInputBox({
            prompt: `Enter new name for ${element.elementType} '${originalName}'`,
            value: originalName,
            validateInput: value => {
                if (isNullOrEmpty(value)) {
                    return 'Name cannot be empty.';
                }
                if (value === originalName) {
                    return 'New name is the same as the old name.';
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

        //const rs = jsonVisit(documentText, visitor, { allowEmptyContent: true, allowTrailingComma: true });

        const jsonPathToElementObject = this.getElementJsonPathInModel(element, lhqModelFromFile);

        if (!jsonPathToElementObject) {
            logger().log('error', `RenameItem: Could not determine JSON path for element '${getElementFullPath(element)}'.`);
            showMessageBox('err', `Could not locate item '${originalName}' in the document structure for renaming.`);
            return;
        }

        //const jsonPathToNameProperty = [...jsonPathToElementObject, 'name'];
        const jsonPathToNameProperty = [...jsonPathToElementObject];


        const errs: any = [];
        const opts = { allowEmptyContent: true, allowTrailingComma: true };
        const tree = parseTree(documentText, errs as any);

        function findNode(nodes: jsonNode[] | undefined): jsonNode | undefined {
            if (!nodes || nodes.length === 0) {
                return undefined;
            }

            for (const node of nodes) {
                const path = getNodePath(node);
                if (path.length === jsonPathToNameProperty.length && path.every((p, i) => p === jsonPathToNameProperty[i])) {
                    return node;
                }
                const childNode = findNode(node.children);
                if (childNode) {
                    return childNode;
                }
            }
            return undefined;
        }

        // const r1 = findNodeAtLocation(tree!, jsonPathToNameProperty)!;
        // const x1 = getNodeValue(r1);

        const node = findNode(tree!.children);
        //const x2 = getNodeValue(r2);

        // const edits: EditResult = [];
        // if (node) {
        //     edits.push({ content: newName, offset: node.offset, length: newName.length });
        // }

        //jsonFormat()

        const documentUri = this.currentDocument.uri;
        // const formattingOptions: FormattingOptions = {
        //     insertSpaces: this.documentIndent.type === 'space',
        //     tabSize: this.documentIndent.amount,
        //     keepLines: true
        // };

        //const edits = jsonModify(documentText, jsonPathToNameProperty, undefined, { formattingOptions });

        

        const edits = renameJsonProperty(element, newName, documentText, this.documentIndent);
        if (!edits) {
            logger().log('debug', `RenameItem: jsonc-parser 'modify' produced no edits for path '${jsonPathToNameProperty.join('/')}' and new name '${newName}'. This might happen if the path is incorrect or value is already set.`);
            showMessageBox('info', 'No changes were applied. The name might already be set or the item structure is unexpected.');
            return;
        }

        // const edits = jsonModify(documentText, jsonPathToNameProperty, newName, {
        //     formattingOptions: {
        //         insertSpaces: this.documentIndent.type === 'space',
        //         tabSize: this.documentIndent.amount,
        //         keepLines: true, // This option is specific to jsonc-parser's modify behavior
        //     }
        // });

        // if (!edits || edits.length === 0) {
        //     logger().log('warn', `RenameItem: jsonc-parser 'modify' produced no edits for path '${jsonPathToNameProperty.join('/')}' and new name '${newName}'. This might happen if the path is incorrect or value is already set.`);
        //     showMessageBox('info', 'No changes were applied. The name might already be set or the item structure is unexpected.');
        //     return;
        // }

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
        workspaceEdit.set(documentUri, workspaceEdits);

        const success = await vscode.workspace.applyEdit(workspaceEdit);

        if (success) {
            showMessageBox('info', `Item '${originalName}' renamed to '${newName}'. You can use standard Undo (Ctrl+Z) to revert.`);
        } else {
            logger().log('error', `RenameItem: vscode.workspace.applyEdit failed for '${originalName}' to '${newName}'.`);
            showMessageBox('err', `Failed to apply rename for item '${originalName}'.`);
        }
    }

    private getElementJsonPathInModel(element: ITreeElement, model: LhqModel): (string | number)[] | undefined {
        if (!this.currentRootModel) {
            logger().log('error', "getElementJsonPathInModel: currentRootModel is not available.");
            return undefined;
        }

        const elementType = element.elementType;
        if (elementType === 'model') {
            return ['model'];
        }

        const paths = element.paths.getPaths(false);
        const lastPath = paths.pop() ?? '';
        const result: string[] = [];

        if (!isNullOrEmpty(lastPath)) {
            paths.every(p => result.push(...[`categories`, p]));
            result.push(...[elementType === 'resource' ? 'resources' : 'categories', lastPath]);
        }

        return result;

        //const fullPathString = getElementFullPath(element);
        //const pathSegmentsFromName: string[] = fullPathString.split('/');

        // let currentContextInRawModel: any = model;
        // const jsonPath: (string | number)[] = [];

        // const rootModelNameFromPath = pathSegmentsFromName[0];

        // if (model.model && typeof model.model === 'object' && (model.model as any).name === rootModelNameFromPath) {
        //     currentContextInRawModel = model.model;
        //     jsonPath.push('model');
        // } else if (this.currentRootModel.name === rootModelNameFromPath) {
        //     if (model.model && typeof model.model === 'object') {
        //         if ((model.model as any).name === rootModelNameFromPath) {
        //             currentContextInRawModel = model.model;
        //             jsonPath.push('model');
        //         } else {
        //             logger().log('warn', `getElementJsonPathInModel: Root model name '${rootModelNameFromPath}' matched currentRootModel.name, but not model.model.name. Assuming 'model.model' or 'model' as context if applicable.`);
        //             if (model.model && typeof model.model === 'object') {
        //                 currentContextInRawModel = model.model;
        //                 jsonPath.push('model');
        //             }
        //         }
        //     }
        // } else {
        //     logger().log('warn', `getElementJsonPathInModel: Root model name '${rootModelNameFromPath}' not directly found as 'model.model.name' or matching currentRootModel.name. Assuming 'model' or 'model.model' is the context.`);
        //     if (model.model && typeof model.model === 'object') {
        //         currentContextInRawModel = model.model;
        //         jsonPath.push('model');
        //     }
        // }

        // const segmentsToSearch = pathSegmentsFromName.slice(1);

        // for (const segmentName of segmentsToSearch) {
        //     let foundNextContext = false;
        //     if (currentContextInRawModel && typeof currentContextInRawModel === 'object') {
        //         if (Array.isArray(currentContextInRawModel.categories)) {
        //             const index = currentContextInRawModel.categories.findIndex((cat: any) => cat.name === segmentName);
        //             if (index !== -1) {
        //                 jsonPath.push('categories', index);
        //                 currentContextInRawModel = currentContextInRawModel.categories[index];
        //                 foundNextContext = true;
        //             }
        //         }
        //         if (!foundNextContext && Array.isArray(currentContextInRawModel.resources)) {
        //             const index = currentContextInRawModel.resources.findIndex((res: any) => res.name === segmentName);
        //             if (index !== -1) {
        //                 jsonPath.push('resources', index);
        //                 currentContextInRawModel = currentContextInRawModel.resources[index];
        //                 foundNextContext = true;
        //             }
        //         }
        //         if (!foundNextContext && Object.prototype.hasOwnProperty.call(currentContextInRawModel, segmentName) && typeof currentContextInRawModel[segmentName] === 'object') {
        //             jsonPath.push(segmentName);
        //             currentContextInRawModel = currentContextInRawModel[segmentName];
        //             foundNextContext = true;
        //         }

        //         if (!foundNextContext) {
        //             logger().log('error', `getElementJsonPathInModel: Segment '${segmentName}' not found or not an object/array in current JSON context. Path so far: ${jsonPath.join('/')}`);
        //             return undefined;
        //         }
        //     } else {
        //         logger().log('error', `getElementJsonPathInModel: Cannot traverse. Current JSON context is not an object for segment '${segmentName}'. Path: ${jsonPath.join('/')}`);
        //         return undefined;
        //     }
        // }
        // return jsonPath;
    }

    private addItem(element: ITreeElement): any {
        showMessageBox('info', `Add item '${element.name}' clicked`);
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
            this.currentJsonModel = null;

            // setTimeout(() => {
            //     test1();
            // }, 1);


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