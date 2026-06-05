(function() {
    const vscode = acquireVsCodeApi();

    let testCases = [{ id: 1, input: '', expectedOutput: '' }];
    let folderMode = false;
    let folderPath = '';
    let nextId = 2;
    let currentStatus = 'None';
    let imageFiles = {};

    const els = {
        statusImage: document.getElementById('status-image'),
        timeLimit: document.getElementById('time-limit'),
        memoryLimit: document.getElementById('memory-limit'),
        btnAdd: document.getElementById('btn-add'),
        btnFolder: document.getElementById('btn-folder'),
        btnExe: document.getElementById('btn-exe'),
        btnRun: document.getElementById('btn-run'),
        btnHelp: document.getElementById('btn-help'),
        helpPanel: document.getElementById('help-panel'),
        exeInfo: document.getElementById('exe-info'),
        folderInfo: document.getElementById('folder-info'),
        testCasesContainer: document.getElementById('test-cases'),
        resultsContainer: document.getElementById('results'),
    };

    function init() {
        renderTestCases();
        updateImage('None');
        bindEvents();
        vscode.postMessage({ type: 'getState' });
        vscode.postMessage({ type: 'getImageList' });
    }

    function bindEvents() {
        els.btnAdd.addEventListener('click', () => {
            if (folderMode) {
                alert('Cannot add test cases in folder mode');
                return;
            }
            if (testCases.length >= 5) {
                alert('Maximum 5 test cases allowed');
                return;
            }
            testCases.push({ id: nextId++, input: '', expectedOutput: '' });
            renderTestCases();
        });

        els.btnFolder.addEventListener('click', () => {
            vscode.postMessage({ type: 'selectFolder' });
        });

        els.btnRun.addEventListener('click', () => {
            runTests();
        });

        els.btnExe.addEventListener('click', () => {
            vscode.postMessage({ type: 'selectExecutable' });
        });

        els.btnHelp.addEventListener('click', () => {
            const isHidden = els.helpPanel.style.display === 'none';
            els.helpPanel.style.display = isHidden ? 'block' : 'none';
        });
    }

    const statusColorMap = {
        'None': '#3c3c3c',
        'Pending': '#1E90FF',
        'Accepted': '#22ff35',
        'Compile Error': '#f1ff29',
        'Runtime Error': '#f1ff29',
        'Memory Limit Exceeded': '#ff9f31',
        'Time Limit Exceeded': '#ff9f31',
        'Wrong Answer': '#df2500',
        'Memory Leak': '#9B59B6',
    };

    const statusAbbrMap = {
        'Accepted': 'AC',
        'Compile Error': 'CE',
        'Runtime Error': 'RE',
        'Memory Limit Exceeded': 'MLE',
        'Time Limit Exceeded': 'TLE',
        'Wrong Answer': 'WA',
        'Memory Leak': 'Leak',
        'Pending': 'Pending',
        'None': '',
    };

    function renderCaseStatusBar() {
        let bar = document.getElementById('case-status-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'case-status-bar';
            els.testCasesContainer.parentNode?.insertBefore(bar, els.testCasesContainer);
        }
        bar.style.display = 'flex';
        bar.innerHTML = '';
        testCases.forEach(tc => {
            const pill = document.createElement('div');
            pill.className = 'case-status-pill';
            pill.dataset.id = tc.id;
            pill.title = escapeHtml(tc.name || `Case ${tc.id}`);
            const span = document.createElement('span');
            span.className = 'case-status-text';
            span.textContent = '';
            pill.appendChild(span);
            bar.appendChild(pill);
        });
    }

    function updateCaseStatusPill(id, status) {
        const pill = document.querySelector(`.case-status-pill[data-id="${id}"]`);
        if (pill) {
            pill.style.background = statusColorMap[status] || '#3c3c3c';
            const text = pill.querySelector('.case-status-text');
            if (text) text.textContent = statusAbbrMap[status] || '';
        }
    }

    function resetCaseStatusBar() {
        document.querySelectorAll('.case-status-pill').forEach(pill => {
            pill.style.background = '#3c3c3c';
            const text = pill.querySelector('.case-status-text');
            if (text) text.textContent = '';
        });
    }

    function hideCaseStatusBar() {
        const bar = document.getElementById('case-status-bar');
        if (bar) bar.style.display = 'none';
    }

    function showCaseStatusBar() {
        const bar = document.getElementById('case-status-bar');
        if (bar) bar.style.display = 'flex';
    }

    function renderTestCases() {
        els.testCasesContainer.innerHTML = '';

        if (folderMode) {
            // Folder mode: show only name + result area for each case
            testCases.forEach(tc => {
                const item = document.createElement('div');
                item.className = 'test-case folder-case';
                item.dataset.id = tc.id;
                item.innerHTML = `
                    <div class="test-case-header">
                        <span>${escapeHtml(tc.name || `Case ${tc.id}`)}</span>
                    </div>
                    <div class="result-area" id="result-${tc.id}"></div>
                `;
                els.testCasesContainer.appendChild(item);
            });
            return;
        }

        // Manual mode: input/output + result area for each case
        testCases.forEach((tc, index) => {
            const div = document.createElement('div');
            div.className = 'test-case';
            div.dataset.id = tc.id;
            div.innerHTML = `
                <div class="test-case-header">
                    <span>Case ${index + 1}</span>
                    ${testCases.length > 1 ? `<button class="test-case-remove" data-id="${tc.id}">×</button>` : ''}
                </div>
                <label>Input:</label>
                <textarea class="input-area" placeholder="Enter input here...">${escapeHtml(tc.input)}</textarea>
                <label>Expected Output:</label>
                <textarea class="output-area" placeholder="Enter expected output here...">${escapeHtml(tc.expectedOutput)}</textarea>
                <div class="result-area" id="result-${tc.id}"></div>
            `;
            els.testCasesContainer.appendChild(div);
        });

        // Bind remove buttons
        document.querySelectorAll('.test-case-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(e.target.dataset.id);
                testCases = testCases.filter(t => t.id !== id);
                renderTestCases();
            });
        });

        // Bind input changes
        document.querySelectorAll('.test-case').forEach(el => {
            const id = parseInt(el.dataset.id);
            const inputArea = el.querySelector('.input-area');
            const outputArea = el.querySelector('.output-area');
            if (inputArea) {
                inputArea.addEventListener('input', () => {
                    const tc = testCases.find(t => t.id === id);
                    if (tc) tc.input = inputArea.value;
                });
            }
            if (outputArea) {
                outputArea.addEventListener('input', () => {
                    const tc = testCases.find(t => t.id === id);
                    if (tc) tc.expectedOutput = outputArea.value;
                });
            }
        });
    }

    function runTests() {
        const config = {
            timeLimit: parseInt(els.timeLimit.value) || 1000,
            memoryLimit: parseInt(els.memoryLimit.value) || 256,
        };

        // Collect current test cases
        if (!folderMode) {
            document.querySelectorAll('.test-case').forEach(el => {
                const id = parseInt(el.dataset.id);
                const tc = testCases.find(t => t.id === id);
                if (tc) {
                    const inputArea = el.querySelector('.input-area');
                    const outputArea = el.querySelector('.output-area');
                    if (inputArea) tc.input = inputArea.value;
                    if (outputArea) tc.expectedOutput = outputArea.value;
                }
            });
        }

        // Clear previous results and create/show status bar with Pending
        document.querySelectorAll('.result-area').forEach(el => el.innerHTML = '');
        renderCaseStatusBar();
        testCases.forEach(tc => updateCaseStatusPill(tc.id, 'Pending'));
        updateImage('Pending');

        vscode.postMessage({
            type: 'runTests',
            testCases,
            config
        });
    }

    const statusFolderMap = {
        'Accepted': 'AC',
        'Compile Error': 'CE',
        'Runtime Error': 'RE',
        'Memory Limit Exceeded': 'MLE',
        'Time Limit Exceeded': 'TLE',
        'Wrong Answer': 'WA',
        'Memory Leak': 'Leak',
        'Pending': 'Pending',
        'None': 'None'
    };

    function updateImage(status) {
        currentStatus = status;
        const folder = statusFolderMap[status] || status;
        const files = imageFiles[folder] || imageFiles['None'] || [];
        if (files.length === 0) {
            els.statusImage.src = '';
            return;
        }
        const randomFile = files[Math.floor(Math.random() * files.length)];
        els.statusImage.src = `${window.setsUri}/${folder}/${randomFile}`;
    }

    function showResult(result) {
        updateCaseStatusPill(result.id, result.status);

        let el = document.getElementById(`result-${result.id}`);
        if (!el) {
            // If result area doesn't exist yet (shouldn't happen with new render), create one
            el = document.createElement('div');
            el.id = `result-${result.id}`;
            el.className = 'result-area';
            els.testCasesContainer.appendChild(el);
        }

        const statusClass = 'status-' + result.status.replace(/\s+/g, '-');
        let extra = '';
        if (result.status === 'Wrong Answer' && result.actualOutput !== undefined) {
            extra = `<div class="result-output"><strong>Your Output:</strong>\n${escapeHtml(result.actualOutput)}</div>`;
        } else if ((result.status === 'Compile Error' || result.status === 'Runtime Error' || result.status === 'Memory Leak') && result.errorMessage) {
            extra = `<div class="result-error"><strong>Error:</strong>\n${escapeHtml(result.errorMessage)}</div>`;
        }

        el.innerHTML = `
            <div class="result-header">
                <span class="result-status ${statusClass}">${result.status}</span>
                <span class="result-meta">${result.time}ms | ${result.memory}MiB</span>
            </div>
            ${extra}
        `;
    }

    function showExeInfo(exePath) {
        els.exeInfo.style.display = 'block';
        els.exeInfo.innerHTML = `
            <span>Executable: ${escapeHtml(exePath)}</span>
            <button id="btn-clear-exe" title="Clear executable">✕</button>
        `;
        document.getElementById('btn-clear-exe')?.addEventListener('click', () => {
            vscode.postMessage({ type: 'clearExecutable' });
        });
    }

    function hideExeInfo() {
        els.exeInfo.style.display = 'none';
        els.exeInfo.innerHTML = '';
    }

    function escapeHtml(str) {
        if (str === undefined || str === null) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#039;');
    }

    window.addEventListener('message', (event) => {
        const msg = event.data;
        switch (msg.type) {
            case 'state':
                if (msg.testCases && msg.testCases.length > 0) {
                    testCases = msg.testCases;
                    nextId = Math.max(...testCases.map(t => t.id)) + 1;
                }
                folderMode = msg.folderMode || false;
                folderPath = msg.folderPath || '';
                if (folderMode && folderPath) {
                    els.folderInfo.style.display = 'block';
                    els.folderInfo.innerHTML = `
                        <span>Folder: ${folderPath}</span>
                        <button id="btn-exit-folder" title="Exit folder mode">✕</button>
                    `;
                    els.btnAdd.style.display = 'none';
                    document.getElementById('btn-exit-folder')?.addEventListener('click', () => {
                        vscode.postMessage({ type: 'exitFolderMode' });
                    });
                }
                if (msg.customExecutable) {
                    showExeInfo(msg.customExecutable);
                }
                renderTestCases();
                break;

            case 'result':
                showResult(msg.result);
                break;

            case 'overallStatus':
                updateImage(msg.status);
                break;

            case 'error':
                els.resultsContainer.innerHTML = `<div class="result-error">${escapeHtml(msg.message)}</div>`;
                updateImage('None');
                break;

            case 'folderError':
                els.folderInfo.style.display = 'block';
                els.folderInfo.textContent = `Error: ${msg.message}`;
                break;

            case 'folderLoaded':
                testCases = msg.testCases;
                folderMode = true;
                folderPath = msg.folderPath;
                els.folderInfo.style.display = 'block';
                els.folderInfo.innerHTML = `
                    <span>Folder: ${folderPath} (${testCases.length} cases)</span>
                    <button id="btn-exit-folder" title="Exit folder mode">✕</button>
                `;
                els.btnAdd.style.display = 'none';
                els.resultsContainer.innerHTML = '';
                renderTestCases();
                // Bind exit button
                document.getElementById('btn-exit-folder')?.addEventListener('click', () => {
                    vscode.postMessage({ type: 'exitFolderMode' });
                });
                break;

            case 'folderExited':
                testCases = msg.testCases || [{ id: 1, input: '', expectedOutput: '' }];
                folderMode = false;
                folderPath = '';
                nextId = Math.max(...testCases.map(t => t.id)) + 1;
                els.folderInfo.style.display = 'none';
                els.folderInfo.innerHTML = '';
                els.btnAdd.style.display = '';
                els.resultsContainer.innerHTML = '';
                renderTestCases();
                break;

            case 'triggerRun':
                runTests();
                break;

            case 'setFolder':
                folderPath = msg.folderPath;
                break;

            case 'executableSet':
                showExeInfo(msg.path);
                break;

            case 'executableCleared':
                hideExeInfo();
                break;

            case 'imageList':
                imageFiles = msg.images;
                updateImage(currentStatus);
                break;

            case 'clearResults':
                document.querySelectorAll('.result-area').forEach(el => el.innerHTML = '');
                hideCaseStatusBar();
                break;
        }
    });

    init();
})();
