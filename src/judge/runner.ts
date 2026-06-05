import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { RunResult, JudgeConfig } from './types';

export async function run(
    executablePath: string,
    input: string,
    config: JudgeConfig,
    noLimit = false
): Promise<RunResult> {
    const ext = path.extname(executablePath).toLowerCase();
    const isPython = ext === '.py';

    let command: string;
    let args: string[] = [];

    if (isPython) {
        command = 'python3';
        args = [executablePath];
    } else {
        command = executablePath;
    }

    const startTime = Date.now();
    const hrtimeStart = process.hrtime.bigint();

    const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        env: noLimit
            ? { ...process.env, ASAN_OPTIONS: 'detect_leaks=1:halt_on_error=0' }
            : process.env,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    let peakMemory = 0; // KiB

    child.stdout?.on('data', (data) => {
        stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
        stderr += data.toString();
    });

    let memoryInterval: ReturnType<typeof setInterval> | null = null;
    let hardTimeout: ReturnType<typeof setTimeout> | null = null;

    if (!noLimit) {
        // Monitor memory periodically via /proc/pid/status on Linux
        const doMemCheck = () => {
            if (!child.pid || killed) return;
            const mem = getProcessMemory(child.pid);
            if (mem > peakMemory) {
                peakMemory = mem;
            }
            if (mem > config.memoryLimit * 2 * 1024) {
                if (memoryInterval) clearInterval(memoryInterval);
                if (hardTimeout) clearTimeout(hardTimeout);
                killed = true;
                child.kill('SIGKILL');
            }
        };

        // Start first check immediately, then every 10ms
        doMemCheck();
        memoryInterval = setInterval(doMemCheck, 10);

        // Hard timeout: kill at 2x
        hardTimeout = setTimeout(() => {
            if (memoryInterval) clearInterval(memoryInterval);
            killed = true;
            child.kill('SIGKILL');
        }, config.timeLimit * 2);
    }

    // Send input
    child.stdin?.write(input);
    child.stdin?.end();

    return new Promise((resolve) => {
        child.on('close', (exitCode, signal) => {
            if (memoryInterval) clearInterval(memoryInterval);
            if (hardTimeout) clearTimeout(hardTimeout);

            const hrtimeEnd = process.hrtime.bigint();
            const elapsedMs = Number(hrtimeEnd - hrtimeStart) / 1_000_000;
            const wallTime = Date.now() - startTime;
            const time = Math.max(elapsedMs, wallTime); // use wall clock as fallback

            resolve({
                stdout,
                stderr,
                exitCode,
                signal: signal || null,
                time: Math.round(time),
                memory: Math.round(peakMemory / 1024), // convert KiB to MiB
                killed,
            });
        });

        child.on('error', (err) => {
            if (memoryInterval) clearInterval(memoryInterval);
            if (hardTimeout) clearTimeout(hardTimeout);

            resolve({
                stdout,
                stderr: stderr || err.message,
                exitCode: -1,
                signal: null,
                time: Date.now() - startTime,
                memory: Math.round(peakMemory / 1024),
                killed: true,
            });
        });
    });
}

function getProcessMemory(pid: number): number {
    try {
        return getLinuxMemory(pid);
    } catch {
        return 0;
    }
}

function getLinuxMemory(pid: number): number {
    try {
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf-8');
        const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
        if (match) {
            return parseInt(match[1], 10); // already in KiB
        }
        return 0;
    } catch {
        return 0;
    }
}
