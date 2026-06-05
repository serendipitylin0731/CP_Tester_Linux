export enum Status {
    None = 'None',
    Pending = 'Pending',
    Accepted = 'Accepted',
    CompileError = 'Compile Error',
    RuntimeError = 'Runtime Error',
    MemoryLimitExceeded = 'Memory Limit Exceeded',
    TimeLimitExceeded = 'Time Limit Exceeded',
    WrongAnswer = 'Wrong Answer',
    MemoryLeak = 'Memory Leak',
}

export interface TestCase {
    id: number;
    name?: string;
    input: string;
    expectedOutput: string;
}

export interface TestResult {
    id: number;
    name?: string;
    status: Status;
    time: number;      // ms
    memory: number;    // MiB
    actualOutput?: string;
    errorMessage?: string;
}

export interface JudgeConfig {
    timeLimit: number;      // ms
    memoryLimit: number;    // MiB
}

export interface RunResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: string | null;  // e.g. 'SIGSEGV', 'SIGABRT', 'SIGFPE'
    time: number;      // ms
    memory: number;    // MiB
    killed: boolean;
}
