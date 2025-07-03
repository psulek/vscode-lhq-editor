import { ICategoryLikeTreeElement, IRootModelElement, isNullOrEmpty, ITreeElement, ITreeElementPaths, ModelUtils, TreeElementType } from '@lhq/lhq-generators';
import { createTreeElementPaths } from './utils';
import type { IVirtualLanguageElement, IVirtualTreeElement, VirtualElementType } from '../shared/types';

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

    constructor(root: IRootModelElement, name: string, virtualElementType: VirtualElementType) {
        this._root = root;
        this._name = name;
        this._virtualElementType = virtualElementType;
        this._paths = createTreeElementPaths('/');
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

export class VirtualRootElement extends VirtualTreeElement {
    private _languagesRoot: LanguagesElement;

    constructor(root: IRootModelElement, languagesVisible: boolean) {
        super(root, root.name, 'treeRoot');
        let label = 'Languages';
        if (!languagesVisible) {
            const primary = root.primaryLanguage ?? '';
            label += `: ${root.languages?.length ?? 0} (primary: ${primary})`;
        }
        this._languagesRoot = new LanguagesElement(root, label);
    }

    get languagesRoot(): LanguagesElement {
        return this._languagesRoot;
    }

    get isRoot(): boolean {
        return true;
    }
}

export class LanguagesElement extends VirtualTreeElement {
    private _virtualLangs: VirtualTreeElement[] = [];

    constructor(root: IRootModelElement, name: string) {
        super(root, name, 'languages');

        this._virtualLangs = [];
        const primary = root.languages.find(lang => this.root.primaryLanguage === lang);
        if (!isNullOrEmpty(primary)) {
            this._virtualLangs.push(new LanguageElement(root, primary));
        }
        root.languages.forEach(lang => {
            if (lang !== this.root.primaryLanguage) {
                this._virtualLangs.push(new LanguageElement(root, lang));
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