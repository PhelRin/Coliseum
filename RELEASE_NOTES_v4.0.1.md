## Coliseum v4.0.1

### Fixed
- **Commercial engines that wouldn't start** (Houdini 6, Deep Shredder 13 and similar) now work again. Engines added by path run as a copy, so you can rebuild an engine while Coliseum plays with it. Some commercial engines check their licence against the location of their own .exe, so the copy sat there silently until "Engine startup timeout (uciok/readyok)".
  - Coliseum now notices: when the copy doesn't answer but the original does, it runs that engine from its own folder from then on.
  - It switches over without you doing anything. The game that hit the problem is started again, and a note appears in the game log.
  - If you later relink the engine or put a new build in its place, Coliseum tries the copy again.
- **Faster engine checks:** when Coliseum asks a new engine which protocol it speaks, it now waits for that test run to close before starting the engine for real. Engines that only allow one copy of themselves to run, or that lock files next to them, no longer collide with their own test run.
