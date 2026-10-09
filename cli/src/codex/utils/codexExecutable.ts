import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path, { delimiter as pathDelimiter, resolve as resolvePath } from 'node:path';

const windowsPath = path.win32;

export interface CodexCommand {
    command: string;
    args: string[];
}

function findWhereResults(command: string): string[] {
    try {
        const result = execFileSync('where.exe', [command], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: homedir(),
            windowsHide: process.platform === 'win32'
        });

        return result
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
    } catch {
        return [];
    }
}

function resolveShimScript(shimPath: string): string | null {
    const shimDirectory = windowsPath.dirname(shimPath);
    const script = windowsPath.join(shimDirectory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');

    if (existsSync(script)) {
        return script;
    }

    return null;
}

function resolveWindowsCandidate(candidate: string): CodexCommand | null {
    if (!existsSync(candidate)) {
        return null;
    }

    if (windowsPath.extname(candidate).toLowerCase() === '.exe') {
        return { command: candidate, args: [] };
    }

    const script = resolveShimScript(candidate);
    if (script) {
        return { command: 'node', args: [script] };
    }

    return null;
}

function resolveWindowsCodexCommand(): CodexCommand {
    for (const candidate of findWhereResults('codex')) {
        const resolved = resolveWindowsCandidate(candidate);
        if (resolved) {
            return resolved;
        }
    }

    return { command: 'codex', args: [] };
}

function findUnixCodexPath(): string | null {
    // A runner started by launchd/systemd can have a smaller PATH than the
    // interactive shell that installed Codex. Resolve an absolute executable
    // path here so later child-process spawns do not depend on that PATH.
    const pathCandidates = (process.env.PATH ?? '')
        .split(pathDelimiter)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => resolvePath(entry, 'codex'));

    const home = homedir();
    const knownCandidates = [
        path.join(home, '.local', 'bin', 'codex'),
        path.join(home, '.npm-global', 'bin', 'codex'),
        path.join(home, '.codex', 'bin', 'codex'),
        path.join(home, '.codex', 'packages', 'standalone', 'current', 'bin', 'codex'),
        path.join(home, '.codex', 'plugins', '.plugin-appserver', 'codex')
    ];

    for (const candidate of [...pathCandidates, ...knownCandidates]) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

export function resolveCodexCommand(): CodexCommand {
    const configuredPath = process.env.HAPI_CODEX_PATH?.trim();
    if (configuredPath) {
        return { command: configuredPath, args: [] };
    }

    if (process.platform !== 'win32') {
        return {
            command: findUnixCodexPath() ?? 'codex',
            args: []
        };
    }

    return resolveWindowsCodexCommand();
}
