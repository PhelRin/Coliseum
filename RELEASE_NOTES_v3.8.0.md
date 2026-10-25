## Coliseum v3.8.0

Coliseum is now a proper engine-testing tool: SPRT tests, adjudication, fixed depth and node limits, opening suites from EPD and PGN files, WinBoard engines, and a Linux version.

### New: SPRT testing
Find out whether a new build of your engine is really stronger, the way Fishtest and OpenBench do it.
- **New format:** pick **SPRT Test** in the tournament lobby, choose the new engine and the base engine, and Coliseum plays game pairs (same opening, colours swapped) until the test decides.
- **Your bounds:** set Elo0, Elo1, alpha and beta, or use a preset: gain [0, 5], big gain [0, 10] or no regression [-5, 0]. A game limit stops tests that never decide.
- **Live results:** the log-likelihood ratio between its two bounds, the Elo difference with a 95% range, the likelihood of superiority, W/D/L and the game-pair counts (pentanomial).
- **Clear verdict:** "H1 accepted" means the new engine is stronger; "H0 accepted" means it isn't. Games still running when the test decides are stopped and not counted.

### New: adjudication
Games that are already decided no longer have to be played out to mate.
- **Resign:** both engines agree one side is losing by at least a set score for a set number of moves.
- **Draw:** after a set move, both engines' scores stay close to 0 for a set number of moves.
- **Move limit:** a game that runs past a set length is a draw.
- **Where:** adjudication works in tournaments, SPRT tests and Elo estimation, and is marked as "adjudication" in the PGN.

### New: search limits
Besides a clock, games can now use a fixed **time per move**, a fixed **search depth** or a fixed **number of nodes**. Fixed nodes make results independent of how busy your PC is.

### New: opening suites from EPD and PGN files
- **Any suite:** use EPD position files or PGN files (like the 8-move or UHO suites), in tournaments, SPRT tests and Elo estimation.
- **Pairs:** each opening is played twice, once with each engine as White.
- **Options:** play them in file order or shuffled, and choose how many moves of each PGN line to play.
- **Checked first:** Coliseum counts the openings when you pick the file, so a broken file shows up before the start.

### New: WinBoard engines
- **Detected automatically:** Coliseum now supports WinBoard (xboard / CECP) engines as well as UCI. It asks each engine which protocol it speaks, and you can also set the protocol by hand in the engine's settings.
- **Options:** WinBoard engines' own options show up in Configure, like UCI options do.
- **What works:** WinBoard engines play in tournaments, SPRT tests, Elo estimation, Quick Match and Play. Analysis, Game Review and the Tactics Trainer still need a UCI engine.

### New: Linux version
- **Downloads:** Coliseum now runs on Linux too, as an AppImage or a .deb package. AggroChess and Stockfish 17.1 come with it.
- **Your files:** engines and books you add on Linux are kept in `~/.config/coliseum`.
- **Updates:** the Linux version updates itself from GitHub, just like the Windows one.
