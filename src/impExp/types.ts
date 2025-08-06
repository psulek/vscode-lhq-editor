import type { ImportModelMode, ImportResourceItem } from '@lhq/lhq-generators';

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
     * Read/parse and prepare data from the file for import.
     * @param filePath Path to the file to import data from.
     * @return Promise with prepared data or error message.
     */
    getDataFromFile(filePath: string): Promise<ImportPreparedData>;
}

export type ImportFileSelectedData = {
    engine: ImporterEngine;
    mode: ImportModelMode;
    file?: string;
}
