import * as vscode from 'vscode';

export type LogType = 'debug' | 'info' | 'warn' | 'error';

export type ILogger = {
    log: (level: LogType, msg: string, err?: Error) => void;
};

export class ConsoleLogger implements ILogger {
    log(level: LogType, msg: string, err?: Error | undefined): void {
        console[level](msg, err);
    }
}

export class VsCodeLogger implements ILogger {
    private static panel: vscode.OutputChannel | undefined;
    private _debugMode = true;

    public updateDebugMode(debug: boolean) {
        this._debugMode = debug;
    }

    log(level: LogType, msg: string, err?: Error | undefined): void {
        const text = `[${level}] ${msg}` + (err ? `[${err.name}] ${err.message} ${err.stack}` : '');

        if (this._debugMode || level === 'debug') {
            if (err) {
                console.log(text, err);
            } else {
                console.log(text);
            }
            return;
        }

        if (!VsCodeLogger.panel) {
            VsCodeLogger.panel = vscode.window.createOutputChannel('LHQ Editor');
        }

        VsCodeLogger.panel.appendLine(text);
    }
}