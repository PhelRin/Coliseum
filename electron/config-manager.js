const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launchFile } = require('./linked-engines');

class ConfigManager {
    constructor(userDataPath) {
        this.configPath = path.join(userDataPath, 'engine_options.json');
        this.options = {}; // { enginePath: { optionName: value } }
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.configPath)) {
                this.options = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            }
        } catch (e) {
            console.error("Failed to load engine options:", e);
        }
    }

    save() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.options, null, 2));
        } catch (e) {
            console.error("Failed to save engine options:", e);
        }
    }

    getSavedOptions(enginePath) {
        return this.options[enginePath] || {};
    }

    // a linked engine moved: its saved options follow it
    renameEngine(oldPath, newPath) {
        if (!this.options[oldPath]) return;
        this.options[newPath] = { ...this.options[oldPath], ...(this.options[newPath] || {}) };
        delete this.options[oldPath];
        this.save();
    }

    updateOptions(enginePath, newOptions) {
        this.options[enginePath] = { ...(this.options[enginePath] || {}), ...newOptions };
        this.save();
    }

    // Spawn engine to get available options
    async fetchEngineOptions(enginePath) {
        return new Promise((resolve, reject) => {
            const engine = spawn(launchFile(enginePath), { cwd: path.dirname(enginePath) });
            let output = '';
            let options = [];

            // Timeout to kill if it hangs
            const timeout = setTimeout(() => {
                engine.kill();
                reject(new Error("Engine timeout reading options"));
            }, 3000);

            engine.stdout.on('data', (data) => {
                output += data.toString();
                // Check if we have received enough info (usually 'uciok')
                if (output.includes('uciok')) {
                    clearTimeout(timeout);
                    engine.kill();

                    // Parse options
                    const lines = output.split('\n');
                    lines.forEach(line => {
                        if (line.startsWith('option')) {
                            const parsed = this.parseOptionLine(line);
                            if (parsed) options.push(parsed);
                        }
                    });

                    resolve({
                        available: options,
                        saved: this.getSavedOptions(enginePath)
                    });
                }
            });

            engine.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });

            engine.stdin.write('uci\n');
        });
    }

    parseOptionLine(line) {
        // Example: option name Hash type spin default 16 min 1 max 131072
        // option name Ponder type check default false
        try {
            const nameMatch = line.match(/name\s+(.*?)\s+type/);
            const typeMatch = line.match(/type\s+(\w+)/);

            if (!nameMatch || !typeMatch) return null;

            const name = nameMatch[1];
            const type = typeMatch[1];

            const option = { name, type };

            const defaultMatch = line.match(/default\s+(.*?)(?:\s+min|\s+max|\s+var|$)/);
            if (defaultMatch) option.default = defaultMatch[1].trim();

            if (type === 'spin') {
                const minMatch = line.match(/min\s+(\d+)/);
                const maxMatch = line.match(/max\s+(\d+)/);
                if (minMatch) option.min = parseInt(minMatch[1]);
                if (maxMatch) option.max = parseInt(maxMatch[1]);
            } else if (type === 'combo') {
                const varMatches = line.match(/\svar\s+(.*?)(?=\svar\s|$)/g);
                if (varMatches) {
                    option.options = varMatches.map(v => v.replace(/^\s*var\s+/, '').trim());
                } else {
                    option.options = [];
                }
            }

            return option;
        } catch (e) {
            console.error("Error parsing option:", line, e);
            return null;
        }
    }
}

module.exports = { ConfigManager };
