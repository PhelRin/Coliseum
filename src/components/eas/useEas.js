import { useEffect, useState, useCallback } from 'react';

/**
 * State of the EAS tool (Stefan Pohl's Engine Aggressiveness Statistics): whether it can run here,
 * the run in progress (its latest output lines), and the saved reports.
 */
export function useEas() {
    const [info, setInfo] = useState(null);
    const [running, setRunning] = useState(null); // { label, mode, games, startedAt }
    const [lines, setLines] = useState([]);
    const [reports, setReports] = useState([]);
    const [error, setError] = useState(null);

    const refresh = useCallback(async () => {
        if (!window.electronAPI) return;
        const [i, r] = await Promise.all([window.electronAPI.invoke('eas-info'), window.electronAPI.invoke('eas-reports')]);
        setInfo(i || null);
        setReports(r || []);
        if (i && i.running && i.current) setRunning(i.current);
    }, []);

    useEffect(() => {
        refresh();
        if (!window.electronAPI || !window.electronAPI.on) return undefined;
        return window.electronAPI.on('eas-progress', (d) => {
            if (!d) return;
            if (d.started) {
                setRunning({ label: d.label, mode: d.mode, games: d.games, startedAt: d.startedAt });
                setLines([]);
                setError(null);
            }
            if (d.line) setLines((l) => [...l, d.line].slice(-60));
            if (d.done) {
                setRunning(null);
                refresh();
            }
        });
    }, [refresh]);

    /** Run the tool. source: { pgn } or { path }; mode: 'gauntlet' | 'all'. Resolves with the report or null. */
    const run = useCallback(async (source, mode, label) => {
        setError(null);
        const res = await window.electronAPI.invoke('eas-run', { ...source, mode, label });
        if (!res || !res.ok) {
            setError((res && res.error) || 'The EAS tool failed.');
            return null;
        }
        await refresh();
        return res.report;
    }, [refresh]);

    const cancel = () => window.electronAPI.send('eas-cancel');

    const remove = async (id) => setReports((await window.electronAPI.invoke('eas-delete-report', id)) || []);

    return { info, running, lines, reports, error, run, cancel, remove, refresh, setError };
}

// The games of a PGN database, with their tags (for the interesting-wins list)
export function splitPgn(text) {
    if (!text) return [];
    return text
        .replace(/\r/g, '')
        // a game ends with its moves; the next one starts with a tag line after a blank line
        .split(/\n\s*\n(?=\[)/)
        .map((g) => g.trim())
        .filter((g) => /\[White /.test(g))
        .map((pgn) => {
            const tag = (t) => (pgn.match(new RegExp(`\\[${t} "([^"]*)"\\]`)) || [])[1] || '';
            const plies = parseInt(tag('PlyCount'), 10);
            const moveCount = Number.isFinite(plies) ? Math.ceil(plies / 2) : null;
            return { pgn, white: tag('White'), black: tag('Black'), result: tag('Result'), annotator: tag('Annotator').replace(/^EAS-Tool:\s*/, ''), moves: moveCount, event: tag('Event'), round: tag('Round') };
        });
}

export const EAS_CREDIT = 'EAS Tool V6.0 by Stefan Pohl (www.sp-cc.de). Uses pgn-extract by David J. Barnes and PGN tools by Norman Pollock.';
export const SPCC_URL = 'https://www.sp-cc.de';
