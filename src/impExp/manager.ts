import { ImportModelOptions } from '@lhq/lhq-generators';
import { ExcelDataImporter } from './excelImporter';
import { IDataImporter, ImporterEngine } from './types';
import { LhqModelDataImporter } from './lhqImporter';

const importers: IDataImporter[] = [
    new ExcelDataImporter(),
    new LhqModelDataImporter()
];

export class ImportExportManager {
    public static get availableImporters(): IDataImporter[] {
        return importers;
    }

    public static getImporterByEngine(engine: ImporterEngine): IDataImporter | undefined {
        return importers.find(i => i.engine === engine);
    }

    public static async getImportData(filePath: string, engine: ImporterEngine): Promise<ImportModelOptions | string> {
        const importer = this.getImporterByEngine(engine);
        if (!importer) {
            return `No importer found for engine: ${engine}`;
        }
        return importer.getImportData(filePath) as unknown as Required<ImportModelOptions>;
    }

    // public static async getDataFromFile(filePath: string, engine: ImporterEngine): Promise<ImportPreparedData> {
    //     const importer = this.getImporterByEngine(engine);
    //     if (!importer) {
    //         return { error: `No importer found for engine: ${engine}` };
    //     }
    //     return importer.getDataFromFile(filePath);
    // }
}