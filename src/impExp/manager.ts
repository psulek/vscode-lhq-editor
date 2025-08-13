import { ImportModelOptions, IRootModelElement } from '@lhq/lhq-generators';
import { ExcelDataImporter } from './excelImporter';
import { ExporterEngine, IDataExporter, IDataImporter, ImporterEngine } from './types';
import { LhqModelDataImporter } from './lhqImporter';
import { ExcelDataExporter } from './excelExpoter';
import fse from 'fs-extra';

const importers: IDataImporter[] = [
    new ExcelDataImporter(),
    new LhqModelDataImporter()
];

const exporters: IDataExporter[] = [
    new ExcelDataExporter()
];

export class ImportExportManager {
    public static get availableImporters(): IDataImporter[] {
        return importers;
    }

    public static get availableExporters(): IDataExporter[] {
        return exporters;
    }

    public static getImporter(engine: ImporterEngine): IDataImporter | undefined {
        return importers.find(i => i.engine === engine);
    }

    public static getExporter(engine: ExporterEngine): IDataExporter | undefined {
        return exporters.find(e => e.engine === engine);
    }

    public static async getImportData(filePath: string, engine: ImporterEngine): Promise<ImportModelOptions | string> {
        const importer = this.getImporter(engine);
        if (importer) {
            return importer.getImportData(filePath) as unknown as Required<ImportModelOptions>;
        }

        return `Importer engine "${engine}" not found.`;
    }

    public static async exportToFile(engine: ExporterEngine, filePath: string, model: IRootModelElement, modelFileName: string, languages?: string[]): Promise<string | undefined> {
        const exporter = this.getExporter(engine);
        if (exporter) {
            await exporter.exportToFile(filePath, model, modelFileName, languages);
            if (!await fse.pathExists(filePath)) {
                return `Export failed, could not create file: ${filePath}`;
            }

            return undefined;
        }
        
        return `Exporter engine "${engine}" not found.`;
    }
}