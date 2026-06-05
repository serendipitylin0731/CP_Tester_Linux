import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CompileResult {
    success: boolean;
    executablePath?: string;
    error?: string;
}

export async function compile(sourcePath: string, useAsan = false): Promise<CompileResult> {
    const ext = path.extname(sourcePath).toLowerCase();
    const basename = path.basename(sourcePath, ext);
    const dir = path.dirname(sourcePath);
    const tmpDir = os.tmpdir();

    if (ext === '.py') {
        return { success: true, executablePath: sourcePath };
    }

    const suffix = useAsan ? '_asan' : '';
    const outFile = path.join(tmpDir, `cp_tester_${basename}_${Date.now()}${suffix}`);

    const asanFlags = useAsan ? '-fsanitize=address -fno-omit-frame-pointer -g ' : '';
    let command: string;
    if (ext === '.cpp') {
        command = `g++ -std=c++17 -O2 ${asanFlags}-o "${outFile}" "${sourcePath}"`;
    } else if (ext === '.c') {
        command = `gcc -O2 ${asanFlags}-o "${outFile}" "${sourcePath}"`;
    } else {
        return { success: false, error: `Unsupported file extension: ${ext}` };
    }

    try {
        const { stderr } = await execAsync(command, { timeout: 30000 });
        // Only treat as compile error if stderr contains a real gcc/g++ error pattern
        if (stderr && /:\s*error:/i.test(stderr)) {
            return { success: false, error: stderr };
        }
        return { success: true, executablePath: outFile };
    } catch (err: any) {
        return { success: false, error: err.stderr || err.message || String(err) };
    }
}

export function cleanupExecutable(executablePath: string) {
    try {
        // Only delete files in temp directory (compiled executables).
        // For Python, executablePath is the source file itself - do NOT delete it.
        const tmpDir = os.tmpdir().toLowerCase();
        if (executablePath.toLowerCase().startsWith(tmpDir)) {
            if (fs.existsSync(executablePath)) {
                fs.unlinkSync(executablePath);
            }
        }
    } catch {
        // ignore cleanup errors
    }
}
