import * as vscode from 'vscode';
import { TesterProvider } from './webview/provider';

export function activate(context: vscode.ExtensionContext) {
    const provider = new TesterProvider(context.extensionUri, context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('cpTester.panel', provider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cpTester.runTests', () => {
            provider.runTests();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cpTester.selectFolder', async () => {
            const folderUri = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Test Data Folder'
            });
            if (folderUri && folderUri[0]) {
                provider.loadFromFolder(folderUri[0].fsPath);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cpTester.selectExecutable', async () => {
            const fileUri = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: 'Select Executable',
                filters: {
                    'All Files': ['*']
                }
            });
            if (fileUri && fileUri[0]) {
                provider.setExecutable(fileUri[0].fsPath);
            }
        })
    );
}

export function deactivate() {}
