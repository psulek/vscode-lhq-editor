import type { CodeGeneratorGroupSettings, FormattingOptions, ICodeGeneratorElement, IRootModelElement, ITreeElement, LhqModel, LhqModelOptionsResources, TemplateMetadataDefinition, TreeElementType } from '@lhq/lhq-generators';
import type { MessageOptions, TextDocument, Uri, Webview } from 'vscode';

export type SearchTreeKind = 'path' | 'name' | 'translation' | 'language';

export type SearchTreeOptionsBase = {
    uid: string;
    searchText: string;
    filter?: string;
    elems: Array<MatchingElement>;
    elemIdx?: number;
};

export type MatchForSubstringResult = {
    match: 'equal' | 'contains' | 'none';
    highlights?: [number, number][];
}

export type MatchingElement = {
    element: ITreeElement; match: MatchForSubstringResult; leaf: boolean;
};

export type SearchTreeOptions =
    SearchTreeOptionsBase & { type: Exclude<SearchTreeKind, 'path'> } |
    SearchTreeOptionsBase & {
        type: 'path';
        paths: string[];
    };


export type VirtualElementType = 'treeRoot' | 'languages' | 'language' | 'loading';

export interface IVirtualTreeElement extends ITreeElement {
    get virtualElementType(): VirtualElementType;
}

export interface IVirtualLanguageElement extends IVirtualTreeElement {
    get isPrimary(): boolean;
}

export interface ILanguagesElement extends IVirtualTreeElement {
    get virtualLanguages(): ReadonlyArray<IVirtualTreeElement>;

    refresh(): void;
    find(langName: string): IVirtualTreeElement | undefined;
    contains(langName: string): boolean;
}

export interface IVirtualRootElement extends IVirtualTreeElement {
    refresh(): void;

    get languagesRoot(): ILanguagesElement;
}

export type AppTreeElementType = TreeElementType | VirtualElementType;

export type CultureInfo = {
    name: string;
    engName: string;
    nativeName: string;
    lcid: number;
    isNeutral: boolean;
}

export type CulturesMap = Record<string, CultureInfo>;

export type ValidationError = { message: string, detail?: string };

export type ClientPageError = {
    field: string;
    fullPath: string;
    message: string;
};

export type ClientPageModelProperties = {
    resources: LhqModelOptionsResources;
    categories: boolean;
    modelVersion: number;
    visible: boolean;
    codeGenerator: ICodeGeneratorElement;
}

export type ClientPageSettingsError = {
    group: string;
    name: string;
    message: string;
}

export type AppToPageMessage = {
    command: 'init';
    templatesMetadata: Record<string, TemplateMetadataDefinition>;
} | {
    command: 'loadPage';
    element: Object;
    file: string;
    cultures: CultureInfo[];
    primaryLang: string;
    modelProperties: ClientPageModelProperties;
} | {
    command: 'invalidData';
    action: 'add' | 'remove';
} & ClientPageError |
{
    command: 'updatePaths'
    paths: string[];
} |
{
    command: 'showProperties';
} |
{
    command: 'savePropertiesResult';
    error?: ClientPageSettingsError | undefined;
} | {
    command: 'resetSettingsResult'
    settings: CodeGeneratorGroupSettings;
} | {
    command: 'requestPageReload' // usually after language(s) change
}

export type PageToAppMessage = {
    command: 'update',
    data: Record<string, unknown>;
} | {
    command: 'select',
    paths: string[];
    elementType: TreeElementType
    reload?: boolean;
} | {
    command: 'saveProperties',
    modelProperties: ClientPageModelProperties;
} | {
    command: 'resetSettings';
};

export type LastLhqStatus = {
    kind: CodeGeneratorStatusKind;
    uid: string;
}

export interface IAppContext {
    get treeContext(): ITreeContext;

    get selectedElements(): ITreeElement[];

    get isEditorActive(): boolean;
    // set isEditorActive(active: boolean);

    get languagesVisible(): boolean;
    set languagesVisible(visible: boolean);

    on(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;

    clearContextValues(): void;
    getFileUri(...pathParts: string[]): Uri;
    getPageHtml(): Promise<string>;
    getMediaUri(webview: Webview, filename: string, themed?: boolean): Uri

    setSelectionChangedCallback(callback: SelectionChangedCallback): void;
    setTreeSelection(selectedElements: ITreeElement[]): void;

    runCodeGenerator(): void;
    sendMessageToHtmlPage(message: AppToPageMessage): void;

    enableEditorActive(): void;
    disableEditorActive(): void;
    setCheckAnyActiveDocumentCallback(callback: CheckAnyActiveDocumentCallback): void;
}

export interface ITreeContext {
    updateDocument(docCtx: IDocumentContext | undefined): void;

    setSelectedItems(itemsToSelect: ITreeElement[], options?: { focus?: boolean; expand?: boolean | number }): Promise<void>;

    revealElement(item: ITreeElement, options?: { select?: boolean; focus?: boolean; expand?: boolean | number }): Promise<void>

    clearSelection(reselect?: boolean): Promise<void>;

    selectElementByPath(elementType: TreeElementType, path: string[]): Promise<void>;

    refreshTree(elements: ITreeElement[] | undefined): unknown;

    advancedFind(): Promise<void>;

    showLoading(text: string): Promise<void>;

    backupSelection(): SelectionBackup;

    restoreSelection(selection: SelectionBackup): Promise<void>;
}

export interface IDocumentContext {
    get lastValidationError(): ValidationError | undefined;

    get documentUri(): Uri | undefined;

    get fileName(): string;

    get isActive(): boolean;

    //get documentText(): string;

    get documentFormatting(): FormattingOptions;

    get jsonModel(): LhqModel | undefined;

    get rootModel(): IRootModelElement | undefined;

    get virtualRootElement(): IVirtualRootElement | undefined;

    get resourcesUnderRoot(): boolean;

    get isTreeStructure(): boolean;

    commitChanges(message: string): Promise<boolean>;

    isSameDocument(document: TextDocument): boolean;
}

export interface ICodeGenStatus {
    get inProgress(): boolean;
    set inProgress(value: boolean);

    get lastStatus(): LastLhqStatus | undefined;

    updateGeneratorStatus(templateId: string, info: CodeGeneratorStatusInfo): string
}

export type SelectionChangedCallback = (selectedElements: ITreeElement[]) => void;
export type CheckAnyActiveDocumentCallback = () => boolean;

export type SelectionBackup = Array<{
    type: TreeElementType;
    fullPath: string;
}>;

export type CodeGeneratorStatusInfo =
    | { kind: 'active'; filename: string; }
    | { kind: 'idle'; }
    | { kind: 'error'; message: string; timeout?: number; }
    | { kind: 'status'; message: string; success: boolean; timeout: number; };

export type CodeGeneratorStatusKind = CodeGeneratorStatusInfo['kind'];

export type MessageBoxOptions = MessageOptions & {
    logger?: boolean
}