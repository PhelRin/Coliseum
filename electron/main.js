const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');

let store;
(async () => {
    const { default: Store } = await import('electron-store');
    store = new Store();
})();

const { Arbiter } = require('./arbiter');
const { TournamentManager } = require('./tournament');
const { EloManager } = require('./elo-manager');
const { ConfigManager } = require('./config-manager');
const { Career } = require('./career');
const { TournamentArchive } = require('./tournament-archive');
const { fetchOnlineGames } = require('./online-games');
const { LinkedEngines, setLaunchResolver, samePath } = require('./linked-engines');
const engineProtocols = require('./engine-protocol');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    app.quit();
}

let mainWindow;
let arbiter;
let tournamentManager;
let eloManager;
let configManager;
const career = new Career();

const { isEngineFile, looksLikeEngine, isWin, ENGINE_HINT } = require('./engine-files');

// ---- Engine and book folders
// Windows (and running from source): the "engines" / "books" folders next to the app, as always.
// Linux packages (AppImage, .deb) are read-only, so engines and books you add go to the user data
// folder (~/.config/coliseum), and the ones that come with Coliseum are read from the app itself.
function bundledDir(name) {
    const cap = name[0].toUpperCase() + name.slice(1);
    const pathsToCheck = [
        path.join(process.cwd(), name),
        path.join(path.dirname(process.execPath), name),
        process.resourcesPath ? path.join(process.resourcesPath, name) : null,
        path.join(__dirname, '..', name),
        path.join(__dirname, '..', cap),
    ].filter(Boolean);
    return pathsToCheck.find((p) => fs.existsSync(p)) || null;
}

function userDir(name) {
    const separate = !isWin && app.isPackaged;
    const dir = separate ? path.join(app.getPath('userData'), name) : bundledDir(name) || path.join(path.dirname(process.execPath), name);
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
        console.error(`Could not create the ${name} folder:`, e.message);
    }
    return dir;
}

function dirsFor(name) {
    const out = [];
    const dirs = !isWin && app.isPackaged ? [userDir(name)] : [userDir(name), bundledDir(name)];
    for (const d of dirs) if (d && fs.existsSync(d) && !out.includes(d)) out.push(d);
    return out;
}

// Linux packages: the engines and books that come with Coliseum are copied to the user data
// folder, so they keep the same path from one start to the next (an AppImage is mounted at a
// new place every time, and engines are known by their path: ratings, options, career).
function installBundledFiles() {
    if (isWin || !app.isPackaged) return;
    // copied again after every update (a rebuilt engine can have the same size as the old one)
    const marker = path.join(app.getPath('userData'), '.bundled-version');
    let copied = null;
    try {
        copied = fs.readFileSync(marker, 'utf8').trim();
    } catch (e) { /* first start */ }
    const fresh = copied !== app.getVersion();
    for (const name of ['engines', 'books']) {
        // what came with the app sits next to its executable (never the current folder)
        const from = [path.join(path.dirname(process.execPath), name), process.resourcesPath && path.join(process.resourcesPath, name)].find((d) => d && fs.existsSync(d));
        if (!from) continue;
        const to = userDir(name);
        const copy = (src, dst) => {
            for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
                const s = path.join(src, entry.name);
                const d = path.join(dst, entry.name);
                try {
                    if (entry.isDirectory()) {
                        fs.mkdirSync(d, { recursive: true });
                        copy(s, d);
                    } else if (entry.isFile()) {
                        const st = fs.statSync(s);
                        const have = fs.existsSync(d) ? fs.statSync(d) : null;
                        if (!have || fresh || have.size !== st.size) {
                            fs.copyFileSync(s, d);
                            fs.chmodSync(d, st.mode | 0o200);
                        }
                    }
                } catch (e) {
                    console.error('[Setup] Could not copy', s, e.message);
                }
            }
        };
        try {
            copy(from, to);
        } catch (e) {
            console.error(`[Setup] Could not copy the bundled ${name}:`, e.message);
        }
    }
    try {
        fs.writeFileSync(marker, app.getVersion());
    } catch (e) { /* tried again next start */ }
}

// the opening-book folders (tournament book picker and Game Review)
function findBooksDir() {
    const dirs = dirsFor('books');
    return dirs.length ? dirs : null;
}

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 680,
        backgroundColor: '#09090b',
        frame: false, // Custom titlebar
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false // Required for spawning child processes (Stockfish)
        },
        icon: path.join(__dirname, '../src/assets/icon.ico')
    });

    if (app.isPackaged) {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    } else {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    }

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        if (app.isPackaged) {
            setTimeout(() => {
                autoUpdater.checkForUpdatesAndNotify().catch(err => {
                    console.error("Initial update check failed:", err);
                });
            }, 3000);
        }
    });

    // Initialize Managers
    configManager = new ConfigManager(app.getPath('userData'));
    engineProtocols.init(app.getPath('userData'));

    // Every arbiter (Quick Match, and each game slot of a tournament or an Elo estimation run)
    // records its finished games in the engines' career stats.
    const wireCareer = (a) => {
        a.on('match-ended', (data) => career.recordGame(data));
        return a;
    };
    arbiter = wireCareer(new Arbiter(mainWindow, configManager));
    const makeArbiter = (channel) => (slot) => wireCareer(new Arbiter(mainWindow, configManager, { slot, channel }));
    tournamentManager = new TournamentManager(mainWindow, makeArbiter('tournament-game'), null);
    eloManager = new EloManager(mainWindow, makeArbiter('elo-game'), career);

    // Linked engines run from a snapshot (a copy of their current build) so the original can
    // be rebuilt while Coliseum uses it. Tournaments and Elo runs pin their own snapshot.
    const linkedEngines = new LinkedEngines(null, path.join(app.getPath('userData'), 'linked-engines'));
    tournamentManager.linked = linkedEngines;
    tournamentManager.dataDir = app.getPath('userData');
    eloManager.linked = linkedEngines;
    setLaunchResolver((p) => linkedEngines.snapshot(p));

    let store;
    let tournamentArchive = null;
    import('electron-store').then((module) => {
        const Store = module.default;
        store = new Store();
        tournamentManager.store = store;
        linkedEngines.store = store;
        tournamentArchive = new TournamentArchive(store, path.join(app.getPath('userData'), 'tournaments'));
        career.setStore(store);
        // fill in error bars / migrate ratings from older versions
        try {
            career.recompute();
        } catch (e) {
            console.error('[Career] recompute failed:', e);
        }
    }).catch(console.error);

    // Keep every finished or stopped tournament for the Tactics Trainer
    tournamentManager.on('ended', (state) => {
        try {
            if (tournamentArchive) tournamentArchive.save(state, tournamentManager.getCombinedPgn());
        } catch (e) {
            console.error('[Archive] Could not save the tournament:', e);
        }
    });

    // --- IPC Handlers ---

    ipcMain.handle('list-tournament-archive', () => (tournamentArchive ? tournamentArchive.list() : []));
    ipcMain.handle('read-tournament-archive', (_, id) => (tournamentArchive ? tournamentArchive.read(id) : null));
    ipcMain.handle('delete-tournament-archive', (_, id) => (tournamentArchive ? tournamentArchive.remove(id) : false));

    // Recent games from Chess.com / Lichess for the Tactics Trainer
    ipcMain.handle('fetch-online-games', async (_, opts) => {
        try {
            return { ok: true, ...(await fetchOnlineGames(opts || {})) };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    });

    ipcMain.on('open-external', (_, url) => {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
            shell.openExternal(url);
        }
    });

    // Helper for recursive scan with depth limit to prevent UI lags
    const scanDir = (dir, fileList = [], depth = 0) => {
        if (depth > 2) return fileList;
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            try {
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    scanDir(filePath, fileList, depth + 1);
                } else if (isEngineFile(filePath, stat)) {
                    fileList.push({
                        name: file, // Keep full name with extension for now to match previous behavior
                        path: filePath
                    });
                }
            } catch (e) {
                console.error("Error scanning file:", filePath, e);
            }
        });
        return fileList;
    };

    ipcMain.handle('scan-engines', async () => {
        let found = [];
        for (const dir of dirsFor('engines')) {
            try {
                for (const e of scanDir(dir)) if (!found.some((f) => samePath(f.path, e.path))) found.push(e);
            } catch (e) {
                console.error('Engine scan failed:', dir, e);
            }
        }
        // linked engines that are still where they were linked from
        for (const e of linkedEngines.list()) {
            if (e.missing || found.some((f) => samePath(f.path, e.path))) continue;
            found.push({ name: e.name, path: e.path, linked: true });
        }
        return found;
    });

    // ---- Linked engines
    const engineFilters = process.platform === 'win32'
        ? [{ name: 'Engines', extensions: ['exe'] }]
        : [];
    ipcMain.handle('pick-engine-files', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: 'Add engine by path',
            buttonLabel: 'Link engine',
            properties: ['openFile', 'multiSelections'],
            filters: engineFilters,
        });
        return canceled ? [] : filePaths;
    });

    // a file is linked as it is; a folder links the engines directly inside it
    ipcMain.handle('link-engine', (_, srcPath) => {
        try {
            const stat = fs.statSync(srcPath);
            if (!stat.isDirectory()) return { ...linkedEngines.add(srcPath), linked: [srcPath] };
            const files = fs.readdirSync(srcPath)
                .map((f) => path.join(srcPath, f))
                .filter((f) => {
                    try {
                        return isEngineFile(f);
                    } catch (e) {
                        return false;
                    }
                });
            if (!files.length) return { success: false, error: `No engine (${ENGINE_HINT}) found directly inside that folder.` };
            files.forEach((f) => linkedEngines.add(f));
            return { success: true, linked: files };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
    ipcMain.handle('unlink-engine', (_, enginePath) => linkedEngines.remove(enginePath));
    ipcMain.handle('relink-engine', (_, { oldPath, newPath } = {}) => linkedEngines.relink(oldPath, newPath, (from, to) => {
        career.renameEngine(from, to);
        configManager.renameEngine(from, to);
    }));
    ipcMain.handle('list-linked-engines', () => linkedEngines.list());

    ipcMain.handle('scan-books', () => {
        const fileList = [];
        for (const dir of dirsFor('books')) {
            try {
                for (const file of fs.readdirSync(dir)) {
                    if (file.toLowerCase().endsWith('.bin') && !fileList.some((b) => b.name === file)) fileList.push({ name: file, path: path.join(dir, file) });
                }
            } catch (e) {
                console.error('Book scan failed:', dir, e);
            }
        }
        return fileList;
    });

    ipcMain.handle('open-engines-folder', () => {
        shell.openPath(userDir('engines'));
    });

    ipcMain.handle('install-engine', async (_, srcPath) => {
        try {
            const stat = fs.statSync(srcPath);
            if (!stat.isDirectory() && !looksLikeEngine(srcPath)) {
                return { success: false, error: `Only engines (${ENGINE_HINT}) or folders can be installed.` };
            }
            const enginesPath = userDir('engines');

            const fileName = path.basename(srcPath);
            const destPath = path.join(enginesPath, fileName);

            if (stat.isDirectory()) {
                fs.cpSync(srcPath, destPath, { recursive: true });
            } else {
                fs.copyFileSync(srcPath, destPath);
                // Optional: Give executable permissions on Linux/macOS
                if (process.platform !== 'win32') fs.chmodSync(destPath, 0o755);
            }

            return { success: true, destPath };
        } catch (e) {
            console.error("Installation failed:", e);
            return { success: false, error: e.message };
        }
    });

    // ---- Opening books manager
    const isInBooksDir = (p) => dirsFor('books').some((d) => {
        const rel = path.relative(d, path.resolve(String(p || '')));
        return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    });
    const bookMoves = (file, fen) => {
        const { PolyglotFile } = require('./opening-book');
        const { Chess } = require('chess.js');
        const book = new PolyglotFile(file);
        const entries = book.lookup(fen);
        const total = entries.reduce((a, e) => a + e.weight, 0) || 1;
        const board = new Chess(fen);
        const merged = new Map();
        for (const e of entries) {
            const m = merged.get(e.uci) || { uci: e.uci, weight: 0 };
            m.weight += e.weight;
            merged.set(e.uci, m);
        }
        return {
            count: book.count,
            moves: [...merged.values()]
                .map((m) => {
                    let san = m.uci;
                    try {
                        const r = new Chess(board.fen()).move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] });
                        if (r) san = r.san;
                    } catch (e) { /* not legal here (a broken book entry) */ }
                    return { ...m, san, pct: (m.weight / total) * 100 };
                })
                .sort((a, b) => b.weight - a.weight),
        };
    };
    ipcMain.handle('book-info', (_, { path: file, fen } = {}) => {
        try {
            const st = fs.statSync(file);
            const { Chess } = require('chess.js');
            const r = bookMoves(file, fen || new Chess().fen());
            return { ok: true, size: st.size, modified: st.mtimeMs, entries: r.count, moves: r.moves, removable: isInBooksDir(file) };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });
    ipcMain.handle('remove-book', (_, file) => {
        // only books in Coliseum's own books folders can be deleted from the app
        if (!isInBooksDir(file) || !String(file).toLowerCase().endsWith('.bin')) return { success: false, error: 'That book is not in the books folder.' };
        try {
            fs.rmSync(file);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
    ipcMain.handle('open-books-folder', () => shell.openPath(userDir('books')));
    ipcMain.handle('pick-book-files', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: 'Add opening books',
            buttonLabel: 'Add',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'Polyglot books', extensions: ['bin'] }],
        });
        return canceled ? [] : filePaths;
    });

    ipcMain.handle('install-book', async (_, srcPath) => {
        try {
            if (!srcPath.toLowerCase().endsWith('.bin')) {
                return { success: false, error: 'Only .bin Polyglot books are supported.' };
            }

            const booksPath = userDir('books');

            const fileName = path.basename(srcPath);
            const destPath = path.join(booksPath, fileName);
            fs.copyFileSync(srcPath, destPath);

            return { success: true, destPath };
        } catch (e) {
            console.error("Book installation failed:", e);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('dialog-open-file', async (_, options) => {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: options.filters || []
        });
        if (canceled) return null;
        return filePaths[0];
    });

    ipcMain.handle('dialog-save-file', async (_, options) => {
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: options.title || 'Save File',
            defaultPath: options.defaultPath,
            filters: options.filters || []
        });
        if (canceled) return null;
        return filePath;
    });

    ipcMain.handle('save-file-content', async (_, { filePath, content }) => {
        try {
            fs.writeFileSync(filePath, content, 'utf-8');
            return { success: true };
        } catch (e) {
            console.error("Failed to save file:", e);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('get-store', (_, key) => store ? store.get(key) : null);
    ipcMain.handle('set-store', (_, { key, value }) => {
        if (!store) return true;
        if (key === 'engineCareerStats') {
            // an engine whose stats were reset (or removed) also loses its recorded games, so
            // the rating fit doesn't bring its old rating back
            const before = store.get('engineCareerStats') || {};
            const after = value || {};
            const reset = Object.keys(before).filter((p) => !after[p] || ((after[p].stats || {}).gameCount || 0) === 0 && ((before[p].stats || {}).gameCount || 0) > 0);
            if (reset.length) {
                const results = (store.get('gameResults') || []).filter((r) => !reset.includes(r.w) && !reset.includes(r.b));
                store.set('gameResults', results);
            }
            Object.values(after).forEach((e) => {
                if (e && reset.includes(e.path)) {
                    e.baseRating = 1500;
                    e.rating = 1500;
                    e.ratingError = null;
                }
            });
            store.set(key, after);
            career.recompute();
            return true;
        }
        store.set(key, value);
        return true;
    });
    ipcMain.handle('get-system-info', () => ({ cpus: os.cpus().length }));
    ipcMain.handle('career-set-anchor', (_, anchor) => career.setAnchor(anchor));

    // Config Controls
    ipcMain.handle('get-engine-options', async (_, enginePath) => {
        return await configManager.fetchEngineOptions(enginePath);
    });

    // EPD / PGN opening files: how many openings, and the first one, for the setup screens
    ipcMain.handle('inspect-openings', (_, { file, plies } = {}) => require('./opening-suite').inspect(file, { plies }));

    // UCI / WinBoard: 'auto' (ask the engine), 'uci' or 'xboard'
    ipcMain.handle('set-engine-protocol', (_, { path: enginePath, mode } = {}) => engineProtocols.setMode(enginePath, mode));

    ipcMain.handle('save-engine-options', async (_, { path, options }) => {
        configManager.updateOptions(path, options);
        return { success: true };
    });

    // 2. Match Controls (Arbiter)
    const validFen = (fen) => {
        if (typeof fen !== 'string' || !fen.trim()) return undefined;
        try {
            new (require('chess.js').Chess)(fen.trim());
            return fen.trim();
        } catch (e) {
            return undefined;
        }
    };

    ipcMain.on('start-match', (event, params) => {
        if (tournamentManager.active) return; // Don't interrupt tournament
        if (eloManager.active) eloManager.stop(); // Stop Elo if starting manual match
        // MatchSetup.jsx sends: { whitePath, blackPath, settings: { type, initial, inc } }
        // settings: { type: 'blitz', initial: ms, inc: ms }

        const settings = {
            whiteTimeControl: params.settings.whiteTimeControl,
            blackTimeControl: params.settings.blackTimeControl,
            initial: params.settings.initial,
            inc: params.settings.inc,
            whiteBook: params.settings.whiteBook,
            blackBook: params.settings.blackBook,
            // Play tab: start from a custom position (checked by chess.js in the arbiter)
            startFen: validFen(params.settings.startFen)
        };

        // If it was 'minutes' type from Tournament (different path), handle it?
        // Tournament sends: { timeControl: { value, type }, increment: ... }
        // But this handler is used by Custom Match (MatchSetup.jsx).
        // Tournament uses 'start-tournament' handler usually?
        // Wait, does Tournament use 'start-match' for individual games? 
        // No, TournamentManager calls arbiter.startMatch directly.
        // So this IPC is ONLY for Custom Match.

        arbiter.startMatch(params.whitePath, params.blackPath, settings);
    });

    ipcMain.on('stop-match', () => {
        arbiter.stopMatch();
    });

    ipcMain.on('manual-move', (_, move) => {
        arbiter.makeManualMove(move);
    });


    // 3. Tournament Controls
    ipcMain.handle('has-saved-tournament', () => {
        if (!store) return null;
        return store.get('savedTournament') || null;
    });

    ipcMain.on('resume-tournament', () => {
        if (!store) return;
        const savedState = store.get('savedTournament');
        if (savedState) {
            if (eloManager.active) eloManager.stop();
            tournamentManager.resumeTournament(savedState);
        }
    });

    ipcMain.on('clear-saved-tournament', () => {
        if (store) store.delete('savedTournament');
    });

    ipcMain.on('start-tournament', (event, config) => {
        if (eloManager.active) eloManager.stop();
        if (store) store.delete('savedTournament'); // Clear any old state just in case
        tournamentManager.startTournament(config);
    });

    ipcMain.on('stop-tournament', () => {
        tournamentManager.stopTournament();
    });

    ipcMain.handle('get-tournament-state', () => {
        if (!tournamentManager.state) return null;
        return { active: tournamentManager.active, ...tournamentManager.snapshot() };
    });

    ipcMain.handle('get-tournament-pgn', () => {
        return tournamentManager.getCombinedPgn();
    });

    // 3.5 Presets Controls
    ipcMain.handle('get-presets', () => {
        if (!store) return [];
        return store.get('presets') || [];
    });

    ipcMain.handle('save-preset', (_, preset) => {
        if (!store) return false;
        const presets = store.get('presets') || [];
        const existingIdx = presets.findIndex(p => p.name === preset.name && p.type === preset.type);
        if (existingIdx >= 0) {
            presets[existingIdx] = preset;
        } else {
            presets.push(preset);
        }
        store.set('presets', presets);
        return true;
    });

    ipcMain.handle('delete-preset', (_, { name, type }) => {
        if (!store) return false;
        const presets = store.get('presets') || [];
        const filtered = presets.filter(p => !(p.name === name && p.type === type));
        store.set('presets', filtered);
        return true;
    });

    // 4. Audio Settings
    ipcMain.handle('get-audio-settings', () => {
        if (!store) return { enabled: true, volume: 1.0 }; // Default if store is not available
        return store.get('audio', { enabled: true, volume: 1.0 });
    });

    ipcMain.handle('save-audio-settings', (_, settings) => {
        if (!store) return false;
        store.set('audio', settings);
        return true;
    });

    // 4. Elo Estimation Controls
    ipcMain.on('elo-start', (_, config) => {
        if (tournamentManager.active) tournamentManager.stopTournament();
        if (arbiter.gameActive) arbiter.stopMatch();
        eloManager.start(config || {});
    });

    ipcMain.on('elo-stop', () => {
        eloManager.stop();
    });

    ipcMain.on('elo-get-status', () => {
        eloManager.sendStatus();
    });

    // 5. Game Analysis Controls
    const { AnalysisManager } = require('./analysis-manager');
    const analysisManager = new AnalysisManager(mainWindow, configManager);

    ipcMain.handle('analysis-start', async (_, { enginePath, fen, multiPV }) => {
        // Stop conflicts
        if (tournamentManager.active) tournamentManager.stopTournament();
        if (arbiter.gameActive) arbiter.stopMatch();
        if (eloManager.active) eloManager.stop();

        const info = await analysisManager.start(enginePath, { multiPV: multiPV || 3 });
        if (fen) analysisManager.updatePosition(fen);
        return { success: analysisManager.active, multiPV: info?.multiPV || 1 };
    });

    ipcMain.on('analysis-stop', () => {
        analysisManager.stop();
    });

    ipcMain.on('analysis-update-position', (_, fen) => {
        analysisManager.updatePosition(fen);
    });

    // 6. Puzzle Generator Controls
    const { PuzzleGenerator } = require('./puzzle-generator');
    const puzzleGenerator = new PuzzleGenerator(mainWindow, configManager);

    ipcMain.on('puzzle-gen-start', (event, { enginePath, pgnText, settings }) => {
        // Stop conflicts
        if (tournamentManager.active) tournamentManager.stopTournament();
        if (arbiter.gameActive) arbiter.stopMatch();
        if (eloManager.active) eloManager.stop();
        if (analysisManager.active) analysisManager.stop();

        puzzleGenerator.start(enginePath, pgnText, settings);
    });

    ipcMain.on('puzzle-gen-stop', () => {
        puzzleGenerator.stop();
    });

    // 7. Game Review Controls
    const { GameReviewer } = require('./game-review');
    const gameReviewer = new GameReviewer(mainWindow, configManager, findBooksDir);

    ipcMain.on('game-review-start', (event, { enginePath, pgnText, scanSpeed }) => {
        // Stop conflicts
        if (tournamentManager.active) tournamentManager.stopTournament();
        if (arbiter.gameActive) arbiter.stopMatch();
        if (eloManager.active) eloManager.stop();
        if (analysisManager.active) analysisManager.stop();
        if (puzzleGenerator.isScanning) puzzleGenerator.stop();

        gameReviewer.start(enginePath, pgnText, scanSpeed);
    });

    ipcMain.on('game-review-stop', () => {
        gameReviewer.stop();
    });

    // 8. Tactics Trainer engine (checks alternative solutions & plays replies)
    const { EngineEvaluator } = require('./engine-evaluator');
    let trainerEngine = null;
    let trainerEnginePath = null;
    let trainerEngineInit = null;

    const ensureTrainerEngine = async (enginePath) => {
        if (trainerEngine && trainerEnginePath === enginePath) {
            await trainerEngineInit;
            return trainerEngine;
        }
        if (trainerEngine) trainerEngine.stop();
        trainerEngine = new EngineEvaluator('TrainerEngine', configManager);
        trainerEnginePath = enginePath;
        trainerEngineInit = trainerEngine.init(enginePath, { multiPV: 1 });
        await trainerEngineInit;
        return trainerEngine;
    };

    ipcMain.handle('puzzle-engine-eval', async (_, { enginePath, fen, movetime, multiPV }) => {
        try {
            if (!enginePath || !fen) return null;
            const ev = await ensureTrainerEngine(enginePath);
            const res = await ev.evaluate(fen, { movetime: Math.min(3000, Math.max(100, movetime || 500)), multiPV: multiPV || 1 });
            if (!res) return null;
            return { bestMove: res.bestMove, score: res.score, pv: res.pv, lines: res.lines, depth: res.depth };
        } catch (e) {
            console.error('[Trainer] engine eval failed:', e.message);
            if (trainerEngine) trainerEngine.stop();
            trainerEngine = null;
            trainerEnginePath = null;
            return null;
        }
    });

    ipcMain.on('puzzle-engine-stop', () => {
        if (trainerEngine) trainerEngine.stop();
        trainerEngine = null;
        trainerEnginePath = null;
    });

    // Make sure no analysis engine processes are left running after the app closes
    app.once('before-quit', () => {
        try { analysisManager.stop(); } catch (e) { /* ignore */ }
        try { gameReviewer.stop(); } catch (e) { /* ignore */ }
        try { puzzleGenerator.stop(); } catch (e) { /* ignore */ }
        try { if (trainerEngine) trainerEngine.stop(); } catch (e) { /* ignore */ }
    });


    // Window Controls
    ipcMain.on('window-minimize', () => mainWindow.minimize());
    ipcMain.on('window-maximize', () => {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    });
    ipcMain.on('window-close', () => mainWindow.close());

    // Initialize Auto-Updater
    initAutoUpdater();
};

function initAutoUpdater() {
    autoUpdater.autoDownload = true;

    autoUpdater.on('update-available', (info) => {
        if (mainWindow) {
            mainWindow.webContents.send('update-available', info);
        }
    });

    autoUpdater.on('download-progress', (progressObj) => {
        if (mainWindow) {
            mainWindow.webContents.send('update-download-progress', progressObj);
        }
    });

    autoUpdater.on('update-downloaded', (info) => {
        if (mainWindow) {
            mainWindow.webContents.send('update-downloaded', info);
        }
    });

    autoUpdater.on('error', (err) => {
        if (mainWindow) {
            mainWindow.webContents.send('update-error', err.message || err);
        }
    });

    ipcMain.on('check-for-updates', () => {
        if (app.isPackaged) {
            autoUpdater.checkForUpdatesAndNotify().catch(err => {
                console.error("Failed to check for updates:", err);
            });
        } else {
            console.log("[AutoUpdater] Skipped update check in development mode.");
        }
    });

    ipcMain.on('restart-and-install', () => {
        autoUpdater.quitAndInstall();
    });
}

app.whenReady().then(() => {
    installBundledFiles();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
