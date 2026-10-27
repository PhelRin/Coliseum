// What counts as an engine file on this system.
// Windows: .exe files. Linux (and macOS): executable programs, i.e. files with the execute
// bit that start like a native binary (ELF / Mach-O) or a script ("#!"). Nets, books and
// other data files next to an engine are skipped, and so are Windows .exe files on Linux.

const fs = require('fs');

const isWin = process.platform === 'win32';

const MAGIC = [
    [0x7f, 0x45, 0x4c, 0x46], // ELF
    [0x23, 0x21], // #!
    [0xcf, 0xfa, 0xed, 0xfe], // Mach-O 64-bit
    [0xce, 0xfa, 0xed, 0xfe], // Mach-O 32-bit
    [0xca, 0xfe, 0xba, 0xbe], // Mach-O universal
];

function isEngineFile(filePath, stat) {
    if (isWin) return /\.exe$/i.test(filePath);
    try {
        const st = stat || fs.statSync(filePath);
        if (!st.isFile() || (st.mode & 0o111) === 0) return false;
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(4);
        const n = fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);
        return MAGIC.some((m) => n >= m.length && m.every((b, i) => buf[i] === b));
    } catch (e) {
        return false;
    }
}

// a dropped or picked file that could be an engine (before it is made executable)
function looksLikeEngine(filePath) {
    if (isWin) return /\.exe$/i.test(filePath);
    try {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(4);
        const n = fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);
        return MAGIC.some((m) => n >= m.length && m.every((b, i) => buf[i] === b));
    } catch (e) {
        return false;
    }
}

const ENGINE_HINT = isWin ? 'an .exe file' : 'a Linux engine binary';

module.exports = { isEngineFile, looksLikeEngine, isWin, ENGINE_HINT };
