import * as vscode from 'vscode';
import { IRootModelElement, isNullOrEmpty } from '@lhq/lhq-generators';
import { ImportExportManager } from './manager';
import { ExporterEngine, ExportFileSelectedData, IDataExporter } from './types';
import { showMessageBox, showSaveFileDialog } from '../utils';
import { CultureInfo } from '../types';

type ExportItemKind = 'engine' | 'file' | 'languages' | 'export';

interface ExportToFilePickItem extends vscode.QuickPickItem {
    type: ExportItemKind;
}

interface ExporterEnginePickItem extends vscode.QuickPickItem {
    engine: ExporterEngine;
}

interface ExporterLangPickItem extends vscode.QuickPickItem {
    culture?: CultureInfo;
}


export class ExportFileSelector {
    public static async showRoot(data: ExportFileSelectedData, model: IRootModelElement): Promise<ExportFileSelectedData | undefined> {
        const result: ExportFileSelectedData = structuredClone(data);
        let selectedRootMenu: ExportItemKind | undefined;

        let selectedExporter: IDataExporter | undefined;
        do {
            if (selectedRootMenu === undefined) {
                selectedExporter = ImportExportManager.getExporter(result.engine);
                const selectedExporterName = selectedExporter!.name;
                const selectedFile = isNullOrEmpty(result.file) ? '-' : result.file;
                let selectedLangs = `All ${model.languages.length} languages`;
                if (result.languages && result.languages.length > 0 && result.languages.length < model.languages.length) {
                    const maxDisplayCount = 4;
                    const langs = result.languages;

                    selectedLangs = result.languages.length === 1
                        ? appContext.getCultureDesc(langs[0])
                        : langs.slice(0, maxDisplayCount).map(x => `${appContext.getCultureDesc(x)}`).join(', ');

                    if (langs.length > maxDisplayCount) {
                        const others = langs.length - maxDisplayCount;
                        selectedLangs += ` and ${others === 1 ? 'other' : `${others} others`} ...`;
                    }
                }

                const rootItems = [
                    {
                        type: 'engine',
                        label: selectedExporterName,
                        detail: 'Exporter engine',
                        iconPath: new vscode.ThemeIcon('beaker'),
                    },
                    {
                        type: 'file',
                        label: selectedFile,
                        detail: 'File to export to',
                        iconPath: new vscode.ThemeIcon('file'),
                    },
                    {
                        type: 'languages',
                        label: selectedLangs,
                        detail: 'Languages to export',
                        iconPath: new vscode.ThemeIcon('globe'),
                    },
                    {
                        kind: vscode.QuickPickItemKind.Separator
                    },
                    {
                        type: 'export',
                        label: 'Start Export',
                    }
                ] as ExportToFilePickItem[];

                const selected = await vscode.window.showQuickPick(rootItems, {
                    placeHolder: 'Export resources to file',
                    ignoreFocusOut: true,
                    matchOnDescription: false,
                    matchOnDetail: false
                });

                if (!selected) {
                    return undefined;
                }

                selectedRootMenu = selected.type;
            }

            let skipToRootMenu: ExportItemKind | undefined;
            switch (selectedRootMenu) {
                case 'engine': {
                    const newEngine = await ExportFileSelector.showExporterEngine(result);
                    if (newEngine && newEngine !== result.engine) {
                        result.engine = newEngine;
                        result.file = undefined;
                        result.languages = [];
                    }
                    break;
                }
                case 'file': {
                    const currentFolder = appContext.getCurrentFolder();
                    //const date = new Date().toISOString().replace(/[:.-]/g, '').slice(0, 15); // format: YYYYMMDDTHHMMSS
                    //const fileName = currentFolder ? path.join(currentFolder.fsPath, `exported-${date}`) : `exported-${date}`;
                    const newFile = await showSaveFileDialog('Enter file name where to export resources', {
                        filters: selectedExporter!.fileFilter,
                        defaultUri: result.file ? vscode.Uri.file(result.file) : currentFolder,
                        title: 'Export resources to Excel file'
                    });

                    if (newFile) {
                        result.file = newFile.fsPath;
                    }
                    break;
                }
                case 'languages': {
                    const newLangs = await ExportFileSelector.showLanguages(result, model);
                    if (newLangs) {
                        if (newLangs.length < 2) {
                            await showMessageBox('warn', 'At least one language (other than primary) must be selected!');
                            skipToRootMenu = 'languages';
                        } else if (!newLangs.some(x => x.primary)) {
                            await showMessageBox('warn', 'Primary language must be always selected!');
                            skipToRootMenu = 'languages';
                        } else {
                            if (JSON.stringify(newLangs) !== JSON.stringify(result.languages ?? [])) {
                                result.languages = newLangs.map(x => x.lang);
                            }
                        }
                    }
                    break;
                }
                case 'export': {
                    if (result.file) {
                        return result;
                    } else {
                        await showMessageBox('err', 'Please select file to export to !', undefined, false);
                    }
                    break;
                }
            }

            if (skipToRootMenu === undefined) {
                selectedRootMenu = undefined;
            }
        } while (true);
    }

    private static async showExporterEngine(data: ExportFileSelectedData): Promise<ExporterEngine | undefined> {
        const items: ExporterEnginePickItem[] = [];
        ImportExportManager.availableExporters.map(engine => {
            items.push({
                label: engine.name + (engine.engine === data.engine ? ' (selected)' : ''),
                description: engine.description,
                engine: engine.engine
            });
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select exporter engine',
            ignoreFocusOut: true,
            matchOnDescription: true,
            matchOnDetail: false
        });

        return selected ? selected.engine : undefined;
    }

    private static async showLanguages(data: ExportFileSelectedData, model: IRootModelElement): Promise<Array<{ lang: string; primary: boolean }> | undefined> {
        const items: ExporterLangPickItem[] = [];
        const languages = model.languages;

        languages.forEach(lang => {
            const isPrimary = model.primaryLanguage === lang;
            const culture = appContext.findCulture(lang);
            const label = culture ? appContext.getCultureDesc(lang) + (isPrimary ? ' (Primary)' : '') : lang;
            const description = culture ? culture.engName : lang;
            const detail = culture ? culture.nativeName : lang;
            items.push({
                label,
                description,
                detail,
                culture,
                picked: data.languages === undefined || data.languages.includes(lang)
            });
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select languages to export',
            canPickMany: true,
            ignoreFocusOut: true,
            matchOnDescription: true,
            matchOnDetail: true
        });

        return selected
            ? selected.filter(x => !isNullOrEmpty(x.culture)).map(x => ({ lang: x.culture!.name, primary: x.culture!.name === model.primaryLanguage }))
            : undefined;
    }
}