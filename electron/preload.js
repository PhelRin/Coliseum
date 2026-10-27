const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    copyText: (text) => clipboard.writeText(text),
    scanEngines: () => ipcRenderer.invoke('scan-engines'),
    scanBooks: () => ipcRenderer.invoke('scan-books'),
    openEnginesFolder: () => ipcRenderer.invoke('open-engines-folder'),
    installEngine: (srcPath) => ipcRenderer.invoke('install-engine', srcPath),
    installBook: (srcPath) => ipcRenderer.invoke('install-book', srcPath),
    // linked engines: used from where they are, never copied into the engines folder
    pickEngineFiles: () => ipcRenderer.invoke('pick-engine-files'),
    linkEngine: (srcPath) => ipcRenderer.invoke('link-engine', srcPath),
    unlinkEngine: (enginePath) => ipcRenderer.invoke('unlink-engine', enginePath),
    relinkEngine: (oldPath, newPath) => ipcRenderer.invoke('relink-engine', { oldPath, newPath }),
    listLinkedEngines: () => ipcRenderer.invoke('list-linked-engines'),

    getEngineOptions: (enginePath) => ipcRenderer.invoke('get-engine-options', enginePath),
    saveEngineOptions: (path, options) => ipcRenderer.invoke('save-engine-options', { path, options }),

    getAudioSettings: () => ipcRenderer.invoke('get-audio-settings'),
    saveAudioSettings: (settings) => ipcRenderer.invoke('save-audio-settings', settings),

    startMatch: (params) => ipcRenderer.send('start-match', params),

    onMatchUpdate: (callback) => ipcRenderer.on('board-update', (_, data) => callback(data)),
    onEngineInfo: (callback) => ipcRenderer.on('engine-info', (_, data) => callback(data)),
    onMatchEnded: (callback) => ipcRenderer.on('match-ended', (_, data) => callback(data)),
    onMatchLog: (callback) => ipcRenderer.on('match-log', (_, data) => callback(data)),
    onMatchStarted: (callback) => ipcRenderer.on('match-started', (_, data) => callback(data)),
    onMatchError: (callback) => ipcRenderer.on('match-error', (_, data) => callback(data)),

    stopMatch: () => ipcRenderer.send('stop-match'),
    manualMove: (move) => ipcRenderer.send('manual-move', move),


    startTournament: (config) => ipcRenderer.send('start-tournament', config),
    stopTournament: () => ipcRenderer.send('stop-tournament'),
    hasSavedTournament: () => ipcRenderer.invoke('has-saved-tournament'),
    getTournamentState: () => ipcRenderer.invoke('get-tournament-state'),
    resumeTournament: () => ipcRenderer.send('resume-tournament'),
    clearSavedTournament: () => ipcRenderer.send('clear-saved-tournament'),
    onTournamentUpdate: (callback) => ipcRenderer.on('tournament-update', (_, data) => callback(data)),
    onTournamentFinish: (callback) => ipcRenderer.on('tournament-finished', (_, data) => callback(data)),
    onTournamentMatchStart: (callback) => ipcRenderer.on('tournament-match-start', (_, data) => callback(data)),

    getPresets: () => ipcRenderer.invoke('get-presets'),
    savePreset: (preset) => ipcRenderer.invoke('save-preset', preset),
    deletePreset: (name, type) => ipcRenderer.invoke('delete-preset', { name, type }),

    startElo: (config) => ipcRenderer.send('elo-start', config),
    stopElo: () => ipcRenderer.send('elo-stop'),
    getEloStatus: () => ipcRenderer.send('elo-get-status'),
    onEloUpdate: (callback) => ipcRenderer.on('elo-update', (_, data) => callback(data)),



    // Window Controls
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),

    dialogOpenFile: (options) => ipcRenderer.invoke('dialog-open-file', options),
    dialogSaveFile: (options) => ipcRenderer.invoke('dialog-save-file', options),
    saveFileContent: (filePath, content) => ipcRenderer.invoke('save-file-content', { filePath, content }),

    getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
    setRatingAnchor: (anchor) => ipcRenderer.invoke('career-set-anchor', anchor),

    getStore: (key) => ipcRenderer.invoke('get-store', key),
    setStore: (key, value) => ipcRenderer.invoke('set-store', { key, value }),

    // Generic IPC (Safe subset)
    invoke: (channel, data) => {
        let validChannels = ['scan-engines', 'scan-books', 'open-engines-folder', 'install-engine', 'install-book', 'get-engine-options', 'save-engine-options', 'analysis-start', 'dialog-open-file', 'dialog-save-file', 'save-file-content', 'get-store', 'set-store', 'has-saved-tournament', 'get-presets', 'save-preset', 'delete-preset', 'get-audio-settings', 'save-audio-settings', 'get-tournament-pgn', 'puzzle-engine-eval', 'get-system-info', 'career-set-anchor', 'get-tournament-state', 'list-tournament-archive', 'read-tournament-archive', 'delete-tournament-archive', 'fetch-online-games', 'pick-engine-files', 'link-engine', 'unlink-engine', 'relink-engine', 'list-linked-engines', 'set-engine-protocol', 'inspect-openings', 'book-info', 'remove-book', 'open-books-folder', 'pick-book-files'];
        if (validChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, data);
        }
    },
    send: (channel, data) => {
        let validChannels = ['start-match', 'stop-match', 'start-tournament', 'stop-tournament', 'resume-tournament', 'clear-saved-tournament', 'elo-start', 'elo-stop', 'elo-get-status', 'window-minimize', 'window-maximize', 'window-close', 'analysis-stop', 'analysis-update-position', 'manual-move', 'open-external', 'puzzle-gen-start', 'puzzle-gen-stop', 'game-review-start', 'game-review-stop', 'puzzle-engine-stop', 'check-for-updates', 'restart-and-install'];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    on: (channel, func) => {
        let validChannels = ['board-update', 'engine-info', 'match-ended', 'match-log', 'match-started', 'match-error', 'tournament-update', 'tournament-finished', 'tournament-warning', 'tournament-match-start', 'elo-update', 'analysis-update', 'analysis-error', 'puzzle-gen-progress', 'puzzle-gen-detected', 'puzzle-gen-finished', 'puzzle-gen-error', 'game-review-progress', 'game-review-finished', 'game-review-error', 'update-available', 'update-download-progress', 'update-downloaded', 'update-error', 'tournament-game', 'elo-game'];
        if (validChannels.includes(channel)) {
            // Strip event as it includes sender
            const subscription = (event, ...args) => func(...args);
            ipcRenderer.on(channel, subscription);
            return () => ipcRenderer.removeListener(channel, subscription);
        }
    },

    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel) // Simplified cleanup
});
