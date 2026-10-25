import React, { useState, useEffect, useRef } from 'react';
import { Twitch, MessageSquare, Trophy, Activity, Zap } from 'lucide-react';
import tmi from 'tmi.js';
import { Arena } from './Arena';
import { ChessBoard } from './ChessBoard';
import { EvalBar } from './EvalBar';
import { Chess } from 'chess.js';

// --- TwitchSidebar Component ---
export function TwitchSidebar({ active, onConnect, chatMessages, isConnected, connectionStatus }) {
    if (!active) return null;

    const [channel, setChannel] = useState('');

    const handleConnect = (e) => {
        e.preventDefault();
        onConnect(channel);
    };

    return (
        <div className="flex flex-col h-full bg-card border-t lg:border-t-0 lg:border-l border-white/5 w-full lg:w-80 shrink-0">
            {/* Header / Connection */}
            <div className="p-4 border-b border-white/5 bg-black/20">
                <div className="flex items-center gap-2 mb-4 text-purple-400 font-bold">
                    <Twitch size={18} />
                    <span>Bot Integration</span>
                </div>

                {!isConnected ? (
                    <form onSubmit={handleConnect} className="flex gap-2">
                        <input
                            type="text"
                            value={channel}
                            onChange={(e) => setChannel(e.target.value)}
                            placeholder="Twitch Channel..."
                            className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-purple-500/50 transition-colors"
                        />
                        <button
                            type="submit"
                            className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
                            disabled={connectionStatus === 'connecting'}
                        >
                            {connectionStatus === 'connecting' ? '...' : 'Link'}
                        </button>
                    </form>
                ) : (
                    <div className="flex justify-between items-center text-xs font-mono">
                        <span className="text-green-400 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                            Linked: {channel}
                        </span>
                        <button onClick={() => onConnect(null)} className="text-muted-foreground hover:text-white underline">Unlink</button>
                    </div>
                )}
            </div>

            {/* Chat Feed */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-xs scrollbar-hide">
                {chatMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground/30 gap-2">
                        <MessageSquare size={24} />
                        <p>Chat feed silent...</p>
                    </div>
                ) : (
                    chatMessages.map((msg, i) => (
                        <div key={i} className="break-words leading-relaxed animate-fade-in">
                            <span style={{ color: msg.color || '#a855f7' }} className="font-bold mr-2">{msg.username}:</span>
                            <span className="text-foreground/80">{msg.message}</span>
                        </div>
                    ))
                )}
            </div>
            {isConnected && (
                <div className="p-2 border-t border-white/5 text-[10px] text-center text-muted-foreground uppercase tracking-widest bg-black/20">
                    Listening to Chat
                </div>
            )}
        </div>
    );
}

// --- Twitch Mode Dashboard ---
export function TwitchDashboard() {
    // Connection State
    const [client, setClient] = useState(null);
    const [messages, setMessages] = useState([]);
    const [status, setStatus] = useState('disconnected');
    const [channelName, setChannelName] = useState('');

    // Game Mode State: 'setup' or 'watch-party' (Simplified)
    const [mode, setMode] = useState('setup');
    const [gameConfig, setGameConfig] = useState(null);

    // Engines Scan State
    const [engines, setEngines] = useState([]);
    const [scanning, setScanning] = useState(true);

    useEffect(() => {
        if (window.electronAPI) {
            window.electronAPI.scanEngines().then(found => {
                setEngines(found);
                setScanning(false);
            });
        }
    }, []);

    const connectTwitch = async (channel) => {
        if (!channel) {
            if (client) client.disconnect();
            setClient(null);
            setStatus('disconnected');
            return;
        }

        setStatus('connecting');
        const tmiClient = new tmi.Client({
            connection: { secure: true, reconnect: true },
            channels: [channel]
        });

        tmiClient.on('message', (chan, tags, message, self) => {
            if (self) return;

            setMessages(prev => [...prev.slice(-49), {
                username: tags['display-name'] || tags.username,
                message: message,
                color: tags.color
            }]);
        });

        try {
            await tmiClient.connect();
            setClient(tmiClient);
            setChannelName(channel);
            setStatus('connected');
        } catch (err) {
            console.error(err);
            setStatus('error');
        }
    };

    return (
        <div className="flex flex-col lg:flex-row h-full w-full lg:overflow-hidden overflow-y-auto">
            {/* Main Game Area */}
            <div className="flex-1 flex flex-col relative overflow-hidden">
                {mode === 'setup' ? (
                    <TwitchSetupMenu
                        onStart={(config) => {
                            setGameConfig(config);
                            setMode('watch-party');
                        }}
                        isConnected={status === 'connected'}
                        engines={engines}
                        scanning={scanning}
                    />
                ) : (
                    <TwitchArena
                        config={gameConfig}
                        onExit={() => setMode('setup')}
                        channelName={channelName}
                        engines={engines}
                    />
                )}
            </div>

            {/* Sidebar with Chat */}
            <TwitchSidebar
                active={true}
                onConnect={connectTwitch}
                chatMessages={messages}
                isConnected={status === 'connected'}
                connectionStatus={status}
            />
        </div>
    );
}

function TwitchSetupMenu({ onStart, isConnected, engines, scanning }) {
    const [books, setBooks] = useState([]);
    const [selectedBook, setSelectedBook] = useState('');

    useEffect(() => {
        if (window.electronAPI) {
            window.electronAPI.scanBooks().then(found => {
                setBooks(found);
            });
        }
    }, []);

    const handleStart = () => {
        // Auto-select top 2 available engines
        if (engines.length < 1) return; // Should handle this UI case

        const e1 = engines[0];
        const e2 = engines.length > 1 ? engines[1] : engines[0]; // Fallback if only 1 engine

        const config = {
            whitePath: e1.path,
            blackPath: e2.path,
            settings: {
                initial: 60000, // 1 min bullet/blitz feel for stream
                inc: 0,
                whiteBook: selectedBook || null,
                blackBook: selectedBook || null
            }
        };

        onStart(config);
    };

    return (
        <div className="flex flex-col items-center justify-center h-full p-12 gap-8 animate-fade-in relative z-10">
            <div className="text-center space-y-2">
                <h2 className="text-5xl font-black text-foreground tracking-tighter uppercase relative">
                    <span className="text-purple-500">Stream</span> Arena
                </h2>
                <p className="text-muted-foreground text-lg">Automated Engine Tournaments for your Stream</p>
            </div>

            <div className="bg-card/50 border border-white/5 rounded-2xl p-8 max-w-lg w-full backdrop-blur flex flex-col gap-6 text-center shadow-2xl">
                <div className="flex flex-col items-center gap-4 py-4">
                    <div className="p-4 bg-purple-500/20 text-purple-400 rounded-full animate-pulse-slow">
                        <Trophy size={48} />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-white mb-1">Watch Party Mode</h3>
                        <p className="text-sm text-muted-foreground">Infinite "Winner Stays On" loop.<br />Engines rotate automatically.</p>
                    </div>
                </div>

                {!isConnected && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-200 rounded-lg text-sm flex items-center justify-center gap-2">
                        Link Twitch Channel in Sidebar to Start
                    </div>
                )}

                {isConnected && engines.length === 0 && !scanning && (
                    <div className="p-3 bg-orange-500/10 border border-orange-500/20 text-orange-200 rounded-lg text-sm">
                        No engines found. Please add engines in "Engines" tab.
                    </div>
                )}

                {isConnected && engines.length > 0 && (
                    <div className="text-left space-y-1">
                        <label className="text-xs text-muted-foreground uppercase tracking-wider block font-bold">Opening Book (Polyglot .bin)</label>
                        <select
                            value={selectedBook}
                            onChange={(e) => setSelectedBook(e.target.value)}
                            className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm focus:border-purple-500 outline-none text-foreground"
                        >
                            <option value="">No Opening Book (None)</option>
                            {books.map(bk => (
                                <option key={bk.path} value={bk.path}>{bk.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                <button
                    disabled={!isConnected || engines.length === 0}
                    onClick={handleStart}
                    className="w-full py-4 bg-white text-black font-black text-xl rounded-xl hover:scale-[1.02] transition-all shadow-xl shadow-white/10 disabled:opacity-50 disabled:hover:scale-100 uppercase tracking-widest"
                >
                    Start Watch Party
                </button>

                {engines.length > 0 && <div className="text-xs font-mono text-muted-foreground">{engines.length} engines ready to play</div>}
            </div>
        </div>
    )
}

function TwitchArena({ config, onExit, channelName, engines }) {
    const [matchKey, setMatchKey] = useState(0);
    const [currentConfig, setCurrentConfig] = useState(config);
    const [wins, setWins] = useState({}); // Track wins for "Winner Stays On" stats?
    const [challengerIndex, setChallengerIndex] = useState(1); // Start with second engine (index 1) as black

    const handleExitGame = () => {
        console.log("TwitchArena: handleExitGame called");
        if (window.electronAPI && typeof window.electronAPI.stopMatch === 'function') {
            console.log("TwitchArena: stopping match via electronAPI");
            window.electronAPI.stopMatch();
        } else {
            console.warn("TwitchArena: electronAPI.stopMatch is not available");
        }

        if (typeof onExit === 'function') {
            console.log("TwitchArena: calling onExit callback");
            onExit();
        } else {
            console.error("TwitchArena: onExit prop is not a function", onExit);
        }
    };

    useEffect(() => {
        if (!window.electronAPI) return;
        const cleanup = window.electronAPI.on('match-ended', (data) => {
            // 5 second delay then next match
            setTimeout(() => {
                let winnerPath = currentConfig.whitePath;
                if (data.winner === 'black') winnerPath = currentConfig.blackPath;

                // Defender stays as White
                const nextWhite = winnerPath;

                // Pick next challenger sequentially
                let nextIdx = challengerIndex;
                if (engines && engines.length > 0) {
                    nextIdx = (challengerIndex + 1) % engines.length;
                    // If the next challenger is the same as the defender, skip it
                    if (engines[nextIdx]?.path === nextWhite) {
                        nextIdx = (nextIdx + 1) % engines.length;
                    }
                    setChallengerIndex(nextIdx);
                }

                const nextBlack = (engines && engines[nextIdx]) ? engines[nextIdx].path : nextWhite;

                setCurrentConfig({
                    ...currentConfig,
                    whitePath: nextWhite,
                    blackPath: nextBlack
                });
                setMatchKey(k => k + 1);
            }, 5000);
        });
        return cleanup;
    }, [currentConfig, engines, challengerIndex]);

    const matchParams = {
        whitePath: currentConfig.whitePath,
        blackPath: currentConfig.blackPath,
        settings: currentConfig.settings
    };

    return (
        <div className="flex-1 flex flex-col bg-black/50 min-h-0">
            <div className="h-16 bg-gradient-to-b from-black/80 to-transparent flex items-center justify-between px-6 shrink-0 z-40 border-b border-white/5">
                <button
                    onClick={handleExitGame}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-bold uppercase tracking-wider backdrop-blur transition-colors hover:text-white text-muted-foreground border border-white/5 cursor-pointer"
                >
                    Back to Menu
                </button>

                <div className="flex items-center gap-2">
                    <Twitch size={16} className="text-purple-500 animate-pulse" />
                    <span className="font-bold text-sm tracking-widest uppercase text-white/80">
                        Watch Party Live
                    </span>
                </div>

                <div className="text-xs font-mono text-purple-400">ON AIR: {channelName}</div>
            </div>

            <div className="flex-1 flex items-center justify-center p-4 min-h-0">
                <div className="relative shadow-2xl shadow-black/50 rounded-lg overflow-hidden border border-white/10 flex-1 h-full max-w-[1400px] min-h-0">
                    <Arena
                        key={matchKey}
                        matchParams={matchParams}
                        onBack={handleExitGame}
                        shouldStart={true}
                        isTournament={false}
                        isTwitch={true}
                        // Show both panels for Watch Party
                        hideWhitePanel={false}
                        hideBlackPanel={false}
                    />
                </div>
            </div>
        </div>
    );
}
