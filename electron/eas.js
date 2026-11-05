// Engine Aggressiveness Statistics (EAS) — runs Stefan Pohl's EAS Tool V6.0 (www.sp-cc.de) on a PGN.
//
// The tool is a set of Windows batch scripts plus pgn-extract (David J. Barnes) and PGN tools by
// Norman Pollock. It is shipped unchanged in the app's resources ("eas" folder). Coliseum copies it to
// a working folder (the tool writes temporary files into its own bin folder and must never run twice
// at the same time), writes the games as source.pgn, runs the script, and reads the report it writes
// (statistics_EAS_ratinglist.txt) plus the interesting_wins.pgn / errorgames.pgn databases.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOOL_VERSION = '6.0';
const SCRIPTS = { all: 'EAS_Tool_V6.0.bat', gauntlet: 'EAS_Tool_V6.0_Gauntlet_version.bat' };
const MAX_REPORTS = 30;
const MAX_RUNTIME_MS = 3 * 60 * 60 * 1000;

// characters that break a cmd.exe batch script when they appear in an engine name
const UNSAFE = /[&|<>^%!()"=;,]/g;

class EasRunner {
    /**
     * sourceDir: the shipped EAS tool folder; dataDir: a writable folder for the working copy and reports.
     */
    constructor(mainWindow, { sourceDir, dataDir }) {
        this.mainWindow = mainWindow;
        this.sourceDir = sourceDir;
        this.workDir = path.join(dataDir, 'eas-tool');
        this.reportsDir = path.join(dataDir, 'eas-reports');
        this.proc = null;
        this.current = null;
    }

    send(channel, data) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.webContents.send(channel, data);
    }

    info() {
        const present = fs.existsSync(path.join(this.sourceDir, SCRIPTS.all)) && fs.existsSync(path.join(this.sourceDir, 'bin', 'pgn-extract.exe'));
        const emulated = !!process.env.COLISEUM_EAS_EMULATOR; // test hook (non-Windows development only)
        let reason = null;
        if (process.platform !== 'win32' && !emulated) reason = 'The EAS tool runs on Windows only.';
        else if (!present) reason = 'The EAS tool files are missing from this build.';
        return { available: !reason, reason, version: TOOL_VERSION, running: !!this.proc, current: this.current };
    }

    // fresh working copy of the tool (only the files of the shipped version)
    prepareWorkDir() {
        const stamp = path.join(this.workDir, '.coliseum-version');
        const want = `${TOOL_VERSION}:${fs.statSync(path.join(this.sourceDir, SCRIPTS.all)).size}`;
        const have = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8') : '';
        if (have !== want) {
            fs.rmSync(this.workDir, { recursive: true, force: true });
            fs.mkdirSync(this.workDir, { recursive: true });
            fs.cpSync(this.sourceDir, this.workDir, { recursive: true });
            fs.writeFileSync(stamp, want);
        }
        for (const f of ['source.pgn', 'statistics_EAS_ratinglist.txt', 'interesting_wins.pgn', 'errorgames.pgn']) {
            fs.rmSync(path.join(this.workDir, f), { force: true });
        }
    }

    /**
     * Run the tool. opts: { pgn (text), mode: 'gauntlet'|'all', label }
     * Resolves with the saved report, rejects on failure.
     */
    run({ pgn, mode = 'all', label = 'Games' }) {
        if (this.proc) return Promise.reject(new Error('The EAS tool is already running.'));
        const inf = this.info();
        if (!inf.available) return Promise.reject(new Error(inf.reason));
        if (!pgn || !/\[(White|Black) /.test(pgn)) return Promise.reject(new Error('No games to evaluate.'));

        const { text, names, games } = sanitisePgn(pgn);
        if (!games) return Promise.reject(new Error('No games to evaluate.'));
        this.prepareWorkDir();
        fs.writeFileSync(path.join(this.workDir, 'source.pgn'), text, 'latin1');

        const script = SCRIPTS[mode === 'gauntlet' ? 'gauntlet' : 'all'];
        const startedAt = Date.now();
        this.current = { label, mode, games, startedAt };
        this.send('eas-progress', { started: true, ...this.current });

        return new Promise((resolve, reject) => {
            let proc;
            if (process.env.COLISEUM_EAS_EMULATOR) {
                proc = spawn(process.execPath.includes('electron') ? 'node' : process.execPath, [process.env.COLISEUM_EAS_EMULATOR, script], { cwd: this.workDir });
            } else {
                proc = spawn('cmd.exe', ['/d', '/c', script], { cwd: this.workDir, windowsHide: true });
            }
            this.proc = proc;
            let tail = '';
            let finishedSeen = false;
            const log = [];
            const timer = setTimeout(() => this.cancel('The EAS tool took too long and was stopped.'), MAX_RUNTIME_MS);

            // The script first asks for the PGN name (without .pgn) and waits for a key press at the
            // end ("pause"). Answer the question, then close input: pause returns at once on closed input.
            proc.stdin.on('error', () => {});
            proc.stdin.end('source\r\n');
            let exitTimer = null;

            const onText = (buf) => {
                tail += buf.toString('latin1');
                const lines = tail.split(/\r?\n/);
                tail = lines.pop();
                for (const raw of lines) {
                    const line = restoreNames(raw, names).replace(/\s+$/, '');
                    if (!line || /^[*\s]+$/.test(line)) continue;
                    log.push(line);
                    if (log.length > 400) log.shift();
                    if (/\*\*\* Finished \*\*\*/.test(line) && !finishedSeen) {
                        finishedSeen = true;
                        // the report is written by now; never let a stuck "pause" hang the run
                        exitTimer = setTimeout(() => this.proc === proc && this.kill(proc), 30000);
                    }
                    this.send('eas-progress', { line: cleanLine(line), elapsed: Date.now() - startedAt });
                }
            };
            proc.stdout.on('data', onText);
            proc.stderr.on('data', onText);

            proc.on('error', (err) => {
                clearTimeout(timer);
                this.proc = null;
                this.current = null;
                this.send('eas-progress', { done: true });
                reject(err);
            });

            proc.on('close', () => {
                clearTimeout(timer);
                clearTimeout(exitTimer);
                const cancelled = this.cancelReason;
                this.cancelReason = null;
                this.proc = null;
                this.current = null;
                this.send('eas-progress', { done: true });
                if (cancelled) return reject(new Error(cancelled));
                const reportFile = path.join(this.workDir, 'statistics_EAS_ratinglist.txt');
                if (!fs.existsSync(reportFile)) {
                    return reject(new Error(`The EAS tool did not write a report.${log.length ? ` Last output: ${log.slice(-3).join(' / ')}` : ''}`));
                }
                try {
                    const raw = restoreNames(fs.readFileSync(reportFile, 'latin1'), names);
                    const report = parseReport(raw);
                    const interesting = readIfExists(path.join(this.workDir, 'interesting_wins.pgn'), names);
                    const errors = readIfExists(path.join(this.workDir, 'errorgames.pgn'), names);
                    const saved = this.saveReport({
                        label,
                        mode,
                        games,
                        startedAt,
                        seconds: Math.round((Date.now() - startedAt) / 1000),
                        report,
                        raw,
                        interestingCount: countGames(interesting),
                        errorCount: countGames(errors),
                        interesting,
                        errors,
                    });
                    resolve(saved);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    cancel(reason = 'Stopped.') {
        if (!this.proc) return;
        this.cancelReason = reason;
        this.kill(this.proc);
    }

    kill(proc) {
        if (process.platform === 'win32') {
            // the script starts pgn-extract and other programs: stop the whole tree
            spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
        } else {
            try {
                proc.kill('SIGKILL');
            } catch (e) { /* ignore */ }
        }
    }

    // ------------------------------------------------------------------ saved reports
    saveReport(r) {
        fs.mkdirSync(this.reportsDir, { recursive: true });
        const id = `${r.startedAt}`;
        const dir = path.join(this.reportsDir, id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'statistics_EAS_ratinglist.txt'), r.raw, 'utf8');
        if (r.interesting) fs.writeFileSync(path.join(dir, 'interesting_wins.pgn'), r.interesting, 'utf8');
        if (r.errors) fs.writeFileSync(path.join(dir, 'errorgames.pgn'), r.errors, 'utf8');
        const meta = { id, label: r.label, mode: r.mode, games: r.games, at: r.startedAt, seconds: r.seconds, report: r.report, interestingCount: r.interestingCount, errorCount: r.errorCount };
        fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(meta, null, 1), 'utf8');
        this.pruneReports();
        return meta;
    }

    listReports() {
        if (!fs.existsSync(this.reportsDir)) return [];
        return fs
            .readdirSync(this.reportsDir)
            .map((id) => {
                try {
                    return JSON.parse(fs.readFileSync(path.join(this.reportsDir, id, 'report.json'), 'utf8'));
                } catch (e) {
                    return null;
                }
            })
            .filter(Boolean)
            .sort((a, b) => b.at - a.at);
    }

    getReport(id) {
        const dir = path.join(this.reportsDir, String(id).replace(/[^0-9]/g, ''));
        if (!fs.existsSync(path.join(dir, 'report.json'))) return null;
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
        const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '');
        return { ...meta, raw: read('statistics_EAS_ratinglist.txt'), interesting: read('interesting_wins.pgn'), errors: read('errorgames.pgn') };
    }

    deleteReport(id) {
        const dir = path.join(this.reportsDir, String(id).replace(/[^0-9]/g, ''));
        if (dir !== this.reportsDir) fs.rmSync(dir, { recursive: true, force: true });
        return this.listReports();
    }

    pruneReports() {
        const all = this.listReports();
        all.slice(MAX_REPORTS).forEach((r) => fs.rmSync(path.join(this.reportsDir, r.id), { recursive: true, force: true }));
    }
}

// ---------------------------------------------------------------------------------------- helpers

// Engine names go through cmd.exe: characters like & ( ) % ! would break the script, so they are
// swapped for safe stand-ins in the PGN and swapped back in everything the tool writes.
function sanitisePgn(pgn) {
    const names = new Map(); // safe -> original
    const used = new Set();
    const toSafe = new Map();
    const safeName = (orig) => {
        if (toSafe.has(orig)) return toSafe.get(orig);
        let s = orig.replace(UNSAFE, '_').replace(/\s+/g, ' ').trim() || 'Unknown';
        if (s !== orig || used.has(s)) {
            let base = s, k = 2;
            while (used.has(s)) s = `${base}_${k++}`;
            names.set(s, orig);
        }
        used.add(s);
        toSafe.set(orig, s);
        return s;
    };
    let games = 0;
    const text = pgn
        .replace(/\r\n/g, '\n')
        .replace(/^\[(White|Black) "((?:[^"\\]|\\.)*)"\]/gm, (m, side, name) => {
            if (side === 'White') games++;
            return `[${side} "${safeName(name.replace(/\\"/g, '"'))}"]`;
        })
        .replace(/[^\x00-\xff]/g, '?')
        .replace(/\n/g, '\r\n');
    return { text, names, games };
}

function restoreNames(text, names) {
    if (!names || !names.size) return text;
    let out = text;
    // longest first, so "A_B_2" is restored before "A_B"
    [...names.entries()].sort((a, b) => b[0].length - a[0].length).forEach(([safe, orig]) => {
        out = out.split(safe).join(orig);
    });
    return out;
}

function readIfExists(file, names) {
    return fs.existsSync(file) ? restoreNames(fs.readFileSync(file, 'latin1'), names) : '';
}

const countGames = (pgn) => (pgn.match(/^\[Event /gm) || []).length;

const cleanLine = (line) => line.replace(/^\s*\*+\s*/, '').replace(/\s*\*+\s*$/, '').trim();

const num = (s) => {
    const v = parseFloat(String(s).replace('%', ''));
    return Number.isFinite(v) ? v : null;
};

// rows of one of the report's tables: the lines after `header` (and its dashed rule) until the next rule
function tableRows(lines, headerTest) {
    const i = lines.findIndex(headerTest);
    if (i === -1) return [];
    const rows = [];
    for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (/^-{5,}/.test(l.trim())) {
            if (rows.length) break;
            continue;
        }
        if (/^\s*\*/.test(l) || !l.trim()) {
            if (rows.length) break;
            continue;
        }
        if (/^\s*\d+\s/.test(l)) rows.push(l);
    }
    return rows;
}

/** Parse statistics_EAS_ratinglist.txt (EAS Tool V6.0) into rows per engine. */
function parseReport(raw) {
    const lines = raw.replace(/\r/g, '').split('\n');
    const engines = {};
    const get = (name) => (engines[name] = engines[name] || { name });

    // 1st list: Rank  EAS-Score  sacs  early sacs  shorts  bad draws  avg.win moves  Engine
    for (const l of tableRows(lines, (x) => /^Rank\s+EAS-Score\s+sacs\s+sacs\s+shorts\s+draws\s+moves/.test(x.trim()))) {
        const m = l.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)%?\s+([\d.]+)%?\s+([\d.]+)%?\s+([\d.]+)%?\s+(\d+)\s+(.*)$/);
        if (!m) continue;
        let name = m[8].trim();
        const warning = /XXXXX\s*WARNING/i.test(name);
        name = name.replace(/\s*XXXXX\s*WARNING.*$/i, '').trim();
        Object.assign(get(name), {
            rank: +m[1],
            eas: +m[2],
            sacsPct: num(m[3]),
            earlySacsPct: num(m[4]),
            shortWinsPct: num(m[5]),
            badDrawsPct: num(m[6]),
            avgWinMoves: +m[7],
            unreliable: warning,
        });
    }

    // 2nd list: ... wins  avg  sacs% =[Q + 5+ + 4 + 3 + 2 + 1]  early%  shorts% = [a + b + c + d + e]  bad%  Engine
    for (const l of tableRows(lines, (x) => /^Rank\s+EAS-Score\s+wins\s+moves\s+sacs\s+sacsQ/.test(x.trim()))) {
        const m = l.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)%?\s*=\s*\[([^\]]*)\]\s*([\d.]+)%?\s+([\d.]+)%?\s*=\s*\[([^\]]*)\]\s*([\d.]+)%?\s+(.*)$/);
        if (!m) continue;
        const name = m[11].replace(/\s*XXXXX\s*WARNING.*$/i, '').trim();
        const sacs = m[6].split('+').map(num);
        const shorts = m[9].split('+').map(num);
        Object.assign(get(name), {
            wins: +m[3],
            sacBreakdown: { queen: sacs[0], five: sacs[1], four: sacs[2], three: sacs[3], two: sacs[4], one: sacs[5] },
            shortBreakdown: shorts,
        });
    }
    const shortLevels = (lines.find((x) => /^Rank\s+EAS-Score\s+wins/.test(x.trim())) || '').match(/short(\d+)/g);

    // 3rd list: EAS points per category
    for (const l of tableRows(lines, (x) => /^Rank\s+EAS-Score\s+sacs\s+sacs\s+shorts\s+draws\s+Engine/.test(x.trim()))) {
        const m = l.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
        if (!m) continue;
        const name = m[7].replace(/\s*XXXXX\s*WARNING.*$/i, '').trim();
        Object.assign(get(name), { points: { sacs: +m[3], earlySacs: +m[4], shortWins: +m[5], badDraws: +m[6] } });
    }

    const find = (re) => {
        const l = lines.find((x) => re.test(x));
        const m = l && l.match(/:\s*(\d+)/);
        return m ? +m[1] : null;
    };
    const rows = Object.values(engines).filter((e) => typeof e.eas === 'number').sort((a, b) => b.eas - a.eas);
    return {
        rows,
        avgWinLength: find(/Average length of all won games/),
        shortWinLimit: find(/limit for short wins/),
        earlySacLimit: find(/Movelimit for early sac bonus/),
        shortLevels: shortLevels ? shortLevels.map((s) => +s.replace('short', '')) : null,
        evaluatedFile: ((lines.find((x) => /Evaluated file:/.test(x)) || '').split(':')[1] || '').trim(),
    };
}

module.exports = { EasRunner, parseReport, sanitisePgn, restoreNames };
