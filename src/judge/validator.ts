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

function normalizeOutput(output: string): string {
    return output
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => line.replace(/\s+$/g, '')) // remove trailing spaces
        .join('\n')
        .trimEnd();
}
