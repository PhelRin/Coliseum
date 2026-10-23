# Coliseum

Coliseum is a chess engine GUI built to host, manage, and watch chess engine tournaments. It is designed to be much simpler and easier to use than legacy tools like Arena Chess GUI.

If you want to test engines, run automated tournaments, measure how strong an engine really is, or analyze games without dealing with clunky layouts and outdated configuration menus, Coliseum is a modern alternative.

## Features

### Engine Tournaments
Run automated tournaments between any number of UCI chess engines. Every tournament is played in **matches**: two games from the same opening, one with each engine as White, so neither engine gets the luckier colour or opening.

- **Gauntlet**: one main engine plays every opponent as many matches as you choose. For example, 2 opponents x 1 match = 2 matches = 4 games. Ideal for testing a new version of your engine against a field.
- **Round Robin**: everyone plays everyone, with a full standings table and cross table.
- **Swiss**: a set number of rounds, pairing engines on similar scores without rematches. Ties are split by Buchholz, then Sonneborn-Berger.
- **Knockout** and **Double Knockout**: a level match goes to two more 2-game tiebreaks, then sudden-death games, so a draw never decides who goes through.

Choose bullet, blitz, rapid or a custom time control, and start games from a built-in set of 50 balanced openings, your own Polyglot opening book, or the normal starting position. Several games can run at once (Coliseum suggests a safe number for your CPU). Unfinished tournaments can be resumed later, and the whole event exports as one PGN with full headers.

### Results You Can Read
Gauntlets show the main engine's score, its Elo difference against each opponent with an error margin, and a performance rating. Round robins and Swiss events get standings with tiebreaks, and knockouts get a live bracket.

### Elo Estimation
Pick some engines and let them play each other non-stop. Their ratings are worked out from every game they have played, with a ± range that narrows as more games come in, a chart of how the ratings moved, and an optional anchor (fix one engine you know the strength of, and the rest are measured against it).

### Live Games
Watch engine games live with each engine's name, rating, clock and evaluation. When several games run at once you can see them all, and click any one to follow it on the big board. The layout adjusts to your window size.

### Quick Match
Play a single game between two engines, or play against an engine yourself. Finished games are saved to the Archive, where you can search them and export PGNs.

### UCI Engine Management
Import any UCI engine by dropping it into the app, tweak its options, and save custom configurations. Coliseum keeps a career record for every engine: wins, draws, losses, results as White and Black, and its rating over time.

### Game Review & Analysis
Review any game with an engine: accuracy scores, an evaluation graph you can click to jump through the game, key moments, and a classification for every move (Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder). Weak moves show the engine's best alternative on the board, and live analysis shows the top three engine lines.

### Board Editor
Set up any position, choose the side to move and castling rights, and send it straight to analysis.

### Tactics Trainer
Scan your tournament PGN files to find forced checkmates, blunder refutations, and missed tactics. Every puzzle is checked by the engine so the solution really works, and the trainer tracks your solved puzzles, success rate and streaks.

### Twitch Watch Party
Connect your Twitch channel and run a non-stop "Winner Stays On" engine tournament for your stream.

### Audio Feedback
Simple sound effects for moves, captures, check, and game end.

## Installation

1. Download the setup.exe file.
2. Run the setup.exe.
3. Coliseum should open automatically. If not, you'll find the shortcut on your desktop.

You may also find the Coliseum folder in your AppData.

Coliseum checks for updates by itself. When a new version is out it downloads in the background, and you can install it with one click when it's ready.
