import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TestCase, TestResult, JudgeConfig, Status } from '../judge';
import { judgeFile } from '../judge';

export class TesterProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _testCases: TestCase[] = [{ id: 1, input: '', expectedOutput: '' }];
    private _folderMode: boolean = false;
    private _folderPath: string = '';
    private _customExecutable: string = '';

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'media')
            ]
        };
        webviewView.webview.html = this._getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'runTests':
                    await this._handleRunTests(message.testCases, message.config);
                    break;
                case 'selectFolder':
                    await this._handleSelectFolder();
                    break;
                case 'loadFromFolder':
                    await this._handleLoadFromFolder(message.folderPath);
                    break;
                case 'getState':
                    this._postState();
                    break;
                case 'getImageList':
                    this._sendImageList();
                    break;
                case 'exitFolderMode':
                    this._handleExitFolderMode();
                    break;
                case 'selectExecutable':
                    await this._handleSelectExecutable();
                    break;
                case 'clearExecutable':
                    this._clearExecutable();
                    break;
            }
        });

        // Reset status when active editor changes
        this._context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                this._view?.webview.postMessage({ type: 'overallStatus', status: Status.None });
                this._view?.webview.postMessage({ type: 'clearResults' });
            })
        );

        this._sendImageList();
    }

    public runTests() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'triggerRun' });
        }
    }

    public loadFromFolder(folderPath: string) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'setFolder', folderPath });
            this._handleLoadFromFolder(folderPath);
        }
    }

    public setExecutable(exePath: string) {
        this._customExecutable = exePath;
        this._view?.webview.postMessage({ type: 'executableSet', path: exePath });
    }

    private async _handleRunTests(testCases: TestCase[], config: JudgeConfig) {
        let filePath: string;
        let customExe: string | undefined;

        if (this._customExecutable) {
            // Use custom executable, no need for active editor
            customExe = this._customExecutable;
            filePath = customExe;
        } else {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                this._view?.webview.postMessage({
                    type: 'error',
                    message: 'No active editor found. Please open a .cpp/.c/.py file or select an executable.'
                });
                return;
            }

            filePath = editor.document.fileName;
            const ext = path.extname(filePath).toLowerCase();
            if (!['.cpp', '.c', '.py'].includes(ext)) {
                this._view?.webview.postMessage({
                    type: 'error',
                    message: 'Unsupported file type. Only .cpp, .c, .py are supported.'
                });
                return;
            }

            await editor.document.save();
        }

        // Update overall status to Pending
        this._view?.webview.postMessage({
            type: 'overallStatus',
            status: Status.Pending
        });

        const results = await judgeFile(filePath, testCases, config, (result) => {
            this._view?.webview.postMessage({
                type: 'result',
                result
            });
        }, customExe);

        // Ensure all results are sent (e.g., compile error cases)
        for (const result of results) {
            this._view?.webview.postMessage({
                type: 'result',
                result
            });
        }

        // Determine overall status based on priority
        const overallStatus = this._computeOverallStatus(results);
        this._view?.webview.postMessage({
            type: 'overallStatus',
            status: overallStatus
        });
    }

    private _computeOverallStatus(results: TestResult[]): Status {
        const priority = [
            Status.CompileError,
            Status.RuntimeError,
            Status.MemoryLimitExceeded,
            Status.TimeLimitExceeded,
            Status.WrongAnswer,
            Status.MemoryLeak,
            Status.Pending,
            Status.Accepted,
            Status.None,
        ];

        for (const s of priority) {
            if (results.some(r => r.status === s)) {
                return s;
            }
        }
        return Status.Accepted;
    }

    private async _handleSelectFolder() {
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Test Data Folder'
        });
        if (folderUri && folderUri[0]) {
            this._handleLoadFromFolder(folderUri[0].fsPath);
        }
    }

    private async _handleLoadFromFolder(folderPath: string) {
        try {
            const files = fs.readdirSync(folderPath);
            const inFiles = files.filter(f => f.endsWith('.in')).sort();
            let testCases: TestCase[] = [];
            let id = 1;

            for (const inFile of inFiles) {
                const baseName = inFile.slice(0, -3); // remove .in
                const outFile = baseName + '.out';
                const ansFile = baseName + '.ans';

                let outPath = '';
                if (files.includes(outFile)) {
                    outPath = path.join(folderPath, outFile);
                } else if (files.includes(ansFile)) {
                    outPath = path.join(folderPath, ansFile);
                } else {
                    this._view?.webview.postMessage({
                        type: 'folderError',
                        message: `No matching .out/.ans file for ${inFile}`
                    });
                    return;
                }

                const input = fs.readFileSync(path.join(folderPath, inFile), 'utf-8');
                const expectedOutput = fs.readFileSync(outPath, 'utf-8');
                testCases.push({ id: id++, name: baseName, input, expectedOutput });
            }

            if (testCases.length === 0) {
                this._view?.webview.postMessage({
                    type: 'folderError',
                    message: 'No valid .in/.out(.ans) file pairs found in the folder'
                });
                return;
            }

            const MAX_FOLDER_CASES = 100;
            let truncatedMsg = '';
            if (testCases.length > MAX_FOLDER_CASES) {
                testCases = testCases.slice(0, MAX_FOLDER_CASES);
                truncatedMsg = ` (truncated to ${MAX_FOLDER_CASES} cases)`;
            }

            this._testCases = testCases;
            this._folderMode = true;
            this._folderPath = folderPath;

            this._view?.webview.postMessage({
                type: 'folderLoaded',
                testCases,
                folderPath: folderPath + truncatedMsg
            });
        } catch (err: any) {
            this._view?.webview.postMessage({
                type: 'folderError',
                message: err.message || String(err)
            });
        }
    }

    private _handleExitFolderMode() {
        this._testCases = [{ id: 1, input: '', expectedOutput: '' }];
        this._folderMode = false;
        this._folderPath = '';
        this._view?.webview.postMessage({
            type: 'folderExited',
            testCases: this._testCases
        });
    }

    private async _handleSelectExecutable() {
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
            this.setExecutable(fileUri[0].fsPath);
        }
    }

    private _clearExecutable() {
        this._customExecutable = '';
        this._view?.webview.postMessage({ type: 'executableCleared' });
    }

    private _postState() {
        this._view?.webview.postMessage({
            type: 'state',
            testCases: this._testCases,
            folderMode: this._folderMode,
            folderPath: this._folderPath,
            customExecutable: this._customExecutable
        });
    }

    private _sendImageList() {
        const setsDir = vscode.Uri.joinPath(this._extensionUri, 'media', 'sets');
        const images: Record<string, string[]> = {};
        const statuses = ['None', 'Pending', 'AC', 'CE', 'RE', 'MLE', 'TLE', 'WA', 'Leak'];

        for (const status of statuses) {
            const dir = vscode.Uri.joinPath(setsDir, status);
            const dirPath = dir.fsPath;
            try {
                if (fs.existsSync(dirPath)) {
                    const files = fs.readdirSync(dirPath)
                        .filter(f => f.toLowerCase().endsWith('.png') || f.toLowerCase().endsWith('.gif'));
                    images[status] = files;
                } else {
                    images[status] = [];
                }
            } catch {
                images[status] = [];
            }
        }

        this._view?.webview.postMessage({
            type: 'imageList',
            images
        });
    }

    private _getHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'));
        const setsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'sets'));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>CP Tester</title>
</head>
<body>
    <div id="app">
        <div id="image-area">
            <img id="status-image" src="" alt="status">
        </div>
        <div id="config-area">
            <label>Time Limit (ms): <input type="number" id="time-limit" value="1000" min="1" max="60000"></label>
            <label>Memory Limit (MiB): <input type="number" id="memory-limit" value="256" min="1" max="2048"></label>
        </div>
        <div id="actions">
            <button id="btn-add" title="Add test case">+</button>
            <button id="btn-folder" title="Load from folder">📁</button>
            <button id="btn-exe" title="Select executable">📥</button>
            <button id="btn-run" title="Run tests">▶ Run</button>
            <button id="btn-help" title="Help">?</button>
        </div>
        <div id="help-panel" style="display:none;">
            <p><strong>+</strong>：添加一组测试数据（输入 + 期望输出），最多 5 组。</p>
            <p><strong>📥 导入可执行文件</strong>：选择已编译好的可执行文件，直接运行测试而不再编译当前代码。</p>
            <p><strong>📁 加载文件夹</strong>：选择包含 .in / .out（或 .ans）文件对的文件夹，批量导入测试数据，最多 100 组。</p>
        </div>
        <div id="exe-info" style="display:none;"></div>
        <div id="folder-info" style="display:none;"></div>
        <div id="test-cases"></div>
        <div id="results"></div>
    </div>
    <script>
        window.setsUri = ${JSON.stringify(setsUri.toString())};
    </script>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
