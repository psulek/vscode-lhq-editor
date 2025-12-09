import type { ImportModelMode, ImportModelOptions, ImportResourceItem, IRootModelElement } from '@psulek/lhq-generators';
import type { FileFilter } from '../utils';

export type ImportPreparedData = {
    error: string | undefined;
    importLines?: ImportResourceItem[] | undefined;
}

export type ImporterEngine = 'MsExcel' | 'Lhq';

export interface IDataImporter {
    /**
     * Importer engine name.
     */
    get engine(): ImporterEngine;

    /**
     * Importer engine display name.
     */
    get name(): string;

    /**
     * Importer engine description.
     */
    get description(): string;

    /**
     * File filter for the importer.
     */
    get fileFilter(): FileFilter;

    /**
     * Flag indicating whether the importer allows creating new elements during import.
     */
    get allowNewElements(): boolean;

    /**
     * Get import model options for the importer.
     * @param filePath Path to the file to import data from.
     * @return Promise with import model options or error message.
     */
    getImportData(filePath: string): Promise<Partial<ImportModelOptions> | string>;
}

export abstract class DataImporterBase implements IDataImporter {
    public abstract get engine(): ImporterEngine;

    public abstract get name(): string;

    public abstract get description(): string;

    public abstract get fileFilter(): FileFilter;

    public get allowNewElements(): boolean {
        return false;
    }

    /**
     * Read/parse and prepare data from the file for import.
     * @param filePath Path to the file to import data from.
     * @return Promise with prepared data or error message.
     */
    protected getDataFromFile(filePath: string): Promise<ImportPreparedData> {
        throw new Error('Method not implemented.');
    }

    public async getImportData(filePath: string): Promise<Partial<ImportModelOptions> | string> {
        const data = await this.getDataFromFile(filePath);
        if (data.error) {
            return data.error;
        }

        return {
            sourceKind: 'rows',
            source: data.importLines ?? []
        };
    }
}

export type ImportFileSelectedData = {
    engine: ImporterEngine;
    mode: ImportModelMode;
    allowNewElements: boolean;
    file?: string;
}

export const excelWorksheetName = "Localizations";

export type ExporterEngine = 'MsExcel';

export interface IDataExporter {
    /**
     * Exporter engine name.
     */
    get engine(): ExporterEngine;

    /**
     * Exporter engine display name.
     */
    get name(): string;

    /**
     * Exporter engine description.
     */
    get description(): string;

    /**
     * File filter for the importer.
     */
    get fileFilter(): FileFilter;

    /**
     * Exports localization data to a file.
     * @param filePath Path to the file to export data to.
     * @param model Model containing localization data.
     * @param modelFileName Name of the model file.
     * @param languages Optional list of languages to export. If not provided, all languages from the model will be used.
     */
    exportToFile(filePath: string, model: IRootModelElement, modelFileName: string, languages?: string[]): Promise<void>;
}


export type ExportFileSelectedData = {
    engine: ExporterEngine;
    file?: string;
    languages?: string[];
}