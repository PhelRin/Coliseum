## Coliseum v4.0.4

### Fixed
- **Linked engines run from their own folder.** Until now a linked engine was played as a copy of its .exe kept in Coliseum's data folder. Engines that look for their files next to themselves could not find them there. Lc0 looks for its network beside its own .exe: as a copy it started, reported ready, then never moved while its clock ran down. Adapters that start an emulator or another engine beside them, and engines that check a licence there, are affected in the same way. A linked engine is now started exactly where it is installed.
- **An engine that says why it can't play is shown in the match log.** Lc0 prints "error" and the reason when it has no network, then waits. That line used to be ignored, so the game just hung.
- **Only the engine that crashed is blamed.** When one engine stopped while starting, the message also said its opponent "did not answer within 30 s", although the opponent was simply not ready yet. The message now also says which file was started.

### New
- **"Run a copy" in a linked engine's settings**, for engines you are building. With it on, Coliseum plays with a copy of the file, so you can rebuild the engine while a game or tournament is using it (Windows locks a running .exe). It is off for newly linked engines. Engines in copy mode show "Linked · copy" in the engine list.

### Engines linked with earlier versions
An engine that was rebuilt while it was linked keeps running as a copy, as before. Every other linked engine now runs from its own folder. You can change either in the engine's settings.
