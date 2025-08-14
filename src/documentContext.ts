import * as vscode from 'vscode';
import path from 'node:path';
import fse from 'fs-extra';
import { nextTick } from 'node:process';
import { createTreeElementPaths, delay, generateNonce, getElementFullPath, getGeneratorAppErrorMessage, isValidDocument, logger, showConfirmBox, showOpenFileDialog, showMessageBox, showNotificationBox, showSaveFileDialog } from './utils';
import { AppToPageMessage, ClientPageError, ClientPageModelProperties, ClientPageSettingsError, CultureInfo, IDocumentContext, IVirtualLanguageElement, IVirtualRootElement, NotifyDocumentActiveChangedCallback, PageToAppMessage, SelectionBackup, StatusBarItemUpdateRequestCallback, ValidationError } from './types';
import { CategoryLikeTreeElementToJsonOptions, CategoryOrResourceType, CodeGeneratorGroupSettings, detectFormatting, FormattingOptions, GeneratedFile, Generator, generatorUtils, HbsTemplateManager, ICategoryLikeTreeElement, ImportModelErrorKind, ImportModelMode, ImportModelResult, IResourceElement, IResourceParameterElement, IResourceValueElement, IRootModelElement, isNullOrEmpty, ITreeElement, LhqModel, LhqModelResourceTranslationState, LhqValidationResult, modelConst, ModelUtils, strCompare, TreeElementType } from '@lhq/lhq-generators';
import { filterTreeElements, filterVirtualTreeElements, isVirtualTreeElement, validateTreeElementName, VirtualRootElement } from './elements';
import { AvailableCommands, Commands, getCurrentFolder } from './context';
import { CodeGenStatus } from './codeGenStatus';
import { ImportFileSelector } from './impExp/importFileSelector';
import { ExportFileSelectedData, ImportFileSelectedData } from './impExp/types';
import { ImportExportManager } from './impExp/manager';
import { ExcelDataExporter } from './impExp/excelExpoter';
import { ExportFileSelector } from './impExp/exportFileSelector';

type LangTypeMode = 'all' | 'neutral' | 'country';

interface LanguageQuickPickItem extends vscode.QuickPickItem {
    culture: CultureInfo;
}

interface LangTypeQuickPickItem extends vscode.QuickPickItem {
    mode: LangTypeMode;
}

const LanguageTypeModes = [
    {
        label: 'All languages',
        description: 'Select from all available languages',
        mode: 'all',
    },
    {
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        label: 'Neutral languages',
        detail: `Example: en, de, ...`,
        mode: 'neutral'
    },
    {
        label: 'Country-specific languages',
        detail: `Example: en-US , de-DE, ...`,
        mode: 'country'
    }
] as LangTypeQuickPickItem[];

type UpdateOptions = {
    forceRefresh?: boolean;
    undoRedo?: boolean;
};

export class DocumentContext implements IDocumentContext {
    private readonly _context: vscode.ExtensionContext;
    private readonly _webviewPanel: vscode.WebviewPanel;
    private readonly _codeGenStatus: CodeGenStatus;
    private readonly _onDidDispose: () => void;
    private readonly _notifyDocumentActiveChangedCallback: NotifyDocumentActiveChangedCallback;

    private _textDocument: vscode.TextDocument | undefined;
    private _selectedElements: ITreeElement[] = [];
    private _disposed = false;
    private _fileName: string | undefined;
    private _documentUri: vscode.Uri | undefined;
    private _documentText: string | undefined;
    private _jsonModel: LhqModel | undefined;
    private _documentFormatting!: FormattingOptions;
    private _rootModel!: IRootModelElement | undefined;
    private _virtualRootElement: IVirtualRootElement | undefined;
    private _pageErrors: ClientPageError[] = [];
    private _isActive = false;
    private _lastRequestPageReload = '';
    private _isReadonly = false;
    private _manualSaving = false;

    private _importFileSelectedData: ImportFileSelectedData = {
        engine: 'MsExcel',
        mode: 'merge',
        file: undefined,
        allowNewElements: false
    };

    private _exportFileSelectedData: ExportFileSelectedData = {
        engine: 'MsExcel',
        file: undefined,
        languages: undefined
    };

    constructor(context: vscode.ExtensionContext, webviewPanel: vscode.WebviewPanel, onDidDispose: () => void,
        requestStatusBarItemUpdate: StatusBarItemUpdateRequestCallback,
        notifyDocumentActiveChangedCallback: NotifyDocumentActiveChangedCallback
    ) {
        this._context = context;
        this._webviewPanel = webviewPanel;
        this._onDidDispose = onDidDispose;
        this._notifyDocumentActiveChangedCallback = notifyDocumentActiveChangedCallback;

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'media'),
                vscode.Uri.joinPath(context.extensionUri, 'dist'),
            ]
        };

        this.isActive = true;
        this._codeGenStatus = new CodeGenStatus(this, requestStatusBarItemUpdate);

        this.setupEvents();
    }

    public get jsonModel(): LhqModel | undefined {
        return this._jsonModel;
    }

    public get documentFormatting(): FormattingOptions {
        return this._documentFormatting;
    }

    public get fileName(): string {
        return this._fileName ?? '';
    }

    public get documentUri(): vscode.Uri | undefined {
        return this._documentUri;
    }

    public get isReadonly(): boolean {
        return this._isReadonly;
    }

    public get isDirty(): boolean {
        if (this._disposed) {
            logger().log(this, 'debug', `isDirty -> DocumentContext is disposed. Ignoring dirty check.`);
            return false;
        }

        if (!this._textDocument) {
            return false;
        }

        return this._textDocument.isDirty;
    }

    public setReadonlyMode(readonly: boolean) {
        this._isReadonly = readonly;

        this.sendMessageToHtmlPage({ command: 'blockEditor', block: readonly });
    }

    public get isActive(): boolean {
        if (this._disposed) {
            return false;
        }

        return this._isActive;
    }

    public set isActive(value: boolean) {
        if (this._disposed) {
            logger().log(this, 'debug', `set isActive -> DocumentContext is disposed. Ignoring active state change.`);
            return;
        }

        // this is here only to trigger the error if webviewPanel is not available
        try {
            const panelActive = this._webviewPanel?.active === true;
        } catch (error) {
            return;
        }

        if (this._isActive !== value) {
            this._isActive = value;
            logger().log(this, 'debug', `set isActive -> DocumentContext(${this.fileName}) is now ${value ? 'active' : 'inactive'}.`);
            this._notifyDocumentActiveChangedCallback(this, value);
        }
    }

    public get rootModel(): IRootModelElement | undefined {
        return this._rootModel;
    }

    public get virtualRootElement(): IVirtualRootElement | undefined {
        return this._virtualRootElement;
    }

    public get resourcesUnderRoot(): boolean {
        return this._rootModel?.options.resources === 'All';
    }

    public get isTreeStructure(): boolean {
        return this._rootModel?.options.categories === true;
    }

    public get codeGeneratorTemplateId(): string {
        return this._rootModel?.codeGenerator?.templateId ?? '';
    }

    private get treeContext() {
        return appContext.treeContext;
    }

    public isSameDocument(document: vscode.TextDocument): boolean {
        if (this._disposed) {
            logger().log(this, 'debug', `isSameDocument -> DocumentContext is disposed. Ignoring document check.`);
            return false;
        }
        return !isNullOrEmpty(this._documentUri) && this._documentUri.toString() === document.uri.toString();
    }

    private getCategoryLikeParent(element: ITreeElement): ICategoryLikeTreeElement | undefined {
        if (!element) {
            return undefined;
        }

        if (element.elementType === 'resource') {
            return element.parent ?? this.rootModel;
        }

        return element.parent;
    }

    private async updateElement(element: Record<string, unknown>): Promise<void> {
        if (!element || !this._rootModel) {
            return;
        }

        const path = element.paths as string[];
        const elementType = element.elementType as TreeElementType;
        const paths = createTreeElementPaths('/' + path.join('/'), true);
        const elem = elementType === 'model'
            ? this._rootModel
            : this._rootModel.getElementByPath(paths, elementType as CategoryOrResourceType);

        interface ITranslationItem {
            valueRef: Partial<IResourceValueElement>;
            culture: CultureInfo;
            isPrimary: boolean;
            //invalidMessage?: string;
        }

        if (elem && !isVirtualTreeElement(elem)) {
            const newName = (element.name as string ?? '').trim();

            const elemFullPath = getElementFullPath(elem);
            // always validate name
            const validationError = validateTreeElementName(elementType, newName, elem.parent, elemFullPath);
            if (validationError) {
                this.setPageError(elem, 'name', validationError);

                this.sendMessageToHtmlPage({
                    command: 'invalidData',
                    fullPath: elemFullPath,
                    message: validationError,
                    action: 'add',
                    field: 'name'
                });
                return;
            } else {
                if (this.removePageError(elem, 'name')) {
                    this.sendMessageToHtmlPage({
                        command: 'invalidData',
                        fullPath: elemFullPath,
                        message: '',
                        action: 'remove',
                        field: 'name'
                    });
                }
            }

            let changed = false;
            if (newName !== elem.name) {
                elem.name = newName;
                changed = true;
            }

            const newDescription = element.description as string | undefined;
            if (newDescription !== elem.description) {

                // if (!this.checkForInvalidUnicodeChars(elem, elemFullPath, 'description', newDescription)) {
                //     return;
                // }

                elem.description = newDescription;
                changed = true;
            }

            if (elementType === 'resource') {
                const res = elem as IResourceElement;

                const newState = element.state as LhqModelResourceTranslationState ?? 'New';
                if (res.state !== newState) {
                    res.state = newState;
                    changed = true;
                }

                // parameters
                const oldParams = res.parameters.map(x => `${x.name}:${x.order}`).join(',');
                const params = element.parameters as Array<Partial<IResourceParameterElement>>;
                const newParams = params.map(x => `${x.name}:${x.order}`).join(',');

                if (newParams !== oldParams) {
                    changed = true;
                    res.removeParameters();
                    res.addParameters(params, { existing: 'skip' });
                }

                // values
                const oldValues = res.values.map(x => `${x.languageName}:${x.value}:${x.locked}`).join(',');
                const values: Array<Partial<IResourceValueElement>> = (element.translations as Array<ITranslationItem>)
                    .map(x => ({
                        languageName: x.valueRef.languageName,
                        value: x.valueRef.value,
                        locked: x.valueRef.locked
                    }));
                const newValues = values.map(x => `${x.languageName}:${x.value}:${x.locked}`).join(',');

                if (newValues !== oldValues) {

                    // if (!this.checkForInvalidUnicodeChars(elem, elemFullPath, 'description', newDescription)) {
                    //     return;
                    // }


                    changed = true;
                    res.removeValues();
                    res.addValues(values, { existing: 'skip' });
                }
            }

            if (changed) {
                const elemPath = getElementFullPath(elem);
                const pathChanged = elemPath !== elemFullPath;

                await this.commitChanges(`updateElement (${elemPath})`);

                if (pathChanged) {
                    await appContext.treeContext.showLoading('Renaming ...');

                    await appContext.treeContext.selectElementByPath(elem.elementType, elem.paths.getPaths(true));
                }
                else {
                    appContext.treeContext.refreshTree([elem]);
                }
            } else {
                logger().log(this, 'debug', `updateElement -> No changes for element '${getElementFullPath(elem)}'.`);
            }
        } else {
            logger().log(this, 'debug', `updateElement -> Element not found or is virtual: ${path.join('/')}`);
        }
    }

    private checkForInvalidUnicodeChars(elem: ITreeElement, elemFullPath: string, field: string, value: string | undefined) {
        if (isNullOrEmpty(value)) {
            return true;
        }

        const hasInvalidChars = ModelUtils.containsInvalidUnicodeChars(value);

        if (hasInvalidChars) {
            const validationError = 'Invalid unicode characters found in the value. ';
            this.setPageError(elem, field, validationError);

            this.sendMessageToHtmlPage({
                command: 'invalidData',
                fullPath: elemFullPath,
                message: validationError,
                action: 'add',
                field: field
            });
            return;
        } else {
            if (this.removePageError(elem, field)) {
                this.sendMessageToHtmlPage({
                    command: 'invalidData',
                    fullPath: elemFullPath,
                    message: '',
                    action: 'remove',
                    field: field
                });
            }
        }
    }

    public async commitChanges(message: string): Promise<boolean> {

        if (this._disposed) {
            logger().log(this, 'debug', `commitChanges [${message}] -> DocumentContext is disposed. Ignoring changes.`);
            return false;
        }

        if (!this._rootModel) {
            logger().log(this, 'debug', `commitChanges [${message}] -> No root model available.`);
            return false;
        }

        if (!this._textDocument) {
            logger().log(this, 'debug', `commitChanges [${message}] -> No text document available.`);
            return false;
        }

        this.validateDocument();
        const newModel = ModelUtils.elementToModel<LhqModel>(this._rootModel!, {
            values: {
                eol: 'CRLF', // backward compatibility, always use CRLF in values new lines
                sanitize: false // do not sanitize now, maybe later...
            }
        });
        const serializedRoot = ModelUtils.serializeModel(newModel, this._documentFormatting);

        const edit = new vscode.WorkspaceEdit();
        const doc = this._textDocument;
        edit.replace(
            doc.uri,
            new vscode.Range(0, 0, doc.lineCount, 0),
            serializedRoot);

        const res = await vscode.workspace.applyEdit(edit);
        if (res) {
            this._jsonModel = newModel;
        }

        logger().log(this, 'debug', `commitChanges [${message}] -> Changes applied: ${res ? 'successfully' : 'failed'}.`);

        return res;
    }

    public async saveDocument(): Promise<boolean> {
        if (this._disposed) {
            logger().log(this, 'debug', `saveDocument -> DocumentContext is disposed. Ignoring save request.`);
            return false;
        }

        if (!this._textDocument) {
            logger().log(this, 'debug', `saveDocument -> No text document available.`);
            return false;
        }

        if (this._textDocument.isDirty) {
            logger().log(this, 'debug', `saveDocument -> Saving document: ${this.fileName}`);
            try {
                this._manualSaving = true;
                await this._textDocument.save();
                return !this._textDocument.isDirty;
            } catch (error) {
                logger().log(this, 'error', `saveDocument -> Error while saving document: ${this.fileName}`, error as Error);
                showNotificationBox('err', `Error while saving document: ${this.fileName}`);
            } finally {
                this._manualSaving = false;
            }
        } else {
            logger().log(this, 'debug', `saveDocument -> Document is not dirty, no need to save.`);
        }

        return false;
    }

    public async update(document: vscode.TextDocument | undefined, options?: UpdateOptions): Promise<void> {
        const newFileName = document?.fileName ?? '';
        if (document && isValidDocument(document)) {
            const sameDoc = this.isSameDocument(document);

            options = Object.assign({}, { forceRefresh: false, undoRedo: false } as UpdateOptions, options);

            this._textDocument = document;
            this._fileName = newFileName;
            this._documentUri = document.uri;
            appContext.enableEditorActive();
            appContext.readonlyMode = false;

            let backupSelection: SelectionBackup | undefined;
            if (sameDoc || !this._rootModel || options.forceRefresh) {
                logger().log(this, 'debug', `update() for: ${this.fileName}, forceRefresh: ${options.forceRefresh}, undoRedo: ${options.undoRedo}`);

                await this.refresh(document);

                // after undo/redo, current this._selectedElements folds obsolete refs to elements, 
                // needs to find actual based on elem type and paths (from backupSelection as tree holds actual elements)
                backupSelection = appContext.treeContext.backupSelection();
            }

            const lastRPRuid = this._lastRequestPageReload;

            appContext.treeContext.updateDocument(this);

            if (backupSelection) {
                this._selectedElements = appContext.treeContext.getElementsFromSelection(backupSelection);
            }

            // if requestPageReload was not send already and undo/redo was requested, then we need to do 'loadpage'
            if (lastRPRuid === this._lastRequestPageReload && options.undoRedo === true) {
                logger().log(this, 'debug', `update() -> Requesting page reload for: ${this.fileName} (for undoRedo)`);
                this.reflectSelectedElementToWebview(true);
            }
        } else if (appContext.isEditorActive) {
            this._textDocument = undefined;
            await this.refresh();

            appContext.treeContext.updateDocument(undefined);

            // NOTE: needs to be next tick to ensure treeview refresh is done before we hide it (via isEditorActive = false)
            nextTick(() => {
                appContext.disableEditorActive();
            });
        }
    }

    private async refresh(document?: vscode.TextDocument): Promise<void> {
        this.clearPageErrors();
        this._codeGenStatus.inProgress = false;

        if (document) {
            this._jsonModel = undefined;
            this._rootModel = undefined;
            this._virtualRootElement = undefined;

            try {
                this._documentText = document.getText();
                this._jsonModel = this._documentText?.length > 0 ? JSON.parse(this._documentText) as LhqModel : undefined;
                this._documentFormatting = detectFormatting(this._documentText);
            } catch (ex) {
                const error = `Error parsing LHQ file '${this._fileName}'`;
                logger().log(this, 'error', `refresh failed -> ${error}`, ex as Error);
                this._jsonModel = undefined;
                showNotificationBox('err', error);
            }

            if (this._jsonModel) {
                let validateResult: LhqValidationResult | undefined;
                const jsonModel = this._jsonModel!;

                try {
                    validateResult = generatorUtils.validateLhqModel(jsonModel);
                    if (validateResult.success && validateResult.model) {
                        this._rootModel = ModelUtils.createRootElement(validateResult.model);
                        this._virtualRootElement = new VirtualRootElement(this._rootModel);

                    } else {
                        this._jsonModel = undefined;
                    }
                } catch (ex) {
                    this._jsonModel = undefined;
                    const error = `Error validating LHQ file '${this.fileName}': ${ex}`;
                    logger().log(this, 'error', `refresh failed -> ${error}`, ex as Error);
                    showNotificationBox('err', error);
                }

                if (this._rootModel === undefined) {
                    const error = validateResult
                        ? `Validation errors while parsing LHQ file '${this.fileName}': \n${validateResult.error}`
                        : `Error validating LHQ file '${this.fileName}'`;
                    logger().log(this, 'error', `refresh failed -> ${error}`);
                    showNotificationBox('err', error);
                } else {
                    this._codeGenStatus.update({ kind: 'idle' });
                }

                this.validateDocument();
            }
        } else {
            this._jsonModel = undefined;
            this._rootModel = undefined;
            this._virtualRootElement = undefined;
        }
    }

    public async validateLanguages(): Promise<boolean> {
        const root = this._rootModel;
        if (!root) {
            return false;
        }

        let rootLanguages = new Set(root.languages);
        let madeChanges = false;

        const addLanguagesToRoot = async (langs: string[], setAsPrimary?: string): Promise<void> => {
            if (!root || langs.length === 0) {
                return;
            }

            let added = false;
            langs.forEach(lang => {
                const culture = appContext.findCulture(lang);
                if (culture) {
                    if (root.addLanguage(culture.name)) {
                        added = true;
                    }
                } else {
                    logger().log(this, 'warn', `validateLanguages -> Unknown culture '${lang}' found in resources.`);
                }
            });

            if (!isNullOrEmpty(setAsPrimary) && root.containsLanguage(setAsPrimary)) {
                root.primaryLanguage = setAsPrimary;
            }

            rootLanguages = new Set(root.languages);

            await this.commitChanges('addLanguagesToRoot');

            if (added && this._virtualRootElement) {
                this.treeContext.refreshTree(undefined);
                this._virtualRootElement.refresh();
                this._virtualRootElement.languagesRoot.refresh();
                madeChanges = true;
            }
        };

        appContext.readonlyMode = true;

        try {

            // list of all languages used in resources
            let resourceLanguages = new Set<string>();
            root.iterateTree(element => {
                if (element.elementType === 'resource') {
                    const resource = element as IResourceElement;
                    resource.values?.forEach(value => {
                        if (value.languageName) {
                            resourceLanguages.add(value.languageName);
                        }
                    });
                }
            }, { root: false, categories: false, resources: true }); // this will call callback for resources only

            // test if there is any language that is missing in root.languages
            const missingLangsOnRoot = new Set<string>();
            resourceLanguages.forEach(resLang => {
                if (!rootLanguages.has(resLang)) {
                    missingLangsOnRoot.add(resLang);
                }
            });

            if (missingLangsOnRoot.size > 0) {
                const missingLangs = Array.from(missingLangsOnRoot);
                const maxDisplayCount = 10;

                let langsNames = missingLangs.length === 1
                    ? appContext.getCultureDesc(missingLangs[0])
                    : missingLangs.slice(0, maxDisplayCount).map(x => `'${appContext.getCultureDesc(x)}'`).join(', ');

                if (missingLangs.length > maxDisplayCount) {
                    langsNames += ` and ${missingLangs.length - maxDisplayCount} more ...`;
                }

                if (await showConfirmBox(`Detected that model missing some language(s)`,
                    `The model contains resources with languages that are not defined in the model.\n` +
                    `Missing languages: ${langsNames}. `, {
                    warn: true,
                    yesText: 'Add missing languages',
                })) {

                    await addLanguagesToRoot(missingLangs);
                } else {
                    await showMessageBox('warn', `Missing languages in the model`,
                        `Please add manually these languages, otherwise you will not see them when editing resources!\n` +
                        `Missing languages: ${langsNames}. `, false);

                    return false;
                }
            }

            if (rootLanguages.size === 0) {
                // model has no langs, but has defined primary lang, so check if is valid and add it to root
                if (!isNullOrEmpty(root.primaryLanguage)) {
                    const primaryCulture = appContext.findCulture(root.primaryLanguage);
                    if (primaryCulture) {
                        await addLanguagesToRoot([primaryCulture.name], primaryCulture.name);

                        const displayName = appContext.getCultureDesc(primaryCulture.name);
                        showNotificationBox('info', `Primary language '${displayName}' was automatically added to the model.`);
                        return true;
                    }
                }

                const enName = appContext.getCultureDesc('en');

                await addLanguagesToRoot(['en'], 'en');
                await showMessageBox('warn', 'Model does not contain any languages!',
                    `Language ${enName} was automatically added to the model and was set as primary.\n` +
                    `Please review list of languages in document.`);

                return true;
            }

            // refresh list of root languages after adding missing languages
            rootLanguages = new Set(root.languages);

            if (rootLanguages.size === 0) {
                let newLang = 'en';
                if (!isNullOrEmpty(root.primaryLanguage)) {
                    const primaryCulture = appContext.findCulture(root.primaryLanguage);
                    if (primaryCulture) {
                        newLang = primaryCulture.name;
                    }
                }

                await addLanguagesToRoot([newLang], newLang);
                const enName = appContext.getCultureDesc(newLang);
                showNotificationBox('info', `Language '${enName}' was automatically added to the model and was set as primary.`);
                return true;
            }


            let selectPrimaryLang = isNullOrEmpty(root.primaryLanguage);
            let selectPrimaryLangMsg = 'No primary language defined in the model.';
            if (!isNullOrEmpty(root.primaryLanguage) && !rootLanguages.has(root.primaryLanguage)) {
                const primaryLang = root.primaryLanguage;

                if (!appContext.findCulture(primaryLang)) {
                    selectPrimaryLang = true;
                    selectPrimaryLangMsg = `Unknown primary language '${primaryLang}' defined in the model.`;
                    await addLanguagesToRoot(['en']);
                } else {
                    const primaryLangDisplayName = appContext.getCultureDesc(primaryLang);
                    showNotificationBox('info', `Primary language '${primaryLangDisplayName}' was added to the model.`);

                    await addLanguagesToRoot([primaryLang]);
                    return true;
                }
            }

            if (selectPrimaryLang) {
                const newPrimaryLang = rootLanguages.has('en') ? 'en' : Array.from(rootLanguages)[0];
                const newPrimaryLangName = appContext.getCultureDesc(newPrimaryLang);
                showNotificationBox('warn', selectPrimaryLangMsg + ' \n' +
                    `Language '${newPrimaryLangName}' was automatically set as primary language.`);

                root.primaryLanguage = newPrimaryLang;
                const langRoot = this._virtualRootElement!.languagesRoot;
                this._virtualRootElement!.refresh();
                madeChanges = true;

                await this.commitChanges('markLanguageAsPrimary');

                await this.treeContext.clearSelection(true);

                langRoot.refresh();
                this.treeContext.refreshTree([langRoot]);
                await this.treeContext.revealElement(langRoot, { expand: true, select: true, focus: true });
            }
        } finally {
            appContext.readonlyMode = false;

            if (madeChanges) {
                await appContext.treeContext.showLoading('Applying changes ...');
                await appContext.treeContext.selectRootElement();
            }
        }

        return true;
    }

    public resetGeneratorStatus(): void {
        this._codeGenStatus.resetGeneratorStatus();
    }

    public async exportModelToFile(): Promise<void> {
        if (!this.rootModel) {
            logger().log(this, 'debug', 'exportModelToFile -> No root model found. Cannot export to file.');
            return;
        }

        if (this._codeGenStatus.inProgress) {
            logger().log(this, 'debug', 'exportModelToFile -> Code generator is already in progress. Cannot export to file.');
            return;
        }

        try {
            // const currentFolder = appContext.getCurrentFolder();
            // const date = new Date().toISOString().replace(/[:.-]/g, '').slice(0, 15); // format: YYYYMMDDTHHMMSS
            // const fileName = currentFolder ? path.join(currentFolder.fsPath, `exported-${date}`) : `exported-${date}`;
            // const newFile = await showSaveFileDialog('Enter file name where to export resources', {
            //     filters: { 'Excel files': ['xlsx'] },
            //     defaultUri: currentFolder ? vscode.Uri.file(fileName) : undefined,
            //     title: 'Export resources to Excel file'
            // });

            // if (!newFile) {
            //     return;
            // }

            //await new ExcelDataExporter().exportToFile(newFile.fsPath, this.rootModel, this.fileName);
            const exportInfo = await ExportFileSelector.showRoot(this._exportFileSelectedData, this.rootModel);
            if (!exportInfo) {
                return;
            }

            this._exportFileSelectedData = exportInfo;
            const file = exportInfo.file!;
            if (isNullOrEmpty(file)) {
                return await showMessageBox('err', 'No file selected for export.');
            }

            const engine = exportInfo.engine;

            appContext.readonlyMode = true;

            let exportError: string | undefined = undefined;
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                cancellable: false,
                title: `Exporting file: ${file} (${engine}) ...`
            }, async () => {
                exportError = await ImportExportManager.exportToFile(engine, file, this.rootModel!, this.fileName, exportInfo.languages);
            });

            if (!await fse.pathExists(file)) {
                exportError = `Export failed, could not create file: ${file}`;
            }

            if (isNullOrEmpty(exportError)) {
                vscode.env.openExternal(vscode.Uri.file(file));
                await showMessageBox('info', `Model was successfully exported to: ${file}`);

            } else {
                await showMessageBox('err', `Failed to export model to file !`,
                    `Exporting to file ${file} (${engine}) failed.\n${exportError}`);
            }
        } catch (error) {
            logger().log(this, 'error', `exportModelToFile -> Error while exporting model to file: ${error}`);
            await showMessageBox('err', `Error exporting model to file`, error instanceof Error ? error.message : String(error));
        } finally {
            appContext.readonlyMode = false;
        }
    }

    public async importModelFromFile(): Promise<void> {
        if (!this.rootModel) {
            logger().log(this, 'debug', 'importModelFromFile -> No root model found. Cannot import from file.');
            return;
        }

        if (this._codeGenStatus.inProgress) {
            logger().log(this, 'debug', 'importModelFromFile -> Code generator is already in progress. Cannot import from file.');
            return;
        }

        let file = '';

        try {

            const importInfo = await ImportFileSelector.showRoot(this._importFileSelectedData);
            if (!importInfo) {
                return;
            }

            this._importFileSelectedData = importInfo;
            const fileInfo = importInfo.file;
            if (!fileInfo || (!(await fse.pathExists(fileInfo)))) {
                const err = isNullOrEmpty(fileInfo) ? 'No file selected.' : `File '${fileInfo}' does not exist.`;
                return await showMessageBox('err', err);
            }

            if (strCompare(fileInfo, this.fileName, true)) {
                return await showMessageBox('err', `Cannot import model from the same file: ${fileInfo}. Please select another file.`);
            }

            file = fileInfo;

            const engine = importInfo.engine;

            const rootModel = this.rootModel;
            let importResult: ImportModelResult | undefined;

            appContext.readonlyMode = true;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                cancellable: false,
                title: `Importing file: ${file} (${engine}) ...`
            }, async () => {
                const importData = await ImportExportManager.getImportData(file, engine);
                const isError = !isNullOrEmpty(importData) && typeof importData === 'string';

                if (!isError && !isNullOrEmpty(importData)) {
                    importData.cloneSource = false;
                    importData.importNewLanguages = true;
                    importData.importNewElements = importInfo.allowNewElements;
                    // importData.importNewElements = importInfo.mode === 'importAsNew';

                    importResult = ModelUtils.importModel(rootModel, importInfo.mode, importData);
                } else {
                    await showMessageBox('err', `Error importing model from '${engine}' file: ${file} `, importData);
                }
            });

            if (!importResult) {
                return;
            }

            if (importResult.errorKind) {
                logger().log(this, 'error', `importModelFromFile(${file}) -> Error importing model from '${engine}' -> '${importResult.error}'(${importResult.errorKind})`);
                const importError = this.getImportError(importResult.errorKind, importInfo);
                return await showMessageBox('err', importError.message, importError.detail);
            }

            await this.commitChanges('importModelFromFile');

            const langRoot = this._virtualRootElement!.languagesRoot;
            await this.treeContext.clearSelection(true);
            langRoot.refresh();
            this._virtualRootElement!.refresh();

            this.treeContext.refreshTree(undefined);

            const fileBase = path.basename(file);
            let successMsg = `Resources were successfully imported from '${fileBase}' file.`;
            let successDetail = 'Resource(s) were merged into existing resources.';
            if (importInfo.mode === 'merge' || isNullOrEmpty(importResult.newCategoryPaths)) {
                await this.treeContext.selectRootElement();
            } else {
                const fullPath = getElementFullPath(importResult.newCategoryPaths);
                successDetail = `Resource(s) were imported into new category: ${fullPath}.`;
                await appContext.treeContext.selectElementByPath('category', importResult.newCategoryPaths.getPaths(true), true);
            }

            appContext.readonlyMode = false;
            await showMessageBox('info', successMsg, successDetail);
        } catch (error) {
            logger().log(this, 'error', `importModelFromFile -> Error while importing model from file: ${error} `);
            await showMessageBox('err', `Error importing model from file: ${file} `, error instanceof Error ? error.message : String(error));
        } finally {
            appContext.readonlyMode = false;
        }
    }

    private getImportError(errorKind: ImportModelErrorKind, data: ImportFileSelectedData): { message: string, detail?: string } {
        const engine = ImportExportManager.getImporter(data.engine)!.name;
        const file = isNullOrEmpty(data.file) ? '-' : data.file;

        let message = '';
        let detail = 'Please check the file for valid data.';
        switch (errorKind) {
            case 'emptyModel':
                message = `File does not contains any resources to import.`;
                break;
            case 'categoriesForFlatStructure':
                message = `Categories are not allowed in flat structure.`;
                detail = `Please change project properties to 'Hierarchical tree'.`;
                break;
            case 'noResourcesToMerge':
                message = `No resources found to be merged with.`;
                break;
            default:
                message = `Unknown error occurred while importing file.`;
                break;
        }

        return {
            message: message,
            detail: `Error importing file: ${file} (${engine}).\n${detail}`
        };
    }

    public async runCodeGenerator(): Promise<void> {
        if (!this.jsonModel) {
            logger().log(this, 'debug', 'runCodeGenerator -> No current document or model found.');
            return;
        }

        if (this._manualSaving) {
            logger().log(this, 'debug', 'runCodeGenerator -> Manual saving is in progress. Cannot run code generator.');
            return;
        }

        if (this._codeGenStatus.inProgress) {
            logger().log(this, 'debug', 'runCodeGenerator -> Code generator is already in progress.');
            showNotificationBox('info', 'Code generator is already running ...');
            return;
        }

        logger().log(this, 'debug', `runCodeGenerator -> Running code generator for document ${this.documentUri}`);

        const filename = this.fileName;
        if (isNullOrEmpty(filename)) {
            logger().log(this, 'debug', `runCodeGenerator -> Document fileName is not valid(${filename}).Cannot run code generator.`);
            return;
        }

        const templateId = this.codeGeneratorTemplateId;
        logger().log(this, 'info', `Running code generator template '${templateId}' for: ${filename} `);

        this._codeGenStatus.inProgress = true;

        let beginStatusUid = '';
        let idleStatusOnEnd = true;

        try {
            beginStatusUid = this._codeGenStatus.update({ kind: 'active' });

            const validationErr = this.validateDocument(false);
            if (validationErr) {
                let msg = `Code generator failed.`;
                const detail = `${validationErr.message} \n${validationErr.detail ?? ''} for: ${filename} `;
                this._codeGenStatus.update({
                    kind: 'error',
                    message: msg,
                    detail: detail,
                });

                msg = `Code generator template '${templateId}' failed.${detail} `;
                logger().log('this', 'error', msg);
                return;
            }

            const validLangs = await this.validateLanguages();
            if (!validLangs) {
                let msg = `Code generator failed.`;
                const detail = 'Languages are not valid for code generation.';
                this._codeGenStatus.update({
                    kind: 'error',
                    message: msg,
                    detail: detail
                });

                msg = `Code generator template '${templateId}' failed.${detail} `;
                logger().log('this', 'error', msg);
                return;
            }


            const startTime = Date.now();
            const generator = new Generator();
            const result = generator.generate(filename, this.jsonModel, {});
            const generationTime = Date.now() - startTime;

            // artificially delay the status update to show the spinner ...
            if (generationTime < 500) {
                await delay(500 - generationTime);
            }

            if (result.generatedFiles) {
                const fileNames: string[] = [];
                const folder = getCurrentFolder();
                if (!folder) {
                    showNotificationBox('err', 'No folder selected. Please select a folder in the Explorer view.');
                    return;
                }

                const output = folder.fsPath;
                if (await fse.pathExists(output) === false) {
                    showNotificationBox('err', `Output folder '${output}' does not exist.Please select a valid folder.`);
                    return;
                }

                const saveFilesMap = result.generatedFiles.map(async (file) => {
                    const filename = await this.saveGenFile(file, output);
                    fileNames.push(filename);
                });
                await Promise.all(saveFilesMap);


                logger().log(this, 'info', `Code generator template '${templateId}' for: ${filename} successfully generated ${fileNames.length} files: \n` +
                    `${fileNames.join('\n')} `);

                this._codeGenStatus.update({
                    kind: 'status',
                    message: `Generated ${result.generatedFiles.length} files.`,
                    success: true,
                    timeout: 2000
                });
            } else {
                this._codeGenStatus.update({
                    kind: 'error',
                    message: 'Error generating files.',
                    timeout: 5000
                });
            }
        }
        catch (error) {
            logger().log(this, 'error', `Code generator template '${templateId}' failed for: ${filename}.`, error as Error);

            this._codeGenStatus.update({
                kind: 'error',
                message: 'Code generator failed.',
                detail: getGeneratorAppErrorMessage(error as Error) + `\n For file: ${filename}.`
            });
        } finally {
            this._codeGenStatus.inProgress = false;

            if (idleStatusOnEnd) {
                setTimeout(() => {
                    if (beginStatusUid === this._codeGenStatus.lastUid) {
                        this._codeGenStatus.update({ kind: 'idle' });
                    }
                }, 2000);
            }
        }
    }

    private async saveGenFile(generatedFile: GeneratedFile, outputPath?: string): Promise<string> {
        const content = generatorUtils.getGeneratedFileContent(generatedFile, true);
        const bom = generatedFile.bom ? '\uFEFF' : '';
        const encodedText = Buffer.from(bom + content, 'utf8');

        const fileName = !outputPath ? generatedFile.fileName : path.join(outputPath, generatedFile.fileName);
        const dir = path.dirname(fileName);

        await fse.ensureDir(dir);
        await fse.writeFile(fileName, encodedText, { encoding: 'utf8' });
        return fileName;
    }

    public validateDocument(showError: boolean = true): ValidationError | undefined {
        let error = undefined;

        if (this._rootModel) {
            if (!this.resourcesUnderRoot && this._rootModel.resources.length > 0) {
                error = {
                    message: `Resources are not allowed under root!`,
                    detail: `Please change project properties to 'Allow resources under root' or move resources to categories.`
                };
            } else if (!this.isTreeStructure && this._rootModel.categories.length > 0) {
                error = {
                    message: `Categories are not allowed in flat structure!`,
                    detail: `Please change project properties 'Layout' to 'Hierarchical tree' or remove categories from the root.`
                };
            }
        }

        if (error) {
            if (showError === true) {
                showNotificationBox('warn', error.message + '\n' + error.detail);
            } else {
                // let msg = error.message;
                // if (!isNullOrEmpty(error.detail)) {
                //     msg += `\n${ error.detail } `;
                // }
                // logger().log('this', 'error', msg);
            }
        }

        return error;
    }

    private setupEvents(): void {
        const didReceiveMessageSubscription = this._webviewPanel!.webview.onDidReceiveMessage(this.handleClientCommands.bind(this));
        const viewStateSubscription = this._webviewPanel!.onDidChangeViewState(this.handleChangeViewState.bind(this));

        this._context.subscriptions.push(
            this._webviewPanel!.onDidDispose(() => {
                this._disposed = true;
                logger().log(this, 'debug', `onDidDispose -> for: ${this.fileName} `);
                viewStateSubscription.dispose();
                didReceiveMessageSubscription.dispose();

                this._onDidDispose();
            })
        );
    }

    private async handleChangeViewState(e: vscode.WebviewPanelOnDidChangeViewStateEvent): Promise<void> {
        const changedPanel = e.webviewPanel;
        logger().log(this, 'debug', `webviewPanel.onDidChangeViewState for ${this.fileName}.Active: ${changedPanel.active}, Visible: ${changedPanel.visible} `);

        this.isActive = changedPanel.active;

        if (changedPanel.active) {
            logger().log(this, 'debug', `webviewPanel.onDidChangeViewState for ${this.fileName} became active.Updating tree and context.`);
            appContext.enableEditorActive();

            this._codeGenStatus.restoreLastStatus();

            appContext.treeContext.updateDocument(this);

            if (this._selectedElements.length > 0) {
                void appContext.treeContext.setSelectedItems(this._selectedElements);
            }
        } else {
            nextTick(() => {
                appContext.disableEditorActive();
            });
        }
    }

    private async handleClientCommands(message: PageToAppMessage): Promise<void> {
        let header = `handleClientCommand '${message.command}'`;
        if (message.command === 'select') {
            header += ` [elementType: ${message.elementType}, paths: ${message.paths.join('/')}]`;
        }

        logger().log(this, 'debug', `${header} for ${this.fileName}`);

        if (this._disposed) {
            logger().log(this, 'debug', `${header} -> DocumentContext is disposed.Ignoring message.`);
            return;
        }

        if (!this.rootModel) {
            logger().log(this, 'error', `${header} No current root model found.`);
            return;
        }

        switch (message.command) {
            case 'update':
                try {
                    const element = message.data;
                    if (element) {
                        await this.updateElement(element);
                    }
                } catch (e) {
                    logger().log(this, 'error', `${header} - error parsing element data: ${e} `);
                    return;
                }
                break;
            case 'select':
                try {
                    const reload = message.reload ?? false;
                    if (reload) {
                        await appContext.treeContext.clearSelection();
                    }

                    await appContext.treeContext.selectElementByPath(message.elementType, message.paths, true);
                } catch (e) {
                    logger().log(this, 'error', `${header} - error selecting element: ${e} `);
                    return;
                }
                break;
            case 'saveProperties': {
                const error = await this.saveModelProperties(message.modelProperties);
                if (error) {
                    logger().log(this, 'error', `${header} - error saving properties: ${error.message} `);
                }
                this.sendMessageToHtmlPage({ command: 'savePropertiesResult', error });
                break;
            }
            case 'confirmQuestion': {
                const text = message.message;
                const detail = message.detail;
                const warn = message.warning ?? false;

                await delay(100);
                const confirmed = await showConfirmBox(text, detail, { warn }) === true;

                let result: unknown | undefined;
                switch (message.id) {
                    case 'resetSettings':
                        result = this.rootModel?.codeGenerator?.settings ?? {} as CodeGeneratorGroupSettings;
                        break;
                }

                this.sendMessageToHtmlPage({ command: 'confirmQuestionResult', id: message.id, confirmed, result });
                break;
            }
            case 'showInputBox': {
                const data = message.data as { elementType: TreeElementType, paths: string[] };
                const oldValue = message.value;
                let result = await vscode.window.showInputBox({
                    prompt: message.prompt,
                    placeHolder: message.placeHolder,
                    title: message.title,
                    value: message.value,
                    ignoreFocusOut: true,
                    validateInput: value => {
                        if (message.id === 'editElementName') {
                            const elem = appContext.treeContext.getElementByPath(data.elementType, data.paths);
                            if (elem) {
                                const fullPath = getElementFullPath(elem);
                                return validateTreeElementName(elem.elementType, value, elem.parent, fullPath);
                            }
                        }

                        return undefined;
                    }
                });

                if (!isNullOrEmpty(result) && message.id === 'editElementName' && data.elementType === 'model' && result !== oldValue) {
                    await delay(100); // wait for input box to close

                    if (!(await showConfirmBox(`Do you want to rename the model ? `,
                        `Associated code generator usually use model name as file name.\n` +
                        'After renaming the model, you may need to manually delete the old file(s).'))) {
                        result = undefined;
                    }
                }

                this.sendMessageToHtmlPage({ command: 'showInputBoxResult', id: message.id, result });
                break;
            }
            case 'focusTree': {
                await this.focusTree(false);
                await appContext.treeContext.selectElementByPath(message.elementType, message.paths, true);
                break;
            }
            case 'showNotification': {
                showNotificationBox(message.type ?? 'info', message.message, { logger: false });
            }
        }
    }

    public onSelectionChanged(selectedElements: ITreeElement[]): void {
        if (this._disposed) {
            logger().log(this, 'debug', `onSelectionChanged -> DocumentContext is disposed.Ignoring selection change.`);
            return;
        }

        if (this.isReadonly) {
            logger().log(this, 'debug', `onSelectionChanged -> DocumentContext is readonly.Ignoring selection change.`);
            return;
        }

        this._selectedElements = selectedElements ?? [];
        this.reflectSelectedElementToWebview();
    }

    public async loadEmptyPage(): Promise<void> {
        if (this._disposed) {
            logger().log(this, 'debug', `loadEmptyPage -> DocumentContext is disposed.Ignoring load request.`);
            return;
        }

        this._webviewPanel.webview.html = await this.getHtmlForWebview(true);
    }

    public async updateWebviewContent(): Promise<void> {
        if (this._disposed) {
            logger().log(this, 'debug', `updateWebviewContent -> DocumentContext is disposed.Ignoring update request.`);
            return;
        }

        this._webviewPanel.webview.html = await this.getHtmlForWebview(false);

        const templatesMetadata = HbsTemplateManager.getTemplateDefinitions();
        const valuesRegexValidators: string[] = [];
        Object.values(modelConst.ResourceValueValidations).forEach(x => valuesRegexValidators.push(x.toString()));

        this.sendMessageToHtmlPage({ command: 'init', templatesMetadata, valuesRegexValidators });
    }

    public reflectSelectedElementToWebview(restoreFocusedInput: boolean = false): void {
        if (this._disposed) {
            logger().log(this, 'debug', `reflectSelectedElementToWebview -> DocumentContext is disposed.Ignoring selection change.`);
            return;
        }

        if (!this._webviewPanel || !this._webviewPanel.webview || !this.rootModel) {
            return;
        }

        const rootModel = this.rootModel;
        const element = this._selectedElements.length > 0 ? this._selectedElements[0] : rootModel;

        if (element === undefined || isVirtualTreeElement(element)) {
            return;
        }

        this.clearPageErrors();

        const cultures = rootModel.languages.map(lang => appContext.findCulture(lang)).filter(c => !!c);
        const toJsonOptions: CategoryLikeTreeElementToJsonOptions = {
            includeCategories: false,
            includeResources: false
        };

        // const autoFocus = appContext.getConfig().autoFocusEditor;

        const message: AppToPageMessage = {
            command: 'loadPage',
            file: this.fileName,
            cultures: cultures,
            primaryLang: rootModel.primaryLanguage ?? '',
            element: element.toJson(toJsonOptions),
            modelProperties: {
                resources: rootModel.options.resources,
                categories: rootModel.options.categories,
                modelVersion: rootModel.version,
                visible: false,
                codeGenerator: rootModel.codeGenerator ?? { templateId: '', settings: {} as CodeGeneratorGroupSettings, version: modelConst.ModelVersions.codeGenerator }
            },
            autoFocus: false,
            restoreFocusedInput
        };

        this.sendMessageToHtmlPage(message);
    }

    private async getHtmlForWebview(emptyPage: boolean): Promise<string> {
        const webview = this._webviewPanel.webview;
        let pageHtml = await appContext.getPageHtml();

        const content_begin = `<!-- lhq_editor_content_begin -->`;
        const content_end = `<!-- lhq_editor_content_end -->`;

        if (emptyPage) {
            const startIdx = pageHtml.indexOf(content_begin);
            const endIdx = pageHtml.indexOf(content_end, startIdx + content_begin.length);
            if (startIdx > -1 && endIdx > -1) {
                pageHtml = pageHtml.substring(0, startIdx) + pageHtml.substring(endIdx + content_end.length);
            } else {
                logger().log(this, 'error', `getHtmlForWebview: Content markers not found in page.html`);
            }
        }

        pageHtml = pageHtml.replace(`<!-- lhq_loading_file_text -->`, `<span> Loading ${this.fileName} ...</span>`);

        const regex = /<script\s+nonce="([^"]*)"\s+src="([^"]*)"[^>]*><\/script>/g;

        const nonce = generateNonce();
        pageHtml = pageHtml.replace(regex, (match, _, src) => {
            const newSrc = appContext.getMediaUri(webview, src);
            return `<script nonce="${nonce}" src="${newSrc}"></script>`;
        });

        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src vscode-resource:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">`;
        pageHtml = pageHtml.replace('<!-- <meta http-equiv="Content-Security-Policy" content=""> -->', csp);

        const pagejs = appContext.getMediaUri(webview, 'page.js');
        const pageimport = `<script nonce="${nonce}" src="${pagejs}"></script>`;
        pageHtml = pageHtml.replace(`<script src="page.js"></script>`, pageimport);

        const regex_css = /<link\s+href="([^"]*)"\s+rel="stylesheet"[^>]*>/g;

        pageHtml = pageHtml.replace(regex_css, (match, href) => {
            const newHref = appContext.getMediaUri(webview, href);
            return `<link href="${newHref}" rel="stylesheet">`;
        });

        return pageHtml;
    }

    public sendMessageToHtmlPage(message: AppToPageMessage): void {
        if (this._disposed) {
            logger().log(this, 'debug', `sendMessageToHtmlPage -> DocumentContext is disposed. Ignoring message '${message.command}'.`);
            return;
        }

        try {
            if (this._webviewPanel && this._webviewPanel.webview) {
                if (this._webviewPanel.active) {
                    this._webviewPanel.webview.postMessage(message);
                } else {
                    logger().log(this, 'debug', `sendMessage() skipped for message '${message.command}' -> WebviewPanel is not active.`);
                }
            }
        } catch (error) {
            logger().log(this, 'error', `sendMessageToHtmlPage: Error sending message '${message.command}': ${error}`);
        }
    }

    public clearPageErrors(): void {
        this._pageErrors = [];
    }

    private setPageError(element: ITreeElement, field: string, message: string): void {
        const elemFullPath = getElementFullPath(element);
        const item = this._pageErrors.find(x => x.fullPath === elemFullPath && x.field === field);
        if (item) {
            item.message = message;
        } else {
            this._pageErrors.push({
                fullPath: elemFullPath,
                field,
                message
            });
        }
    }

    private hasPageError(element: ITreeElement, field: string): boolean {
        const elemFullPath = getElementFullPath(element);
        return this._pageErrors.some(x => x.fullPath === elemFullPath && x.field === field);
    }

    private removePageError(element: ITreeElement, field: string): boolean {
        const elemFullPath = getElementFullPath(element);
        const index = this._pageErrors.findIndex(x => x.fullPath === elemFullPath && x.field === field);
        if (index >= 0) {
            this._pageErrors.splice(index, 1);
        }

        return index >= 0;
    }

    public async saveModelProperties(modelProperties: ClientPageModelProperties): Promise<ClientPageSettingsError | undefined> {
        if (!this._rootModel || !modelProperties) {
            return;
        }

        let result: ClientPageSettingsError | undefined;

        try {
            const root = this._rootModel;

            root.options.categories = modelProperties.categories;
            root.options.resources = modelProperties.categories ? modelProperties.resources : 'All';

            const templateId = modelProperties.codeGenerator.templateId;

            const validateResult = ModelUtils
                .getCodeGeneratorSettingsConvertor()
                .validateSettings(templateId, modelProperties.codeGenerator.settings);

            if (isNullOrEmpty(validateResult.error)) {
                const codeGenerator = ModelUtils.createCodeGeneratorElement(templateId, modelProperties.codeGenerator.settings);
                root.codeGenerator = codeGenerator;

                const success = await this.commitChanges('saveModelProperties');

                if (success) {
                    showNotificationBox('info', 'Project properties was successfully changed.');
                }
            } else {
                result = {
                    group: validateResult.group,
                    name: validateResult.property,
                    message: validateResult.error
                };
            }
        } catch (error) {
            result = {
                group: '',
                name: '',
                message: 'Unknown error occurred while saving model properties.'
            };
            logger().log(this, 'error', `saveModelProperties -> Error saving model properties: ${result.message}`, error as Error);
        }

        return result;
    }

    public handleVsCommand(command: AvailableCommands, treeElement: ITreeElement): Promise<void> {
        if (this._disposed) {
            logger().log(this, 'debug', `deleteElement -> DocumentContext is disposed. Ignoring delete request.`);
            return Promise.resolve();
        }

        switch (command) {
            case Commands.addElement:
                return this.addItem(treeElement);
            case Commands.renameElement:
                return this.renameItem(treeElement);
            case Commands.deleteElement:
                return this.deleteElement(treeElement);
            case Commands.duplicateElement:
                return this.duplicateElement(treeElement);
            case Commands.findInTreeView:
                return this.findInTreeView();
            case Commands.advancedFind:
                return this.advancedFind();
            case Commands.addCategory:
                return this.addCategory(treeElement);
            case Commands.addResource:
                return this.addResource(treeElement);
            case Commands.addLanguage:
                return this.addLanguage(treeElement);
            case Commands.deleteLanguage:
                return this.deleteLanguage(treeElement);
            case Commands.markLanguageAsPrimary:
                return this.markLanguageAsPrimary(treeElement);
            case Commands.showLanguages:
                return this.toggleLanguages(true);
            case Commands.hideLanguages:
                return this.toggleLanguages(false);
            case Commands.projectProperties:
                return this.showProjectProperties();
            case Commands.focusTree:
                return this.focusTree();
            case Commands.focusEditor:
                return this.focusEditor();
        }

        return Promise.resolve();
    }

    private requestPageReload(): void {
        if (this._disposed) {
            logger().log(this, 'debug', `requestPageReload -> DocumentContext is disposed. Ignoring reload page request.`);
            return;
        }

        if (!this._rootModel) {
            return;
        }

        this._lastRequestPageReload = crypto.randomUUID();

        // reload actual page with element data
        this.sendMessageToHtmlPage({ command: 'requestPageReload' });
    }


    // ========================== 
    // Commands for VS Code
    // ==========================

    private async addItem(element: ITreeElement, newItemType?: CategoryOrResourceType): Promise<void> {
        if (!this._rootModel) {
            return;
        }

        const selectedCount = this._selectedElements.length;
        if (selectedCount > 1) {
            return;
        }

        const rootModel = this._rootModel;

        function canCreateCategory(): boolean {
            if (!rootModel.options.categories) {
                const detail = `Categories are disabled in project properties. \n` +
                    `Please enable 'Categories' in project properties to add new categories.`;
                void showMessageBox('info', `Cannot add new category!`, detail);
                return false;
            }

            return true;
        }

        if (newItemType === 'category' && !canCreateCategory()) {
            return;
        }

        if (element && selectedCount === 1 && element !== this._selectedElements[0]) {
            await this.treeContext.setSelectedItems([element], { focus: true, expand: false });
        }

        element = element || (this._selectedElements.length > 0 ? this._selectedElements[0] : undefined);
        element = element ?? rootModel!;

        if (!this._rootModel || !element) {
            return;
        }

        if (element.elementType === 'resource') {
            element = element.parent || element.root;
        }

        function canCreateResource(): boolean {
            if (rootModel.options.resources === 'Categories' && element.isRoot) {
                const detail = `Resources are under root are not allowed (only under category).\n` +
                    `Please enable 'Resources under root' in project properties.`;
                void showMessageBox('info', `Cannot add new resource!`, detail);

                return false;
            }

            return true;
        }

        if (newItemType === 'resource' && !canCreateResource()) {
            return;
        }

        const elemPath = getElementFullPath(element);
        const showSelector = isNullOrEmpty(newItemType);

        const itemType = showSelector
            ? await vscode.window.showQuickPick([
                {
                    label: 'Category',
                    elementType: 'category' as TreeElementType
                },
                {
                    label: 'Resource',
                    elementType: 'resource' as TreeElementType
                }
            ], { placeHolder: `Select element type to add under ${elemPath}` })
            : { elementType: newItemType };

        if (!itemType) {
            return;
        }

        if (showSelector && (
            (itemType.elementType === 'category' && !canCreateCategory()) ||
            (itemType.elementType === 'resource' && !canCreateResource())
        )) {
            return;
        }

        setTimeout(() => {
            void this.addItemComplete(element, itemType.elementType);
        }, 100);
    }

    private async addItemComplete(parent: ITreeElement, elementType: TreeElementType, duplicateElement?: ITreeElement): Promise<void> {
        try {
            const isResource = elementType === 'resource';
            const parentCategory = parent as ICategoryLikeTreeElement;
            const elemPath = getElementFullPath(parent);
            const prompt = duplicateElement
                ? `Enter new for ${duplicateElement.elementType}`
                : `Enter new ${elementType} name (${elemPath})`;

            const title = duplicateElement
                ? `Duplicate ${duplicateElement.elementType} '${duplicateElement.name}' (${getElementFullPath(duplicateElement)})`
                : undefined;

            const value = duplicateElement
                ? duplicateElement.name
                : undefined;

            const itemName = await vscode.window.showInputBox({
                prompt,
                title,
                value,
                ignoreFocusOut: true,
                validateInput: value => validateTreeElementName(elementType, value, parentCategory)
            });

            if (!itemName) {
                return;
            }

            // after previous await, document can be closed now...
            if (!this._rootModel) {
                return;
            }

            const validationError = validateTreeElementName(elementType, itemName, parentCategory);
            if (validationError) {
                showNotificationBox('warn', validationError);
                return;
            }

            // do not allow resources under root if not enabled in project properties
            if (!this.resourcesUnderRoot && isResource && parentCategory.elementType === 'model') {
                const detail = `Cannot add resource '${itemName}' under root element '${getElementFullPath(parent)}'.\n\n` +
                    `NOTE: 'Resources under root' can be enabled in project properties.`;
                return await showMessageBox('warn', `Resources are not allowed under root!`, detail);
            }
            // do not allow categories in flat structure
            if (!this.isTreeStructure && !isResource && parentCategory.elementType === 'model') {
                const detail = `Cannot add category '${itemName}' under root element '${getElementFullPath(parent)}'.\n\n` +
                    `NOTE: 'Hierarchical tree structure' can be enabled in project properties.`;
                return await showMessageBox('warn', `Categories are not allowed in flat structure!`, detail);
            }

            let newElement: ITreeElement;

            if (duplicateElement) {
                newElement = ModelUtils.cloneElement(duplicateElement, itemName);
            } else {
                if (isResource) {
                    newElement = parentCategory.addResource(itemName);
                } else {
                    newElement = parentCategory.addCategory(itemName);
                }
            }

            await this.commitChanges('addItemComplete');

            this.treeContext.refreshTree([parent]);
            await this.treeContext.revealElement(newElement, { expand: true, select: true, focus: true });

            showNotificationBox('info', `Added new ${elementType} '${itemName}' under '${getElementFullPath(parent)}'`);
        } catch (error) {
            logger().log(this, 'error', `addItemComplete -> Failed to add new ${elementType} under '${getElementFullPath(parent)}'`, error as Error);
        }
    }

    private async renameItem(element: ITreeElement): Promise<void> {
        const selectedCount = this._selectedElements.length;
        if (selectedCount > 1) {
            return;
        }

        if (element && selectedCount === 1 && element !== this._selectedElements[0]) {
            await this.treeContext.setSelectedItems([element], { focus: true, expand: false });
        }

        element = element || (this._selectedElements.length > 0 ? this._selectedElements[0] : undefined);
        if (!this._rootModel || !element) {
            return;
        }

        this.sendMessageToHtmlPage({ command: 'requestRename' });
    }

    private async deleteElement(element: ITreeElement): Promise<void> {
        if (!this.rootModel) {
            return;
        }

        const elemsToDelete = filterTreeElements(element && this._selectedElements.length <= 1 ? [element] : this._selectedElements);
        const selectedCount = elemsToDelete.length;
        if (selectedCount === 0) { return; }

        const firstSelected = elemsToDelete[0];
        if (firstSelected.isRoot) {
            return await showMessageBox('warn', `Cannot delete root element '${getElementFullPath(firstSelected)}'.`);
        }

        const elemIdent = selectedCount === 1
            ? `${firstSelected.elementType} '${getElementFullPath(firstSelected)}'`
            : `${selectedCount} selected elements`;

        if (selectedCount > 1) {
            const firstParent = firstSelected.parent;
            if (!elemsToDelete.every(item => item.parent === firstParent)) {
                return await showMessageBox('warn', `Cannot delete ${elemIdent} with different parents.`);
            }
        }

        if (!(await showConfirmBox(`Delete ${elemIdent} ?`))) {
            return;
        }

        // after previous await, document can be closed now...
        if (!this._rootModel) {
            return;
        }

        logger().log(this, 'info', `Deleting ${elemIdent} ...`);

        let parentToSelect: ICategoryLikeTreeElement | undefined;
        let deletedCount = 0;
        let notDeletedCount = 0;
        elemsToDelete.forEach(elem => {
            const parent = this.getCategoryLikeParent(elem);
            if (parent) {
                if (elemsToDelete.length === 1) {
                    parentToSelect = parent;
                }
                parent.removeElement(elem);
                deletedCount++;
            } else {
                notDeletedCount++;
            }
        });

        const success = await this.commitChanges('deleteElement');

        logger().log(this, 'debug', `Deleting ${elemIdent} ${success ? 'suceed' : 'failed'} where ${deletedCount} element(s) was deleted` +
            (notDeletedCount > 0 ? ` and failed to delete ${notDeletedCount} elements (no parent found).` : '.'));

        this.treeContext.refreshTree(parentToSelect ? [parentToSelect] : undefined);
        if (parentToSelect) {
            await this.treeContext.revealElement(parentToSelect, { expand: true, select: true });
        }

        showNotificationBox(success ? 'info' : 'err', success ? `Successfully deleted ${elemIdent}.` : `Failed to delete ${elemIdent}.`);
    }

    private async duplicateElement(element: ITreeElement): Promise<void> {
        const selectedCount = this._selectedElements.length;
        if (selectedCount > 1) {
            return;
        }

        if (element && selectedCount === 1 && element !== this._selectedElements[0]) {
            await this.treeContext.setSelectedItems([element], { focus: true, expand: false });
        }

        element = element || (this._selectedElements.length > 0 ? this._selectedElements[0] : undefined);
        if (!this._rootModel || !element) {
            return;
        }

        await this.addItemComplete(element.parent!, element.elementType, element);
    }

    private async findInTreeView(): Promise<void> {
        // await vscode.commands.executeCommand('lhqTreeView.focus');
        await vscode.commands.executeCommand(Commands.focusTree);
        await vscode.commands.executeCommand('list.find', 'lhqTreeView');
    }

    private advancedFind(): Promise<void> {
        return this.treeContext.advancedFind();
    }

    private async addCategory(element: ITreeElement): Promise<void> {
        return await this.addItem(element, 'category');
    }

    private async addResource(element: ITreeElement): Promise<void> {
        return await this.addItem(element, 'resource');
    }

    private async addLanguage(_: ITreeElement): Promise<void> {
        const selected = await vscode.window.showQuickPick(LanguageTypeModes, {
            placeHolder: `Select type of languages to select from`,
            ignoreFocusOut: true
        });

        if (!selected) {
            return;
        }

        setTimeout(() => {
            void this.addLanguageComplete(selected.mode);
        }, 100);
    }

    private async addLanguageComplete(langTypeMode: LangTypeMode): Promise<void> {
        const cultures = appContext.getAllCultures();
        const langRoot = this.virtualRootElement!.languagesRoot;

        const languagesQuickPickItems = Object.values(cultures)
            .filter(culture => {
                if (langRoot.contains(culture.name)) {
                    return false;
                }

                if (langTypeMode === 'all') {
                    return true;
                }

                return langTypeMode === 'neutral' ? culture.isNeutral : !culture.isNeutral;
            })
            .map(culture => ({
                label: culture.name + (culture.isNeutral ? ' (neutral)' : ''),
                description: culture.engName,
                detail: culture.nativeName,
                culture
            }) as LanguageQuickPickItem);

        const result = await vscode.window.showQuickPick(languagesQuickPickItems, {
            canPickMany: true,
            ignoreFocusOut: true,
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: 'Select languages to add'
        });

        if (!result || result.length === 0) {
            return;
        }

        // after previous await, document can be closed now...
        if (!this._rootModel) {
            return;
        }

        const added: string[] = [];
        result.map(item => item.culture).forEach(culture => {
            if (this.rootModel?.addLanguage(culture.name)) {
                added.push(`${culture.engName} (${culture.name})`);
            }
        });

        await this.commitChanges('addLanguageComplete');

        await this.treeContext.clearSelection(true);
        langRoot.refresh();

        this.treeContext.refreshTree([langRoot]);
        await this.treeContext.revealElement(langRoot, { expand: true, select: true, focus: true });

        // reload actual page with element data to show new primary language
        this.requestPageReload();

        if (added.length > 0) {
            const maxDisplayCount = 5;
            const addedStr = added.length === 1
                ? `language: ${added[0]}`
                : added.length <= maxDisplayCount
                    ? `${added.length} languages: ` + added.slice(0, maxDisplayCount).join(', ')
                    : `${added.length} languages`;
            showNotificationBox('info', `Succesfully added ${addedStr} .`);
        } else {
            showNotificationBox('warn', `No languages were added as they already exist in the model.`);
        }
    }

    private async deleteLanguage(element: ITreeElement): Promise<void> {
        if (!this._rootModel) {
            return;
        }

        const selectedElems = element && this._selectedElements.length <= 1 ? [element] : this._selectedElements;
        const elemsToDelete = filterVirtualTreeElements<IVirtualLanguageElement>(selectedElems, 'language');
        const selectedCount = elemsToDelete.length;
        if (selectedCount === 0) { return; }

        const restCount = Math.max(0, this.rootModel!.languages.length - selectedCount);
        if (restCount === 0) {
            return await showMessageBox('warn', `Cannot delete all languages. At least one language must remain.`);
        }

        const primaryLang = elemsToDelete.find(x => x.isPrimary);
        if (primaryLang) {
            const msg = selectedCount === 1
                ? `Primary language '${appContext.getCultureDesc(primaryLang.name)}' cannot be deleted.`
                : `Selected languages contain primary language '${appContext.getCultureDesc(primaryLang.name)}' which cannot be deleted.`;
            return await showMessageBox('warn', msg);
        }

        const maxDisplayCount = 10;

        const elemIdent = selectedCount === 1
            ? appContext.getCultureDesc(elemsToDelete[0].name)
            : selectedCount <= maxDisplayCount
                ? elemsToDelete.slice(0, maxDisplayCount).map(x => `'${appContext.getCultureDesc(x.name)}'`).join(', ')
                : '';


        const detail = selectedCount > maxDisplayCount ? '' : `Selected languages to delete: \n${elemIdent}\n\n` + 'This will remove all translations for those languages!';
        if (!(await showConfirmBox(`Delete ${selectedCount} languages ?`, detail, { warn: true }))) {
            return;
        }

        // after previous await, document can be closed now...
        if (!this._rootModel) {
            return;
        }

        const root = this._rootModel!;
        elemsToDelete.forEach(elem => {
            if (!root.removeLanguage(elem.name)) {
                logger().log(this, 'error', `deleteLanguage -> Cannot delete language '${elem.name}' - not found in model.`);
            }
        });

        const success = await this.commitChanges('deleteLanguage');

        const langRoot = this._virtualRootElement!.languagesRoot;

        await this.treeContext.clearSelection(true);
        langRoot.refresh();

        this.treeContext.refreshTree([langRoot]);
        await this.treeContext.revealElement(langRoot, { expand: true, select: true, focus: true });

        // reload actual page with element data to show new primary language
        this.requestPageReload();

        showNotificationBox('info', `Successfully deleted ${elemIdent}.`);
    }

    private async markLanguageAsPrimary(element: ITreeElement): Promise<void> {
        if (!this._rootModel) {
            return;
        }

        const selElems = element && this._selectedElements.length <= 1 ? [element] : this._selectedElements;
        const selectedElements = filterVirtualTreeElements<IVirtualLanguageElement>(selElems, 'language');
        const selectedCount = selectedElements.length;
        if (selectedCount === 0) { return; }

        if (selectedCount > 1) {
            return await showMessageBox('warn', `Cannot mark multiple languages as primary. Please select only one language.`);
        }

        const langElement = selectedElements[0];

        if (this._rootModel!.primaryLanguage === langElement.name) {
            showNotificationBox('info', `Language '${appContext.getCultureDesc(langElement.name)}' is already marked as primary.`);
            return;
        }

        if (!(await showConfirmBox(`Mark language '${appContext.getCultureDesc(langElement.name)}' as primary ?`))) {
            return;
        }

        // after previous await, document can be closed now...
        if (!this._rootModel) {
            return;
        }

        const langRoot = this._virtualRootElement!.languagesRoot;

        this._rootModel!.primaryLanguage = langElement.name;
        const success = await this.commitChanges('markLanguageAsPrimary');

        if (success) {
            await this.treeContext.clearSelection(true);

            this.treeContext.refreshTree([langRoot]);
            await this.treeContext.revealElement(langRoot, { expand: true, select: true, focus: true });

            // reload actual page with element data to show new primary language
            this.requestPageReload();
        }

        showNotificationBox('info', `Language '${appContext.getCultureDesc(langElement.name)}' is now marked as primary.`);
    }

    private async toggleLanguages(visible: boolean): Promise<void> {
        appContext.languagesVisible = visible;

        if (!this._virtualRootElement) {
            return;
        }

        this.treeContext.refreshTree(undefined);
        this._virtualRootElement.refresh();

        const langRoot = this._virtualRootElement!.languagesRoot;
        await this.treeContext.revealElement(langRoot, { select: true, focus: false, expand: true });
    }

    private async showProjectProperties(): Promise<void> {
        if (!this._rootModel) {
            return;
        }

        appContext.sendMessageToHtmlPage({ command: 'showProperties' });
    }

    private async focusTree(reselect: boolean = true): Promise<void> {
        await vscode.commands.executeCommand('lhqTreeView.focus');
        if (reselect) {
            await this.treeContext.clearSelection(true);
        }
    }

    private focusEditor(): Promise<void> {
        if (this._webviewPanel && this._webviewPanel.webview) {
            this.sendMessageToHtmlPage({ command: 'focus' });
        }

        return Promise.resolve();
    }
}