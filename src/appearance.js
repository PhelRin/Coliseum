// App appearance: colour theme, board colours and piece set.
//
// "Coliseum" is the default: warm travertine stone and bronze, after the real Colosseum,
// with a stone board and classic white/black pieces. "Matrix" is the original green look.
// Boards and pieces can be mixed freely; the piece sets tell pieces apart by light and dark
// (not by red and green), so they work for colour-blind players too.

import { useSyncExternalStore } from 'react';

export const THEMES = {
    coliseum: {
        label: 'Coliseum',
        sub: 'Travertine and bronze',
        board: 'travertine',
        pieces: 'classic',
        swatch: ['#16120e', '#c99a4b', '#e8dcc5'],
        vars: {
            '--background': '28 18% 5%',
            '--foreground': '38 35% 91%',
            '--card': '28 15% 9%',
            '--card-foreground': '38 35% 91%',
            '--popover': '28 15% 9%',
            '--popover-foreground': '38 35% 91%',
            '--primary': '37 56% 55%',
            '--primary-2': '20 52% 42%',
            '--primary-foreground': '28 30% 8%',
            '--secondary': '28 12% 13%',
            '--secondary-foreground': '38 35% 91%',
            '--muted': '28 12% 13%',
            '--muted-foreground': '34 14% 63%',
            '--accent': '28 12% 16%',
            '--accent-foreground': '37 56% 55%',
            '--destructive': '4 60% 36%',
            '--destructive-foreground': '0 0% 100%',
            '--border': '28 12% 17%',
            '--input': '28 12% 17%',
            '--ring': '37 56% 55%',
        },
    },
    matrix: {
        label: 'Matrix',
        sub: 'The original neon green',
        board: 'matrix',
        pieces: 'matrix',
        swatch: ['#050505', '#4ade80', '#14532d'],
        vars: {
            '--background': '0 0% 2%',
            '--foreground': '140 20% 95%',
            '--card': '0 0% 7%',
            '--card-foreground': '140 20% 95%',
            '--popover': '0 0% 7%',
            '--popover-foreground': '140 20% 95%',
            '--primary': '142 71% 58%',
            '--primary-2': '142 76% 36%',
            '--primary-foreground': '0 0% 5%',
            '--secondary': '0 0% 12%',
            '--secondary-foreground': '140 20% 95%',
            '--muted': '0 0% 12%',
            '--muted-foreground': '140 10% 60%',
            '--accent': '0 0% 15%',
            '--accent-foreground': '142 71% 58%',
            '--destructive': '0 62% 30%',
            '--destructive-foreground': '0 0% 100%',
            '--border': '0 0% 15%',
            '--input': '0 0% 15%',
            '--ring': '142 71% 58%',
        },
    },
};

// light / dark squares, and the coordinate colour on each
export const BOARDS = {
    travertine: { label: 'Travertine', light: '#e8dcc5', dark: '#b39470', coordLight: '#8a6f50', coordDark: '#efe4d0' },
    marble: { label: 'Marble', light: '#ecebe6', dark: '#8f9aa3', coordLight: '#6f7a83', coordDark: '#f1f0ec' },
    wood: { label: 'Wood', light: '#f0d9b5', dark: '#b58863', coordLight: '#946f51', coordDark: '#f0d9b5' },
    slate: { label: 'Slate blue', light: '#dee3e6', dark: '#7b96a8', coordLight: '#5f7a8c', coordDark: '#e6ebee' },
    matrix: { label: 'Matrix', light: '#14532d', dark: '#27272a', coordLight: '#71717a', coordDark: '#71717a' },
};

// piece colours: fill, outline and inner lines for each side
export const PIECE_SETS = {
    classic: {
        label: 'Classic',
        w: { fill: '#fbfaf7', stroke: '#1b1712', detail: '#1b1712' },
        b: { fill: '#26211c', stroke: '#0d0b09', detail: '#e9e2d6' },
    },
    bronze: {
        label: 'Ivory & bronze',
        w: { fill: '#f6efe0', stroke: '#2a2118', detail: '#2a2118' },
        b: { fill: '#7a4f2a', stroke: '#1f150c', detail: '#f1dcc0' },
    },
    matrix: {
        label: 'Matrix red',
        w: { fill: '#ffffff', stroke: '#000000', detail: '#000000' },
        b: { fill: '#ef4444', stroke: '#000000', detail: '#000000' },
    },
};

const KEY = 'appearance';
const DEFAULT = { theme: 'coliseum', board: THEMES.coliseum.board, pieces: THEMES.coliseum.pieces };

let current = loadLocal();
const listeners = new Set();

function valid(a) {
    const theme = THEMES[a && a.theme] ? a.theme : DEFAULT.theme;
    return {
        theme,
        board: BOARDS[a && a.board] ? a.board : THEMES[theme].board,
        pieces: PIECE_SETS[a && a.pieces] ? a.pieces : THEMES[theme].pieces,
    };
}

function loadLocal() {
    try {
        return valid(JSON.parse(localStorage.getItem(KEY) || 'null') || DEFAULT);
    } catch (e) {
        return { ...DEFAULT };
    }
}

function applyTheme() {
    const t = THEMES[current.theme] || THEMES.coliseum;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
    root.dataset.theme = current.theme;
}

export function getAppearance() {
    return current;
}

export function setAppearance(patch) {
    let next = { ...current, ...patch };
    // picking a theme also picks its board and pieces (they can be changed afterwards)
    if (patch.theme && patch.theme !== current.theme && !patch.board && !patch.pieces) {
        next = { ...next, board: THEMES[patch.theme].board, pieces: THEMES[patch.theme].pieces };
    }
    current = valid(next);
    applyTheme();
    try {
        localStorage.setItem(KEY, JSON.stringify(current));
    } catch (e) { /* not available */ }
    if (window.electronAPI && window.electronAPI.setStore) window.electronAPI.setStore(KEY, current).catch(() => {});
    listeners.forEach((l) => l());
}

// on start: apply what this window remembers, then what the app store has (shared by windows)
export function initAppearance() {
    applyTheme();
    if (window.electronAPI && window.electronAPI.getStore) {
        window.electronAPI.getStore(KEY).then((saved) => {
            if (saved && JSON.stringify(valid(saved)) !== JSON.stringify(current)) {
                current = valid(saved);
                applyTheme();
                try {
                    localStorage.setItem(KEY, JSON.stringify(current));
                } catch (e) { /* not available */ }
                listeners.forEach((l) => l());
            }
        }).catch(() => {});
    }
}

const subscribe = (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
};

export function useAppearance() {
    return useSyncExternalStore(subscribe, getAppearance);
}
