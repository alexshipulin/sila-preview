#!/usr/bin/env python3
"""Crop the catalogue shots to a uniform 3:4 portrait, ring centred."""
from PIL import Image
import os, glob

SRC = "/Users/alexshipulin/Desktop/каталог"
OUT = "/Users/alexshipulin/Desktop/Sila/assets"
RATIO = 3 / 4          # width / height
MAX_W = 1760           # never upscale past the native crop
THUMB_W = 440
CREAM = (255, 253, 244)   # --cream, the colour of the product sheet

# Where the ring sits vertically, as a fraction of height, for the tall
# lifestyle frames that have real slack to slide (read off the grid renders).
ANCHOR = {
    "lattice/hf_20260710_154853": 0.41,   # ring against the cheek
    "rhythm/hf_20260710_163746": 0.50,    # ring on the hand over the bag
}


def subject_box(im):
    """Bounding box of everything that is not the white sweep background."""
    grey = im.convert("L")
    # background is near-white; anything below 244 is the ring or its shadow
    mask = grey.point(lambda v: 255 if v < 244 else 0)
    box = mask.getbbox()
    return box


def crop_box(w, h, cx, cy):
    """Largest 3:4 window inside w×h, centred on (cx, cy) where it fits."""
    if w / h > RATIO:            # too wide -> height is the limit
        ch = h
        cw = round(h * RATIO)
    else:                        # too tall -> width is the limit
        cw = w
        ch = round(w / RATIO)
    x = min(max(round(cx - cw / 2), 0), w - cw)
    y = min(max(round(cy - ch / 2), 0), h - ch)
    return (x, y, x + cw, y + ch)


def process(path, out_stem):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    key = "/".join(path.split("/")[-2:])[:len("lattice/hf_20260710_154853")]
    name = os.path.basename(path)

    if name in ("1.png", "2.png"):
        box = subject_box(im)
        cx = (box[0] + box[2]) / 2
        cy = (box[1] + box[3]) / 2
        where = f"ring bbox {box}"
    elif key in ANCHOR:
        cx, cy = w / 2, h * ANCHOR[key]
        where = f"anchor {ANCHOR[key]:.2f}"
    else:
        cx, cy = w / 2, h / 2
        where = "centre"

    box = crop_box(w, h, cx, cy)
    cut = im.crop(box)

    if name in ("1.png", "2.png"):
        # the packshots are shot on pure white, which reads as a bright rectangle
        # against the cream sheet — multiply so the sweep lands exactly on --cream
        cut = Image.merge("RGB", [
            ch.point(lambda v, m=m: round(v * m / 255))
            for ch, m in zip(cut.split(), CREAM)
        ])

    if cut.width > MAX_W:
        cut = cut.resize((MAX_W, round(MAX_W / RATIO)), Image.LANCZOS)

    full = os.path.join(OUT, out_stem + ".jpg")
    cut.save(full, "JPEG", quality=88, optimize=True, progressive=True)

    th = cut.resize((THUMB_W, round(THUMB_W / RATIO)), Image.LANCZOS)
    th.save(os.path.join(OUT, out_stem + "-t.jpg"), "JPEG", quality=84, optimize=True)

    print(f"{out_stem:18} {w}x{h} -> {cut.width}x{cut.height}  "
          f"crop{box}  [{where}]  {os.path.getsize(full)//1024}KB")


if __name__ == "__main__":
    for prod in ("signet", "lattice", "rhythm"):
        files = sorted(glob.glob(os.path.join(SRC, prod, "*.png")))
        named = sorted(f for f in files if os.path.basename(f) in ("1.png", "2.png"))
        hf = sorted(f for f in files if os.path.basename(f).startswith("hf_"))
        for i, f in enumerate(named + hf, 1):
            process(f, f"{prod}-{i}")
