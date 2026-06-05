import { TestCase, TestResult, JudgeConfig, Status } from './types';
import { compile, cleanupExecutable } from './compiler';
import { run } from './runner';
import { validate } from './validator';

export async function judgeFile(
    filePath: string,
    testCases: TestCase[],
    config: JudgeConfig,
    onProgress?: (result: TestResult) => void,
    customExecutable?: string
): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const firstPassAcIndices: number[] = [];

    let executablePath: string;

    if (customExecutable) {
        executablePath = customExecutable;
    } else {
        // Compile first
        const compileResult = await compile(filePath);
        if (!compileResult.success) {
            return testCases.map(tc => ({
                id: tc.id,
                name: tc.name,
                status: Status.CompileError,
                time: 0,
                memory: 0,
                errorMessage: compileResult.error,
            }));
        }
        executablePath = compileResult.executablePath!;
    }

    try {
        // First pass: normal run without ASan
        for (let i = 0; i < testCases.length; i++) {
            const tc = testCases[i];
            const pendingResult: TestResult = {
                id: tc.id,
                name: tc.name,
                status: Status.Pending,
                time: 0,
                memory: 0,
            };
            onProgress?.(pendingResult);

            const runResult = await run(executablePath, tc.input, config);
            
            // Cap time/memory at 2x limit if killed by hard limit
            let displayTime = runResult.time;
            let displayMemory = runResult.memory;
            if (runResult.killed) {
                displayTime = Math.min(displayTime, config.timeLimit * 2);
                displayMemory = Math.min(displayMemory, config.memoryLimit * 2);
            }
            
            const validation = validate(runResult, tc.expectedOutput, config);
            const isAc = validation.status === Status.Accepted;
            if (isAc) {
                firstPassAcIndices.push(i);
            }

            // If first pass is AC, temporarily show Pending until second pass confirms it
            const result: TestResult = {
                id: tc.id,
                name: tc.name,
                status: isAc ? Status.Pending : validation.status,
                time: displayTime,
                memory: displayMemory,
                actualOutput: isAc ? undefined : validation.actualOutput,
                errorMessage: isAc ? undefined : validation.errorMessage,
            };

            results.push(result);
            onProgress?.(result);
        }
    } finally {
        // Only cleanup compiled executables, not user-provided ones
        if (!customExecutable) {
            cleanupExecutable(executablePath);
        }
    }

    // Second pass: ASan verification for AC results (only for compiled C/C++)
    if (firstPassAcIndices.length > 0 && !customExecutable) {
        const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
        if (ext === '.cpp' || ext === '.c') {
            const asanCompileResult = await compile(filePath, true);
            if (asanCompileResult.success) {
                const asanExe = asanCompileResult.executablePath!;
                try {
                    for (const idx of firstPassAcIndices) {
                        const tc = testCases[idx];
                        // No time/memory limit for ASan verification pass
                        const noLimitConfig: JudgeConfig = {
                            timeLimit: 999999999,
                            memoryLimit: 999999,
                        };
                        const asanResult = await run(asanExe, tc.input, config, true);
                        const asanValidation = validate(asanResult, tc.expectedOutput, noLimitConfig);

                        if (asanValidation.status === Status.MemoryLeak || asanValidation.status === Status.RuntimeError) {
                            results[idx] = {
                                ...results[idx],
                                status: asanValidation.status,
                                errorMessage: asanValidation.errorMessage,
                                actualOutput: asanValidation.actualOutput,
                            };
                        } else {
                            // Second pass confirmed clean -> show AC
                            results[idx] = {
                                ...results[idx],
                                status: Status.Accepted,
                                errorMessage: undefined,
                            };
                        }
                        onProgress?.(results[idx]);
                    }
                } finally {
                    cleanupExecutable(asanExe);
                }
            }
        }
    }

    return results;
}

export * from './types';
