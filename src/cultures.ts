import * as vscode from 'vscode';
import { CultureInfo } from './types';
import { logger } from './utils';
import { isNullOrEmpty, strCompare } from '@lhq/lhq-generators';

export class AppCultures {
    private _cultures: CultureInfo[] = [];

    public async init(context: vscode.ExtensionContext): Promise<void> {
        const culturesFileUri = vscode.Uri.joinPath(context.extensionUri, 'dist', 'cultures.json');

        try {
            const rawContent = await vscode.workspace.fs.readFile(culturesFileUri);
            const contentString = new TextDecoder().decode(rawContent);
            const items = JSON.parse(contentString) as CultureInfo[];
            for (const culture of items) {
                this._cultures.push(culture);
            }

        } catch (error) {
            logger().log('loadCultures', 'error', 'Failed to read or parse dist/cultures.json');
        }
    }

    public getAll(): CultureInfo[] {
        return this._cultures;
    }

    public find(name: string, ignoreCase: boolean = true): CultureInfo | undefined {
        if (isNullOrEmpty(name)) {
            throw new Error('Culture name cannot be null or empty');
        }

        return this._cultures.find(culture => strCompare(name, culture.name, ignoreCase));
    }
}