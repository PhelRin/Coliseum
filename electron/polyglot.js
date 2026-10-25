const fs = require('fs');

class PolyglotBook {
    constructor() {
        this.book = null;
        this.loaded = false;
        this.filePath = null;
    }

    async load(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                console.error(`Book file not found: ${filePath}`);
                return false;
            }

            // Dynamic Import for ESM module
            const mod = await import('chess-opening-book-reader');
            const Polyglot = mod.OpeningBooks.Polyglot;
            this.book = new Polyglot();

            // Read file into buffer
            const nodeBuffer = fs.readFileSync(filePath);

            // Convert to ArrayBuffer (Scanner requires ArrayBuffer, not Node Buffer)
            const arrayBuffer = nodeBuffer.buffer.slice(
                nodeBuffer.byteOffset,
                nodeBuffer.byteOffset + nodeBuffer.byteLength
            );

            this.book.loadBook(arrayBuffer); // Use ArrayBuffer
            this.filePath = filePath;
            this.loaded = true;
            console.log(`[Polyglot] Loaded book: ${filePath} (${this.book.get_entries_count ? this.book.get_entries_count() : 'Unknown'} entries)`);

            // Diagnostics removed
            return true;

            return true;
        } catch (e) {
            console.error(`[Polyglot] Failed to load book: ${e.message}`, e);
            this.loaded = false;
            return false;
        }
    }

    getMove(fen) {
        if (!this.loaded || !this.book) return null;

        try {
            const entries = this.book.find(fen);

            if (entries && Array.isArray(entries) && entries.length > 0) {
                // Weighted Random Selection
                const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
                let threshold = Math.floor(Math.random() * totalWeight);

                for (const entry of entries) {
                    threshold -= entry.weight;
                    if (threshold < 0) {
                        const move = entry.algebraic_move;
                        console.log(`[Polyglot] Selected move: ${move} (Weight: ${entry.weight}/${totalWeight})`);
                        return move;
                    }
                }
                // Fallback to first if loop finishes (rounding error?)
                return entries[0].algebraic_move;
            }
        } catch (e) {
            console.error("[Polyglot] Error finding move:", e);
        }
        return null;
    }
}

module.exports = { PolyglotBook };
