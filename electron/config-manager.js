const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launchFile } = require('./linked-engines');
const protocols = require('./engine-protocol');
const { XboardEngine } = require('./xboard');
const { parseOptionLine, changedSettings, scrub } = require('./engine-options');

// engine_options.json: { "<engine path>": { "<option>": value }, "__format": 2 }
// Format 2 (4.0.3) holds only the settings the user changed. Files without the mark were written
// by the options window of 4.0.2 and earlier, which saved every option an engine has.
const FORMAT_KEY = '__format';
const FORMAT = 2;
// how long an engine may take to list its options (big networks load slowly)
const OPTIONS_TIMEOUT_MS = 30000;

class ConfigManager {
    constructor(userDataPath) {
        this.configPath = path.join(userDataPath, 'engine_options.json');
        this.options = {}; // { enginePath: { optionName: value } }
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.configPath)) {
                const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                this.options = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
                if (this.options[FORMAT_KEY] !== FORMAT) this.upgrade();
            }
        } catch (e) {
            console.error("Failed to load engine options:", e);
        }
        this.options[FORMAT_KEY] = FORMAT;
    }

    // Settings saved by 4.0.2 and earlier. That options window saved every option, and on Windows
    // it could not read the default of an option whose default ended its line: such a number
    // was saved as "null", and such an on/off option as off (Houdini 6 and others crash or hang
    // on those). Values that were never real are dropped everywhere. On Windows, on/off options
    // saved as off are dropped too, since nobody can tell which of them the user chose: they go
    // back to the engine's own default. The old file is kept next to the new one.
    upgrade(platform = process.platform) {
        try {
            fs.copyFileSync(this.configPath, this.configPath.replace(/\.json$/, '') + '.before-4.0.3.json');
        } catch (e) { /* no backup: carry on */ }
        const cleaned = {};
        for (const [enginePath, saved] of Object.entries(this.options)) {
            if (enginePath === FORMAT_KEY || !saved || typeof saved !== 'object') continue;
            const kept = scrub(saved);
            if (platform === 'win32') {
                for (const [name, value] of Object.entries(kept)) {
                    if (value === false || String(value).trim().toLowerCase() === 'false') delete kept[name];
                }
            }
            cleaned[enginePath] = kept;
        }
        this.options = cleaned;
        this.options[FORMAT_KEY] = FORMAT;
        this.save();
    }

    save() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.options, null, 2));
        } catch (e) {
            console.error("Failed to save engine options:", e);
        }
    }

    getSavedOptions(enginePath) {
        if (enginePath === FORMAT_KEY) return {};
        return this.options[enginePath] || {};
    }

    // a linked engine moved: its saved options follow it
    renameEngine(oldPath, newPath) {
        protocols.rename(oldPath, newPath);
        if (!this.options[oldPath]) return;
        this.options[newPath] = { ...this.options[oldPath], ...(this.options[newPath] || {}) };
        delete this.options[oldPath];
        this.save();
    }

    updateOptions(enginePath, newOptions) {
        this.options[enginePath] = scrub({ ...(this.options[enginePath] || {}), ...newOptions });
        this.save();
    }

    // The options window was saved: `values` is everything it showed, `available` the options the
    // engine listed. Only what differs from the engine's defaults is kept (and later sent); a
    // setting put back to its default is forgotten.
    saveFromWindow(enginePath, available, values) {
        const changed = changedSettings(available, values);
        if (Object.keys(changed).length) this.options[enginePath] = changed;
        else delete this.options[enginePath];
        this.save();
        return changed;
    }

    // Spawn engine to get available options (and say which protocol it speaks)
    async fetchEngineOptions(enginePath) {
        const protocol = await protocols.resolveProtocol(enginePath);
        const extra = { protocol, protocolMode: protocols.getInfo(enginePath).mode };
        if (protocol === 'xboard') return { ...(await this.fetchXboardOptions(enginePath)), ...extra };
        return { ...(await this.fetchUciOptions(enginePath)), ...extra };
    }

    async fetchXboardOptions(enginePath) {
        const eng = new XboardEngine(enginePath, 'Options');
        eng.verbose = false;
        let failed = null;
        eng.on('error', (e) => (failed = e));
        eng.start();
        const ok = await eng.waitForUciOk(17000);
        const available = [...eng.options.values()].map(({ name, type, default: def, min, max, options, special }) => ({ name, type, default: def, min, max, options, special }));
        const name = eng.name;
        eng.quit();
        if (failed) throw failed;
        if (!ok) throw new Error('Engine timeout reading options');
        return { available, saved: this.getSavedOptions(enginePath), engineName: name };
    }

    fetchUciOptions(enginePath) {
        return new Promise((resolve, reject) => {
            const engine = spawn(launchFile(enginePath), { cwd: path.dirname(enginePath) });
            let output = '';
            let settled = false;
            const finish = (fn, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                try {
                    engine.kill();
                } catch (e) { /* already gone */ }
                fn(value);
            };

            // Timeout to kill if it hangs
            const timeout = setTimeout(() => finish(reject, new Error("Engine timeout reading options")), OPTIONS_TIMEOUT_MS);

            engine.stdout.on('data', (data) => {
                output += data.toString();
                // lines end in "\r\n" on Windows
                const lines = output.split(/\r?\n/).map((l) => l.trim());
                if (!lines.includes('uciok')) return;
                const options = [];
                let engineName;
                for (const line of lines) {
                    if (line.startsWith('option')) {
                        const parsed = this.parseOptionLine(line);
                        if (parsed) options.push(parsed);
                    } else if (line.startsWith('id name ')) {
                        engineName = line.slice(8).trim();
                    }
                }
                finish(resolve, { available: options, saved: this.getSavedOptions(enginePath), engineName });
            });

            engine.on('error', (err) => finish(reject, err));
            engine.on('close', () => finish(reject, new Error('The engine closed before it listed its options')));
            engine.stdin.on('error', () => {});

            engine.stdin.write('uci\n');
        });
    }

    // option name Hash type spin default 16 min 1 max 131072
    parseOptionLine(line) {
        return parseOptionLine(line);
    }
}

module.exports = { ConfigManager };
