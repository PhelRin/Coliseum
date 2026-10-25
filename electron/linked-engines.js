// Engines used where they live (for example an engine's own build folder) instead of
// being copied into Coliseum's engines folder.
//
// Windows locks an .exe while it runs, so an engine developer could not rebuild while
// Coliseum is playing with it. Coliseum therefore runs a snapshot: a copy of the file
// kept under <userData>/linked-engines. Snapshots are keyed by the file's modification
// time and size, so every rebuild gets a fresh one, and tournaments / Elo sessions pin
// the snapshot they started with so all their games use the same build.
//
// The engine is still identified by its original path everywhere (ratings, options,
// career stats), and it runs with its own folder as working directory, so nets and
// books next to it are still found.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY = 'linkedEngines';
const KEEP_VERSIONS = 4; // snapshots kept per engine (older ones are deleted)

const isEngineFile = (p) => (process.platform === 'win32' ? /\.exe$/i.test(p) : true);

class LinkedEngines {
    constructor(store, cacheDir) {
        this.store = store;
        this.cacheDir = cacheDir;
        this.held = new Map(); // snapshot path -> number of tournaments / Elo runs using it
    }

    entries() {
        return (this.store && this.store.get(KEY)) || [];
    }

    save(list) {
        if (this.store) this.store.set(KEY, list);
    }

    isLinked(p) {
        return !!p && this.entries().some((e) => samePath(e.path, p));
    }

    // every linked engine, with a flag for files that are no longer there
    list() {
        return this.entries().map((e) => ({
            name: path.basename(e.path),
            path: e.path,
            linked: true,
            addedAt: e.addedAt,
            missing: !isFile(e.path),
        }));
    }

    add(p) {
        const file = path.resolve(String(p || ''));
        if (!isFile(file)) return { success: false, error: 'That file does not exist.' };
        if (!isEngineFile(file)) return { success: false, error: 'Choose the engine\'s .exe file.' };
        const list = this.entries();
        if (list.some((e) => samePath(e.path, file))) return { success: true, already: true, path: file };
        list.push({ path: file, addedAt: Date.now() });
        this.save(list);
        return { success: true, path: file };
    }

    remove(p) {
        this.save(this.entries().filter((e) => !samePath(e.path, p)));
        this.dropSnapshots(p);
        return { success: true };
    }

    // point a linked engine at a new file; migrateKeys(old, new) moves ratings and options over
    relink(oldPath, newPath, migrateKeys) {
        const file = path.resolve(String(newPath || ''));
        if (!isFile(file)) return { success: false, error: 'That file does not exist.' };
        if (!isEngineFile(file)) return { success: false, error: 'Choose the engine\'s .exe file.' };
        const list = this.entries().filter((e) => !samePath(e.path, file));
        const entry = list.find((e) => samePath(e.path, oldPath));
        if (!entry) return { success: false, error: 'That engine is not linked.' };
        entry.path = file;
        this.save(list);
        this.dropSnapshots(oldPath);
        if (migrateKeys && !samePath(oldPath, file)) migrateKeys(oldPath, file);
        return { success: true, path: file };
    }

    // a runnable copy of the engine's current build (null if it is not linked or missing)
    snapshot(p) {
        if (!this.isLinked(p) || !isFile(p)) return null;
        try {
            const st = fs.statSync(p);
            const dir = this.engineDir(p);
            const version = `${Math.round(st.mtimeMs)}-${st.size}`;
            const dest = path.join(dir, version, path.basename(p));
            if (!isFile(dest)) {
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                const tmp = `${dest}.part`;
                fs.copyFileSync(p, tmp);
                fs.renameSync(tmp, dest);
                try { fs.chmodSync(dest, st.mode); } catch (e) { /* not needed on Windows */ }
            }
            this.prune(dir, version);
            return dest;
        } catch (e) {
            console.error('[Linked] Could not snapshot', p, e.message);
            return null; // fall back to running the original file
        }
    }

    // where a snapshot made earlier still exists (used when a tournament is resumed)
    stillThere(snapshotPath) {
        return !!snapshotPath && isFile(snapshotPath);
    }

    /**
     * Pin the current build of every linked engine in `paths`. Pins that are still on disk
     * are kept (a resumed tournament goes on with the build it started with). Pinned
     * snapshots are never pruned until release() is called.
     * Returns { [enginePath]: snapshotPath }.
     */
    pin(paths, existing = {}) {
        const pins = {};
        for (const p of new Set(paths)) {
            if (!this.isLinked(p)) continue;
            const snap = this.stillThere(existing[p]) ? existing[p] : this.snapshot(p);
            if (snap) pins[p] = snap;
        }
        Object.values(pins).forEach((s) => this.held.set(s, (this.held.get(s) || 0) + 1));
        return pins;
    }

    release(pins) {
        Object.values(pins || {}).forEach((s) => {
            const n = (this.held.get(s) || 0) - 1;
            if (n > 0) this.held.set(s, n);
            else this.held.delete(s);
        });
    }

    engineDir(p) {
        const key = crypto.createHash('sha1').update(path.resolve(p).toLowerCase()).digest('hex').slice(0, 12);
        return path.join(this.cacheDir, `${path.basename(p).replace(/[^\w.-]/g, '_')}-${key}`);
    }

    prune(dir, keep) {
        try {
            const versions = fs.readdirSync(dir)
                .map((v) => ({ v, t: fs.statSync(path.join(dir, v)).mtimeMs }))
                .sort((a, b) => b.t - a.t);
            for (const { v } of versions.slice(KEEP_VERSIONS)) {
                if (v === keep) continue;
                const file = path.join(dir, v);
                if ([...this.held.keys()].some((h) => path.dirname(h) === file)) continue; // pinned by a running tournament
                // a snapshot that is still running can't be deleted on Windows: try again next time
                try { fs.rmSync(file, { recursive: true, force: true }); } catch (e) { /* in use */ }
            }
        } catch (e) { /* nothing to prune */ }
    }

    dropSnapshots(p) {
        try { fs.rmSync(this.engineDir(p), { recursive: true, force: true }); } catch (e) { /* in use or gone */ }
    }
}

function isFile(p) {
    try {
        return fs.statSync(p).isFile();
    } catch (e) {
        return false;
    }
}

function samePath(a, b) {
    if (!a || !b) return false;
    const norm = (x) => path.resolve(x);
    return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

// --------------------------------------------------------------------------- launching
// UciEngine asks here which file to run for an engine path. Main installs the resolver
// once the linked list is loaded; until then (and for normal engines) the path itself runs.
let resolver = null;

function setLaunchResolver(fn) {
    resolver = fn;
}

function launchFile(enginePath) {
    try {
        return (resolver && resolver(enginePath)) || enginePath;
    } catch (e) {
        return enginePath;
    }
}

module.exports = { LinkedEngines, setLaunchResolver, launchFile, samePath };
