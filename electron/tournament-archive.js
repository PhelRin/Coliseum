// Keeps the PGN of every finished (or stopped) tournament so the Tactics Trainer
// can turn past tournaments into puzzles without the user hunting for files.
// PGNs live as files under <userData>/tournaments; the store keeps a small index.

const fs = require('fs');
const path = require('path');

const KEY = 'tournamentArchive';
const MAX_ENTRIES = 50;

const TYPE_NAMES = {
    gauntlet: 'Gauntlet',
    round_robin: 'Round Robin',
    swiss: 'Swiss',
    elimination: 'Knockout',
    double_elimination: 'Double Knockout',
};

class TournamentArchive {
    constructor(store, dir) {
        this.store = store;
        this.dir = dir;
    }

    list() {
        const items = (this.store && this.store.get(KEY)) || [];
        return items.filter((e) => fs.existsSync(path.join(this.dir, e.file)));
    }

    // state: TournamentManager.state; pgn: its combined PGN
    save(state, pgn) {
        if (!this.store || !state || !pgn || !pgn.trim()) return null;
        const games = (pgn.match(/\[Event /g) || []).length;
        if (games === 0) return null;
        const cfg = state.config || {};
        const id = String(state.startedAt || Date.now());
        const file = `${id}.pgn`;
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(path.join(this.dir, file), pgn, 'utf8');

        const engines = cfg.engines || [];
        const hero = cfg.type === 'gauntlet' ? engines.find((e) => e.path === cfg.hero) : null;
        const entry = {
            id,
            file,
            type: cfg.type || 'tournament',
            title: `${TYPE_NAMES[cfg.type] || 'Tournament'}${hero ? ` · ${hero.name}` : ''}`,
            engines: engines.map((e) => e.name),
            games,
            finished: !!state.finished,
            date: state.finishedAt || state.stoppedAt || Date.now(),
        };
        const items = ((this.store.get(KEY) || []).filter((e) => e.id !== id));
        items.unshift(entry);
        // keep the newest entries; delete the files of the ones that drop off
        for (const old of items.slice(MAX_ENTRIES)) {
            try { fs.unlinkSync(path.join(this.dir, old.file)); } catch (e) { /* already gone */ }
        }
        this.store.set(KEY, items.slice(0, MAX_ENTRIES));
        return entry;
    }

    read(id) {
        const entry = this.list().find((e) => e.id === String(id));
        if (!entry) return null;
        return fs.readFileSync(path.join(this.dir, entry.file), 'utf8');
    }

    remove(id) {
        const items = (this.store && this.store.get(KEY)) || [];
        const entry = items.find((e) => e.id === String(id));
        if (entry) {
            try { fs.unlinkSync(path.join(this.dir, entry.file)); } catch (e) { /* already gone */ }
        }
        this.store.set(KEY, items.filter((e) => e.id !== String(id)));
        return true;
    }
}

module.exports = { TournamentArchive };
