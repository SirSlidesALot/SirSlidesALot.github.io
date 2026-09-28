# SirSlidesALot Realmaps

The landing page for the Realmaps project: a globe with every map at its real
location and its true footprint. Clicking a map opens its sheet with facts and
screenshots. Served by GitHub Pages at <https://sirslidesalot.github.io>.

A static site with no build step: `index.html`, `assets/`, `data/maps.json` and
`maps/<id>/*.jpg`.

## Updating it

The facts and images are exported from the map build, never typed by hand:

```
py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip install pillow pyproj
.venv/Scripts/python.exe tools/export_showcase.py
```

`tools/showcase.json` is the part chosen by hand: which maps and candidates
appear, their status, pitch and screenshots. The exporter reads each map's
config and build parameters (true map square, elevation, events count) from the
map worktrees, resizes the chosen stills and writes `data/maps.json`.

Preview locally with `.venv/Scripts/python.exe -m http.server 8765` and open
<http://127.0.0.1:8765>. A deep link to one map is `#<id>`, e.g. `#thasos_island`.

Credits for the data behind the screenshots are in [CREDITS.md](CREDITS.md).
