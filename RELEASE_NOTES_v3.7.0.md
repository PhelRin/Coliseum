## Coliseum v3.7.0

Coliseum is now easier to use if you just want to play or train, not only test engines.

### New: Play tab
Play against AggroChess in two clicks. AggroChess comes with Coliseum and plays aggressive, sacrificial chess in the spirit of Mikhail Tal.
- **Quick setup:** choose White, Black or Random, and a time control from bullet to classical (or no clock).
- **Custom positions:** paste a FEN to start from any position.
- **Any engine:** switch to any other installed engine if you want a different opponent.
- **Clean board:** no engine arrows or evaluation bar while you play, so nothing gives the engine's plans away.
- **Review:** when the game ends, open it straight in Game Review.

### New: puzzles from your own games
The Tactics Trainer can now build puzzles from your Chess.com or Lichess games.
- **No login:** type your username, choose your last 25, 50 or 100 games, and Coliseum fetches them from the site's public archive.
- **Your moves only:** puzzles come from positions where you were to move: wins you missed, blunders you didn't punish, and mates you didn't find.
- **Your words:** puzzle descriptions say what you played, and a link opens the original game online.
- **Standard chess only:** Chess960 and other variants are skipped.

### Tactics Trainer, reorganised
- **Three sources:** pick where puzzles come from (Engine Tournaments, My Games or a PGN File) at the top of the generator.
- **Past tournaments:** finished and stopped tournaments are now kept automatically, so you can turn any of them into puzzles without exporting files. Tournaments played before 3.7 can still be loaded as PGN files.
- **Library filter:** show all puzzles, only engine-game puzzles, or only puzzles from your own games.
- **Better default:** Stockfish is picked as the analysis engine when it's installed.

### Estimated Elo in Game Review
Game Review now shows an estimated Elo for each player, worked out from how accurately they played, with a ± range that is wider for short games. It's a rough guide from a single game, not a rating.

### Fixes
- **Frozen clocks:** in rare cases an engine that ran over its time could freeze its clock, show ∞, and never lose on time, stalling a tournament. Fixed.
- **Narrow windows:** the Tactics Trainer's results could be pushed off-screen on smaller windows. Fixed.
- **Portrait windows:** live tournament boards now stack instead of shrinking the other games to tiny boards.
- **Game Review header:** the result badge is no longer squashed by long player names.
- **Wording:** "1 games at once" now reads "1 game at once".
- **Proxies:** online features follow your system's proxy settings.
