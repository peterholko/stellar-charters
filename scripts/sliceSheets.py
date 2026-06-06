#!/usr/bin/env python3
"""Slice the transparent-background icon/emblem sprite sheets into individual PNGs.

We don't divide the sheet into an even grid (the AI layout isn't pixel-perfect).
Instead we project the alpha channel: rows/columns whose total opacity is ~0 are
the transparent gutters between icons. We split on those gutters — first into
horizontal bands (rows), then each band into vertical bands (columns) — which
naturally handles the ragged action sheet (3 icons on top, 2 on the bottom).
Each detected cell is then tightly cropped to its own content bbox.
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# alpha sum threshold (fraction of max) below which a row/col counts as "empty gutter"
GUTTER = 0.003
# ignore content runs thinner than this many px (stray antialiasing specks)
MIN_RUN = 12


def bands(values, limit):
    """Return (start, end) runs where value > limit*max, skipping tiny runs."""
    thresh = limit * (max(values) or 1)
    runs, start = [], None
    for i, v in enumerate(values):
        if v > thresh and start is None:
            start = i
        elif v <= thresh and start is not None:
            if i - start >= MIN_RUN:
                runs.append((start, i))
            start = None
    if start is not None and len(values) - start >= MIN_RUN:
        runs.append((start, len(values)))
    return runs


def col_alpha(img):
    a = img.getchannel("A")
    w, h = img.size
    px = a.load()
    return [sum(px[x, y] for y in range(h)) for x in range(w)]


def row_alpha(img):
    a = img.getchannel("A")
    w, h = img.size
    px = a.load()
    return [sum(px[x, y] for x in range(w)) for y in range(h)]


def slice_sheet(path):
    """Yield cropped icon images in reading order (top→bottom, left→right)."""
    img = Image.open(path).convert("RGBA")
    cells = []
    for (y0, y1) in bands(row_alpha(img), GUTTER):
        strip = img.crop((0, y0, img.width, y1))
        for (x0, x1) in bands(col_alpha(strip), GUTTER):
            cell = strip.crop((x0, 0, x1, strip.height))
            cells.append(cell.crop(cell.getbbox()))  # tight-trim each icon
    return cells


SHEETS = {
    "assets/D-ui-and-icons/resource-icons-sheet.png": (
        "assets/D-ui-and-icons/icons",
        ["resource-ice", "resource-metals", "resource-helium3",
         "resource-isotopes", "resource-food", "resource-credits"],
    ),
    "assets/D-ui-and-icons/action-icons-sheet.png": (
        "assets/D-ui-and-icons/icons",
        ["action-interdict", "action-patrol", "action-escort",
         "action-survey", "action-claim"],
    ),
    "assets/D-ui-and-icons/status-alert-icons-sheet.png": (
        "assets/D-ui-and-icons/icons",
        ["status-raid-risk", "status-distress",
         "status-unrest", "status-charter-lapse"],
    ),
    "assets/A-branding-and-key-art/corporation-faction-emblem-set.png": (
        "assets/A-branding-and-key-art/emblems",
        ["emblem-1", "emblem-2", "emblem-3", "emblem-4", "emblem-5", "emblem-6"],
    ),
}


def main():
    for sheet, (outdir, names) in SHEETS.items():
        cells = slice_sheet(os.path.join(ROOT, sheet))
        os.makedirs(os.path.join(ROOT, outdir), exist_ok=True)
        status = "OK" if len(cells) == len(names) else "!! COUNT MISMATCH"
        print(f"{sheet}: {len(cells)} cells (expected {len(names)}) {status}")
        for i, cell in enumerate(cells):
            name = names[i] if i < len(names) else f"extra-{i}"
            out = os.path.join(ROOT, outdir, name + ".png")
            cell.save(out)
            print(f"    {name}.png  {cell.size[0]}x{cell.size[1]}")


if __name__ == "__main__":
    main()
