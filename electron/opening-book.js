// Lightweight Polyglot (.bin) opening-book reader used for "Book move" detection
// in Game Review. Books are binary-searched directly from a Buffer, so even
// large books (10MB+) load instantly and use no extra memory.

const fs = require('fs');
const path = require('path');
const KEYS = require('./polyglot-keys').map(h => BigInt('0x' + h));

const PIECE_KIND = { bp: 0, wp: 1, bn: 2, wn: 3, bb: 4, wb: 5, br: 6, wr: 7, bq: 8, wq: 9, bk: 10, wk: 11 };
const FILES = 'abcdefgh';

function polyglotKey(fen) {
    const [placement, turn, castling, ep] = fen.split(' ');
    let key = 0n;
    const rows = placement.split('/');
    // rows[0] is rank 8
    const board = {};
    for (let r = 0; r < 8; r++) {
        const rank = 8 - r;
        let file = 0;
        for (const ch of rows[r]) {
            if (/\d/.test(ch)) {
                file += parseInt(ch, 10);
                continue;
            }
            const color = ch === ch.toUpperCase() ? 'w' : 'b';
            const kind = PIECE_KIND[color + ch.toLowerCase()];
            key ^= KEYS[64 * kind + 8 * (rank - 1) + file];
            board[FILES[file] + rank] = color + ch.toLowerCase();
            file++;
        }
    }
    if (castling.includes('K')) key ^= KEYS[768];
    if (castling.includes('Q')) key ^= KEYS[769];
    if (castling.includes('k')) key ^= KEYS[770];
    if (castling.includes('q')) key ^= KEYS[771];
    if (ep && ep !== '-') {
        // Only hashed if a pawn of the side to move can actually capture en passant
        const f = FILES.indexOf(ep[0]);
        const pawnRank = turn === 'w' ? 5 : 4;
        const own = turn + 'p';
        const left = f > 0 ? board[FILES[f - 1] + pawnRank] : null;
        const right = f < 7 ? board[FILES[f + 1] + pawnRank] : null;
        if (left === own || right === own) key ^= KEYS[772 + f];
    }
    if (turn === 'w') key ^= KEYS[780];
    return key;
}

function decodeMove(raw, fen) {
    const toFile = raw & 7;
    const toRow = (raw >> 3) & 7;
    const fromFile = (raw >> 6) & 7;
    const fromRow = (raw >> 9) & 7;
    const promo = (raw >> 12) & 7;
    let uci = FILES[fromFile] + (fromRow + 1) + FILES[toFile] + (toRow + 1);
    if (promo) uci += ' nbrq'[promo];
    // Polyglot encodes castling as king-takes-own-rook
    const placement = fen.split(' ')[0];
    const kingOnE1 = uci.startsWith('e1') && /K/.test(placement);
    const kingOnE8 = uci.startsWith('e8') && /k/.test(placement);
    if (kingOnE1 && uci === 'e1h1') uci = 'e1g1';
    else if (kingOnE1 && uci === 'e1a1') uci = 'e1c1';
    else if (kingOnE8 && uci === 'e8h8') uci = 'e8g8';
    else if (kingOnE8 && uci === 'e8a8') uci = 'e8c8';
    return uci;
}

class PolyglotFile {
    constructor(filePath) {
        this.filePath = filePath;
        this.name = path.basename(filePath);
        this.buffer = fs.readFileSync(filePath);
        this.count = Math.floor(this.buffer.length / 16);
    }

    keyAt(i) {
        return this.buffer.readBigUInt64BE(i * 16);
    }

    lookup(fen) {
        const key = polyglotKey(fen);
        let lo = 0, hi = this.count - 1, first = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const k = this.keyAt(mid);
            if (k < key) lo = mid + 1;
            else {
                if (k === key) first = mid;
                hi = mid - 1;
            }
        }
        if (first < 0) return [];
        const out = [];
        for (let i = first; i < this.count && this.keyAt(i) === key; i++) {
            const raw = this.buffer.readUInt16BE(i * 16 + 8);
            const weight = this.buffer.readUInt16BE(i * 16 + 10);
            out.push({ uci: decodeMove(raw, fen), weight });
        }
        return out;
    }
}

class OpeningBookSet {
    constructor() {
        this.books = [];
    }

    // one folder, or several (Linux keeps the books that come with Coliseum apart from yours)
    loadDirectory(dirs) {
        this.books = [];
        for (const dir of [].concat(dirs || [])) {
            if (!dir || !fs.existsSync(dir)) continue;
            for (const file of fs.readdirSync(dir)) {
                if (!file.toLowerCase().endsWith('.bin')) continue;
                try {
                    this.books.push(new PolyglotFile(path.join(dir, file)));
                } catch (e) {
                    console.warn(`[OpeningBook] Could not load ${file}: ${e.message}`);
                }
            }
        }
        return this.books.length;
    }

    get loaded() {
        return this.books.length > 0;
    }

    // Is `uci` a book move in `fen` in any loaded book?
    isBookMove(fen, uci) {
        for (const book of this.books) {
            try {
                const entries = book.lookup(fen);
                if (entries.some(e => e.uci === uci && e.weight > 0)) return true;
            } catch (e) { /* ignore broken books */ }
        }
        return false;
    }
}

module.exports = { OpeningBookSet, PolyglotFile, polyglotKey };
