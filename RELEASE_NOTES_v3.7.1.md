## Coliseum v3.7.1

### New: link engines by path
You can now use an engine from wherever it lives, for example your own build folder, without copying it into Coliseum's engines folder.

- **Add engine by path:** a new button in Local Engines. Pick one or more engine files and they appear in every engine list, marked **Linked**.
- **Drag and drop asks first:** when you drop an engine (or a folder of engines) on the window, Coliseum asks whether to **Link it** where it is or **Copy it** into the engines folder, like before.
- **Rebuild any time:** Coliseum runs a private copy of a linked engine, never the file itself, so Windows won't lock your .exe and your compiler can overwrite it while Coliseum is open. The next game picks up your newest build automatically.
- **Tournaments stay fair:** a tournament or Elo estimation run keeps the build it started with for every game, even if you rebuild halfway through. Resuming a tournament later continues with that same build.
- **Nets and books still work:** a linked engine runs with its own folder as its working directory, so files next to it (NNUE nets, configs) are found as usual.
- **Moved or deleted files:** a linked engine whose file is gone shows **Not found**, with **Relink** (point it at the new location and keep its rating, history and saved options) and **Remove**.
- **Unlink is safe:** removing a linked engine only removes the link. The file itself is never deleted.
