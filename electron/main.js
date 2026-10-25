const { app, BrowserWindow, ipcMain, shell } = require('electron');
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

// Locate the opening-books folder (shared by the tournament book picker and Game Review)
function findBooksDir() {
    const pathsToCheck = [
        path.join(process.cwd(), 'books'),
        path.join(path.dirname(process.execPath), 'books'),
        process.resourcesPath ? path.join(process.resourcesPath, 'books') : null,
        path.join(__dirname, '..', 'books'),
        path.join(__dirname, '..', 'Books')
    ].filter(Boolean);
    return pathsToCheck.find(p => fs.existsSync(p)) || null;
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

    let store;
    import('electron-store').then((module) => {
        const Store = module.default;
        store = new Store();
        tournamentManager.store = store;
        career.setStore(store);
        // fill in error bars / migrate ratings from older versions
        try {
            career.recompute();
        } catch (e) {
            console.error('[Career] recompute failed:', e);
        }
    }).catch(console.error);

    // --- IPC Handlers ---

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
                } else if (file.toLowerCase().endsWith('.exe')) {
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
        console.log("Debug: process.execPath:", process.execPath);
        console.log("Debug: process.cwd():", process.cwd());

        const pathsToCheck = [
            path.join(process.cwd(), 'engines'), // Try CWD first
            path.join(path.dirname(process.execPath), 'engines'),
            path.join(process.resourcesPath, 'engines'),
            path.join(__dirname, '..', 'Engines')
        ];

        console.log("Debug: Scanning for engines...");
        let enginesPath = pathsToCheck.find(p => {
            const exists = fs.existsSync(p);
            console.log(`Debug: Check ${p} -> ${exists}`);
            return exists;
        });

        if (!enginesPath) {
            console.log("Debug: No engines folder found. Creating 'engines' in root.");
            enginesPath = path.join(path.dirname(process.execPath), 'engines');
            try {
                fs.mkdirSync(enginesPath, { recursive: true });
            } catch (e) {
                console.error("Debug: Failed to create dir:", e);
                return [];
            }
        }

        try {
            return scanDir(enginesPath);
        } catch (e) {
            console.error("Debug: Scan failed:", e);
            return [];
        }
    });

    ipcMain.handle('scan-books', () => {
        let booksPath = findBooksDir();
        if (!booksPath) {
            booksPath = path.join(path.dirname(process.execPath), 'books');
            try {
                fs.mkdirSync(booksPath, { recursive: true });
            } catch (e) {
                console.error("Failed to create books dir:", e);
                return [];
            }
        }

        const fileList = [];
        const files = fs.readdirSync(booksPath);
        files.forEach(file => {
            if (file.toLowerCase().endsWith('.bin')) {
                fileList.push({
                    name: file,
                    path: path.join(booksPath, file)
                });
            }
        });
        return fileList;
    });

    ipcMain.handle('open-engines-folder', () => {
        const pathsToCheck = [
            path.join(process.cwd(), 'engines'),
            path.join(path.dirname(process.execPath), 'engines'),
            path.join(process.resourcesPath, 'engines'),
            path.join(__dirname, '..', 'Engines')
        ];
        let enginesPath = pathsToCheck.find(p => fs.existsSync(p));

        if (!enginesPath) {
            enginesPath = path.join(path.dirname(process.execPath), 'engines');
            fs.mkdirSync(enginesPath, { recursive: true });
        }
        shell.openPath(enginesPath);
    });

    ipcMain.handle('install-engine', async (_, srcPath) => {
        try {
            const stat = fs.statSync(srcPath);
            if (!stat.isDirectory() && !srcPath.toLowerCase().endsWith('.exe')) {
                return { success: false, error: 'Only .exe files or folders are supported for engine installation.' };
            }

            const pathsToCheck = [
                path.join(process.cwd(), 'engines'),
                path.join(path.dirname(process.execPath), 'engines'),
                path.join(process.resourcesPath, 'engines'),
                path.join(__dirname, '..', 'Engines')
            ];
            let enginesPath = pathsToCheck.find(p => fs.existsSync(p));

            if (!enginesPath) {
                enginesPath = path.join(path.dirname(process.execPath), 'engines');
                fs.mkdirSync(enginesPath, { recursive: true });
            }

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

    ipcMain.handle('install-book', async (_, srcPath) => {
        try {
            if (!srcPath.toLowerCase().endsWith('.bin')) {
                return { success: false, error: 'Only .bin Polyglot books are supported.' };
            }

            const pathsToCheck = [
                path.join(process.cwd(), 'books'),
                path.join(path.dirname(process.execPath), 'books'),
                path.join(process.resourcesPath, 'books'),
                path.join(__dirname, '..', 'Books')
            ];
            let booksPath = pathsToCheck.find(p => fs.existsSync(p));

            if (!booksPath) {
                booksPath = path.join(path.dirname(process.execPath), 'books');
                fs.mkdirSync(booksPath, { recursive: true });
            }

            const fileName = path.basename(srcPath);
            const destPath = path.join(booksPath, fileName);
            fs.copyFileSync(srcPath, destPath);

            return { success: true, destPath };
        } catch (e) {
            console.error("Book installation failed:", e);
            return { success: false, error: e.message };
        }
    });

    const { dialog } = require('electron');
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

    ipcMain.handle('save-engine-options', async (_, { path, options }) => {
        configManager.updateOptions(path, options);
        return { success: true };
    });

    // 2. Match Controls (Arbiter)
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
            blackBook: params.settings.blackBook
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

app.whenReady().then(createWindow);

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
