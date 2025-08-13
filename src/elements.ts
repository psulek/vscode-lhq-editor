import { arraySortBy, CategoryOrResourceType, ICategoryLikeTreeElement, IRootModelElement, isNullOrEmpty, ITreeElement, ITreeElementPaths, ModelUtils, TreeElementToJsonOptions, TreeElementType } from '@lhq/lhq-generators';
import { createTreeElementPaths, getElementFullPath } from './utils';

import type { ILanguagesElement, IVirtualLanguageElement, IVirtualRootElement, IVirtualTreeElement, VirtualElementType } from './types';

export function isVirtualTreeElement(element: ITreeElement | undefined, elementType?: VirtualElementType): boolean {
    return element !== undefined && element instanceof VirtualTreeElement && (!elementType || element.virtualElementType === elementType);
}

export function filterTreeElements(elements: ITreeElement[]): ITreeElement[] {
    return elements.filter(x => ModelUtils.isTreeElementInstance(x));
}

export function filterVirtualTreeElements<T extends IVirtualTreeElement = IVirtualTreeElement>(elements: ITreeElement[],
    elementType?: VirtualElementType): T[] {
    return elements.filter(x => isVirtualTreeElement(x, elementType)) as T[];
}


export class VirtualTreeElement implements IVirtualTreeElement {
    private _root: IRootModelElement;
    private _name: string;
    private _paths: ITreeElementPaths;
    private _virtualElementType: VirtualElementType;
    protected _id: string;

    constructor(root: IRootModelElement, name: string, virtualElementType: VirtualElementType) {
        this._root = root;
        this._name = name;
        this._virtualElementType = virtualElementType;
        this._paths = createTreeElementPaths('/');
        this._id = `/${virtualElementType}/${this._name}`;
    }

    toJson<TOptions extends TreeElementToJsonOptions>(options?: TOptions): Record<string, unknown> {
        return {};
    }

    get id(): string {
        return this._id;
    }

    get virtualElementType(): VirtualElementType {
        return this._virtualElementType;
    }

    get parent(): Readonly<ICategoryLikeTreeElement | undefined> {
        return undefined;
    }

    get root(): Readonly<IRootModelElement> {
        return this._root;
    }

    get name(): string {
        return this._name;
    }

    set name(value: string) {
        this._name = value;
    }
    get elementType(): TreeElementType {
        return this.virtualElementType as TreeElementType;
    }

    get description(): string | undefined {
        return '';
    }

    set description(value: string | undefined) {
    }

    get paths(): Readonly<ITreeElementPaths> {
        return this._paths;
    }

    get isRoot(): boolean {
        return false;
    }

    get data(): Readonly<Record<string, unknown>> {
        return {};
    }

    changeParent(newParent: ICategoryLikeTreeElement | undefined): boolean {
        return true;
    }

    public getLevel(): number {
        let level = 0;
        let current: ICategoryLikeTreeElement | undefined = this.parent;

        while (current) {
            level++;
            current = current.parent;
        }

        return level;
    }
}

export class VirtualElementLoading extends VirtualTreeElement {
    constructor() {
        super(undefined!, 'Loading...', 'loading');
        this._id = '/loading:0';
    }
}

export class VirtualRootElement extends VirtualTreeElement implements IVirtualRootElement {
    private _languagesRoot: LanguagesElement;

    constructor(root: IRootModelElement) {
        super(root, root.name, 'treeRoot');
        this._languagesRoot = new LanguagesElement(root, '');
        this.refresh();
    }

    public refresh(): void {
        // let label = 'Languages';
        // if (!appContext.languagesVisible) {
        //     const primary = this.root.primaryLanguage ?? '';
        //     label += `: ${this.root.languages?.length ?? 0} (primary: ${primary})`;
        // }

        const primary = this.root.primaryLanguage ?? '';
        const label = `Languages: ${this.root.languages?.length ?? 0} (primary: ${primary})`;

        this._languagesRoot.name = label;
    }

    get languagesRoot(): LanguagesElement {
        return this._languagesRoot;
    }

    get isRoot(): boolean {
        return true;
    }
}

export class LanguagesElement extends VirtualTreeElement implements ILanguagesElement {
    private _virtualLangs: VirtualTreeElement[] = [];

    constructor(root: IRootModelElement, name: string) {
        super(root, name, 'languages');
        this.refresh();
    }

    public refresh(): void {
        this._virtualLangs = [];
        const primary = this.root.languages.find(lang => this.root.primaryLanguage === lang);
        if (!isNullOrEmpty(primary)) {
            this._virtualLangs.push(new LanguageElement(this.root, primary));
        }

        arraySortBy(this.root.languages as string[], lang => lang, 'asc')
            .forEach(lang => {
                if (lang !== this.root.primaryLanguage) {
                    this._virtualLangs.push(new LanguageElement(this.root, lang));
                }
            });
    }

    get virtualLanguages(): ReadonlyArray<VirtualTreeElement> {
        return this._virtualLangs;
    }

    public find(langName: string): VirtualTreeElement | undefined {
        return this._virtualLangs.find(lang => lang.name === langName);
    }

    public contains(langName: string): boolean {
        return this.find(langName) !== undefined;
    }
}

export class LanguageElement extends VirtualTreeElement implements IVirtualLanguageElement {
    constructor(root: IRootModelElement, name: string) {
        super(root, name, 'language');
    }

    public get isPrimary(): boolean {
        return this.name === this.root.primaryLanguage;
    }
}

export function validateTreeElementName(elementType: TreeElementType, name: string, parentElement?: ICategoryLikeTreeElement,
    ignoreElementPath?: string): string | null {
    const valRes = ModelUtils.validateElementName(name);
    if (valRes === 'valid') {
        if (parentElement && !isNullOrEmpty(name)) {
            const found = parentElement.find(name, elementType as CategoryOrResourceType);
            if (found && (!ignoreElementPath || getElementFullPath(found) !== ignoreElementPath)) {
                const root = getElementFullPath(parentElement);
                return `${elementType} '${name}' already exists in ${root}`;
            }
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

// export function setTreeElementUid(element: ITreeElement): void {
//     const id = element.data['uid'] as string ?? '';
//     if (isNullOrEmpty(id)) {
//         ModelUtils.setTempData(element, 'uid', crypto.randomUUID());
//     }
// }

// export function getTreeElementUid(element: ITreeElement): string {
//     return element.data['uid'] as string ?? '';
// }