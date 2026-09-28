"""Export the realmaps showcase into this site: data/maps.json and maps/<id>/*.jpg.

Reads the realmaps worktrees (never writes to them): each map's config for its
title and site, its graded params for the true map square and elevation range,
its level folder for the event count, and the stills named in showcase.json.

    .venv/Scripts/python.exe tools/export_showcase.py [--clones DIR]
"""
import argparse
import json
import shutil
import tomllib
from pathlib import Path

from PIL import Image
from pyproj import CRS, Transformer

SITE = Path(__file__).resolve().parent.parent
FULL_W, THUMB_W = 1600, 480


def utm_crs(lat, lon):
    zone = int((lon + 180) // 6) + 1
    return CRS.from_epsg((32600 if lat >= 0 else 32700) + zone)


def footprint(params, site):
    """The map square as a lon/lat ring, from the build's own UTM bounds."""
    if params:
        crs = CRS.from_user_input(params["crs_metric"])
        x0, y0, x1, y1 = params["bounds_utm"]
    else:  # not built yet: the square the config asks for, in its UTM zone
        crs = utm_crs(site["lat"], site["lon"])
        half = site["square_size_m"] * site["grid_px"] / 2
        cx, cy = Transformer.from_crs(4326, crs, always_xy=True).transform(site["lon"], site["lat"])
        x0, y0, x1, y1 = cx - half, cy - half, cx + half, cy + half
    to_ll = Transformer.from_crs(crs, 4326, always_xy=True)
    ring = []
    for (ax, ay), (bx, by) in [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)),
                               ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]:
        for i in range(8):  # densify so the edges follow the grid lines on the globe
            t = i / 8
            ring.append([round(v, 6) for v in to_ll.transform(ax + (bx - ax) * t, ay + (by - ay) * t)])
    ring.append(ring[0])
    # d3-geo (under globe.gl) reads a counter-clockwise ring as the whole Earth
    # MINUS the square, the opposite of RFC 7946; clockwise is the square itself.
    return ring[::-1]


def count_events(level_dir, name):
    root = level_dir / "gameplay" / "missions" / name
    if not root.is_dir():
        return 0
    return sum(1 for p in root.glob("*/*/info.json"))


def export_image(src, dst_dir, stem):
    im = Image.open(src).convert("RGB")
    for width, suffix, q in ((FULL_W, "", 84), (THUMB_W, "_t", 78)):
        out = im.copy()
        if out.width > width:
            out = out.resize((width, round(out.height * width / out.width)), Image.LANCZOS)
        out.save(dst_dir / f"{stem}{suffix}.jpg", quality=q, optimize=True, progressive=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--clones", default=str(SITE.parent),
                    help="folder holding the realmaps worktrees (default: the one holding this site)")
    ap.add_argument("--no-images", action="store_true", help="refresh data only")
    a = ap.parse_args()
    clones = Path(a.clones)
    spec = json.loads((SITE / "tools" / "showcase.json").read_text(encoding="utf-8"))

    maps = []
    for m in spec["maps"]:
        tree = clones / m["tree"]
        cfg = tomllib.loads((tree / m["config"]).read_text(encoding="utf-8"))
        site = cfg["site"]
        params = None
        if m.get("params") and (tree / m["params"]).is_file():
            params = json.loads((tree / m["params"]).read_text(encoding="utf-8"))
        extent_km = site["square_size_m"] * site["grid_px"] / 1000
        rec = {
            "id": m["id"],
            "title": cfg.get("title", m["id"]),
            "region": m["region"],
            "status": m["status"],
            "pitch": m["pitch"],
            "sources": m["sources"],
            "lat": site["lat"], "lon": site["lon"],
            "extent_km": round(extent_km, 2),
            "cell_m": site["square_size_m"],
            "footprint": footprint(params, site),
            "events": count_events(tree / "map" / m.get("level", m["id"]), m.get("level", m["id"])),
            "images": [],
        }
        if params:
            # The build carves seabeds and lake beds below the water, so the
            # terrain minimum is not real ground: start from the water level.
            lake = params.get("lake") or {}
            low = params["elevation"]["min_m"]
            if lake.get("level_m") is not None:
                low = max(low, lake["level_m"])
                rec["water_m"] = round(lake["level_m"], 1)
            rec["elev_min_m"] = round(low)
            rec["elev_max_m"] = round(params["elevation"]["max_m"])
        dst = SITE / "maps" / m["id"]
        if not a.no_images:
            if dst.exists():
                shutil.rmtree(dst)  # a still dropped from showcase.json must not linger
            dst.mkdir(parents=True, exist_ok=True)
        for i, img in enumerate(m["images"], 1):
            stem = f"{i:02d}"
            if not a.no_images:
                export_image(clones / img["src"], dst, stem)
            rec["images"].append({"full": f"maps/{m['id']}/{stem}.jpg",
                                  "thumb": f"maps/{m['id']}/{stem}_t.jpg",
                                  "caption": img["caption"]})
        maps.append(rec)
        print(f"{m['id']:14s} {extent_km:6.2f} km  events {rec['events']:3d}  images {len(m['images'])}")

    out = {"maps": maps, "candidates": spec["candidates"]}
    (SITE / "data").mkdir(exist_ok=True)
    (SITE / "data" / "maps.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print("wrote data/maps.json")


if __name__ == "__main__":
    main()
