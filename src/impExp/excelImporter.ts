import fse from 'fs-extra';
import * as ExcelJS from 'exceljs';
import { ImportResourceItem, isNullOrEmpty, ITreeElementPaths, ModelUtils } from '@lhq/lhq-generators';
import { DataImporterBase, ImporterEngine, ImportPreparedData } from './types';
import { FileFilter } from '../utils';

const worksheetName = "Localizations";

export class ExcelDataImporter extends DataImporterBase {
    public get engine(): ImporterEngine {
        return 'MsExcel';
    }

    public get name(): string {
        return 'Microsoft Excel';
    }

    public get description(): string {
        return 'Imports localization data from Microsoft Excel files (*.xlsx).';
    }

    public get fileFilter(): FileFilter {
        return {
            'Excel files': ['xlsx'],
            'All files': ['*']
        };
    }

    public async getDataFromFile(filePath: string): Promise<ImportPreparedData> {
        if (await fse.pathExists(filePath) === false) {
            return { error: `Could not find file: ${filePath}` };
        }

        const workbook = await new ExcelJS.Workbook().xlsx.readFile(filePath);
        const ws = workbook.getWorksheet(worksheetName);
        if (!ws) {
            return {
                error: `Worksheet "${worksheetName}" not found in file: ${filePath}`
            };
        }

        const validateCell = (cellId: string): boolean => {
            const cell = ws.getCell(cellId);
            if (!cell || cell.value === null || String(cell.value).trim() === '') {
                return false;
            }

            return true;
        };

        if (ws.actualRowCount < 2 || ws.actualColumnCount < 3) {
            return { error: `Worksheet "${worksheetName}" does not contain enough data to import.` };
        } else if (!validateCell('A1') || !validateCell('B1')) {
            // check if there are at least 2 columns, 'A:1' -> Resource Key, 'A:2' -> Primary Language Name
            return { error: `Worksheet "${worksheetName}" does not contain valid headers. Expected at least 'Resource Key' and 'Primary Language Name'.` };
        }

        type LangCodeItem = {
            col: number;
            lang: string;
        }

        const languageCodes: LangCodeItem[] = [];

        for (let col = 2; col <= ws.actualColumnCount; col++) {
            const cell = ws.getCell(1, col);
            const cellValue = String(cell.value).trim();
            const values = cellValue?.split(' ').filter(v => v.trim() !== '');
            if (values?.length > 0) {
                const langCode = values[0];
                const culture = appContext.findCulture(langCode);
                if (culture && languageCodes.every(x => x.lang !== langCode)) {
                    languageCodes.push({ col, lang: culture.name });
                }
            }
        }

        if (languageCodes.length === 0) {
            return { error: `Worksheet "${worksheetName}" does not contain any valid language codes.` };
        }

        const startRow = 2;
        var excelResources = new Map<string, ExcelResourceLineItem>();
        for (let row = startRow; row <= ws.actualRowCount; row++) {
            let cell = ws.getCell(row, 1);
            const resourceKey = String(cell.value).trim();
            if (!isNullOrEmpty(resourceKey)) {
                if (!excelResources.has(resourceKey)) {
                    const excelResourceLineItem = new ExcelResourceLineItem(resourceKey);
                    excelResources.set(resourceKey, excelResourceLineItem);

                    languageCodes.forEach(item => {
                        const column = item.col;
                        const languageCode = item.lang;

                        cell = ws.getCell(row, column);
                        const resourceValue = String(cell.value).trim();

                        if (!isNullOrEmpty(languageCode)) {
                            excelResourceLineItem.addValue(languageCode, resourceValue);
                        }
                    });
                }
            }
        }

        const importLines = Array.from(excelResources.values());
        return { importLines, error: undefined };
    }
}

class ExcelResourceLineItem implements ImportResourceItem {
    public paths: ITreeElementPaths;
    public values: Array<{ language: string, value: string }>;

    constructor(fullKey: string) {
        this.paths = ModelUtils.createTreePaths(fullKey);
        this.values = [];
    }

    public addValue(languageCode: string, resourceValue: string) {
        if (!this.values.some(v => v.language === languageCode)) {
            this.values.push({ language: languageCode, value: resourceValue });
        }
    }
}