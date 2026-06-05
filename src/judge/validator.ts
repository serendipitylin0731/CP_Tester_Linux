import { Status, RunResult, JudgeConfig } from './types';

export function validate(
    runResult: RunResult,
    expectedOutput: string,
    config: JudgeConfig
): { status: Status; actualOutput?: string; errorMessage?: string } {
    if (runResult.killed) {
        // Priority: MLE > TLE
        if (runResult.memory >= config.memoryLimit * 2) {
            return { status: Status.MemoryLimitExceeded };
        }
        if (runResult.time >= config.timeLimit * 2) {
            return { status: Status.TimeLimitExceeded };
        }
        // If killed but not exceeding 2x, check other conditions
    }

    // Detect runtime errors: non-zero exit code or terminated by signal
    if (runResult.signal) {
        // If the process was killed by us (SIGKILL for TLE/MLE), handled above by killed flag.
        // Otherwise it's a crash signal like SIGSEGV, SIGABRT, SIGFPE, SIGILL.
        const signalName = runResult.signal;
        const crashSignals: Record<string, string> = {
            'SIGSEGV': 'Segmentation fault (SIGSEGV)',
            'SIGABRT': 'Aborted (SIGABRT)',
            'SIGFPE': 'Floating point exception (SIGFPE)',
            'SIGILL': 'Illegal instruction (SIGILL)',
            'SIGBUS': 'Bus error (SIGBUS)',
        };
        const msg = crashSignals[signalName] || `Killed by signal: ${signalName}`;
        return { status: Status.RuntimeError, errorMessage: runResult.stderr || msg };
    }

        // Check for AddressSanitizer memory leak report first
    const asanLeak = detectAsanLeak(runResult.stderr);
    if (asanLeak) {
        return { status: Status.MemoryLeak, errorMessage: asanLeak };
    }

    // Check for other AddressSanitizer errors (heap-buffer-overflow, stack-buffer-overflow, etc.)
    const asanError = detectAsanError(runResult.stderr);
    if (asanError) {
        return { status: Status.RuntimeError, errorMessage: asanError };
    }

    if (runResult.exitCode !== 0) {
        if (runResult.stderr) {
            return { status: Status.RuntimeError, errorMessage: runResult.stderr };
        }
        return { status: Status.RuntimeError, errorMessage: `Exit code: ${runResult.exitCode}` };
    }

    // Check TLE: between 1x and 2x limit (or killed at 2x)
    if (runResult.time > config.timeLimit) {
        return { status: Status.TimeLimitExceeded };
    }

    // Check MLE: between 1x and 2x limit (or killed at 2x)
    if (runResult.memory > config.memoryLimit) {
        return { status: Status.MemoryLimitExceeded };
    }

    // Compare output
    const normalizedExpected = normalizeOutput(expectedOutput);
    const normalizedActual = normalizeOutput(runResult.stdout);

    if (normalizedExpected === normalizedActual) {
        return { status: Status.Accepted };
    } else {
        return { status: Status.WrongAnswer, actualOutput: runResult.stdout };
    }
}

function detectAsanLeak(stderr: string): string | undefined {
    if (!stderr) return undefined;
    // Primary: LeakSanitizer report (appears when leaks are detected)
    const leakMarker = 'ERROR: LeakSanitizer:';
    let idx = stderr.indexOf(leakMarker);
    if (idx !== -1) {
        const rest = stderr.substring(idx);
        const lines = rest.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length >= 2) {
            return lines.slice(0, 2).join('\n');
        }
        return lines[0];
    }
    // Fallback: SUMMARY line mentioning leaked bytes
    const summaryMatch = stderr.match(/SUMMARY:\s*AddressSanitizer:\s*\d+\s*byte\(s\)\s+leaked/i);
    if (summaryMatch) {
        return summaryMatch[0];
    }
    return undefined;
}

function detectAsanError(stderr: string): string | undefined {
    if (!stderr) return undefined;
    const errorMarker = 'ERROR: AddressSanitizer:';
    const idx = stderr.indexOf(errorMarker);
    if (idx === -1) return undefined;
    const rest = stderr.substring(idx);
    const lines = rest.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length >= 2) {
        return lines.slice(0, 2).join('\n');
    }
    return lines[0];
}

function normalizeOutput(output: string): string {
    return output
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => line.replace(/\s+$/g, '')) // remove trailing spaces
        .join('\n')
        .trimEnd();
}
