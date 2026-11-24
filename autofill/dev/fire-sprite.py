# Draws the setup's progress-bar fire: the Awin logo (assets/awin-logo.png) as a small pixelated flame
# with a fireplace-style flicker. Only the logo's own shape and colours: no logs, no sparks.
#   assets/awin-fire.gif        the flicker, looped (shown while the setup runs)
#   assets/awin-fire-still.png  its first frame (shown when the run ends)
# The flame is 24 x 24 pixels (plus room above for the tips): the full box shows it at 2x, the small box at 1x.
# How it moves: the base stays put; the flame gently stretches up and settles; higher rows sway sideways,
# more the higher they are; the top part licks up and down; a few pixels inside the flame flare one shade
# lighter each frame.
# Needs Pillow:  python3 -m pip install --target /tmp/pylib Pillow && PYTHONPATH=/tmp/pylib python3 fire-sprite.py
import math
import random
from pathlib import Path
from PIL import Image

N = 24           # grid size
FRAMES = 10
MS = 100         # per frame
PAD = 3          # rows of room above the logo for the tips to lick into

assets = Path(__file__).resolve().parents[2] / 'assets'
logo = Image.open(assets / 'awin-logo.png').convert('RGBA')

# The logo on the pixel grid, each cell given the nearest of the logo's own colours (darkest to lightest).
small = logo.resize((N, N), Image.BOX)
cells = [[small.getpixel((x, y)) for x in range(N)] for y in range(N)]
# The logo's own four colours (crimson core, red, orange, yellow), found by clustering its solid pixels,
# plus one hot light yellow used only for flares. Darkest to lightest.
def lum(c): return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
solid_px = [c[:3] for c in logo.getdata() if c[3] >= 230]
centres = [solid_px[int(q * (len(solid_px) - 1))] for q in (0.1, 0.4, 0.6, 0.9)]
for _ in range(12):   # a few rounds of k-means
    groups = [[] for _ in centres]
    for c in solid_px:
        groups[min(range(len(centres)), key=lambda i: sum((a - b) ** 2 for a, b in zip(c, centres[i])))].append(c)
    centres = [tuple(round(sum(v) / len(g)) for v in zip(*g)) if g else centres[i] for i, g in enumerate(groups)]
shades = sorted(centres, key=lum) + [(255, 222, 110)]
HOT = len(shades) - 1
def nearest(c): return min(range(HOT), key=lambda i: sum((a - b) ** 2 for a, b in zip(c, shades[i])))
grid = [[nearest(c[:3]) if c[3] >= 110 else None for c in row] for row in cells]
H = N + PAD
base = [[None] * N for _ in range(PAD)] + grid


def frame(f):
    rng = random.Random(f * 7919)
    t = 2 * math.pi * f / FRAMES
    bottom = H - 1
    stretch = 1 + 0.07 * math.sin(t)                         # the whole flame breathes up and down
    inside = lambda x, y: 0 <= x < N and 0 <= y < H and base[y][x] is not None
    out = Image.new('RGBA', (N, H), (0, 0, 0, 0))
    for y in range(H):
        h = max(0.0, (bottom - y) / (N - 1))                  # 0 at the base, 1 at the top of the logo
        dx = round(1.1 * h ** 2 * math.sin(t + y * 0.35))     # sideways sway, stronger higher up
        for x in range(N):
            lick = round(1.2 * max(0.0, (h - 0.6) / 0.4) * math.sin(2 * t + x * 0.5))   # only the top licks
            sx = x - dx
            sy = round(bottom - (bottom - y) / stretch) + lick
            if not inside(sx, sy):
                continue
            i = base[sy][sx]
            solid = all(inside(sx + ax, sy + ay) for ax, ay in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if solid and h > 0.25 and rng.random() < 0.07:    # a flare of heat, inside the flame only
                i = min(HOT, i + 1)
            out.putpixel((x, y), shades[i] + (255,))
    return out


def save_gif(frames, path):
    pal = [0, 0, 0] + [v for s in shades for v in s]
    pal += [0] * (768 - len(pal))
    out = []
    for f in frames:
        p = Image.new('P', f.size, 0)
        p.putpalette(pal)
        for y in range(f.height):
            for x in range(f.width):
                r, g, b, a = f.getpixel((x, y))
                if a:
                    p.putpixel((x, y), 1 + shades.index((r, g, b)))
        out.append(p)
    out[0].save(path, save_all=True, append_images=out[1:], duration=MS, loop=0, transparency=0, disposal=2)


if __name__ == '__main__':
    frames = [frame(f) for f in range(FRAMES)]
    save_gif(frames, assets / 'awin-fire.gif')
    frames[0].save(assets / 'awin-fire-still.png')
    import os
    preview = os.environ.get('PREVIEW')
    if preview:   # a big contact sheet of the frames, on dark and light, to look at
        sheet = Image.new('RGBA', ((N + 2) * FRAMES, (H + 2) * 2), (255, 255, 255, 255))
        for k, fr in enumerate(frames):
            dark = Image.new('RGBA', fr.size, (32, 32, 32, 255))
            dark.alpha_composite(fr)
            sheet.alpha_composite(dark, (k * (N + 2), 0))
            sheet.alpha_composite(fr, (k * (N + 2), H + 2))
        sheet.resize((sheet.width * 8, sheet.height * 8), Image.NEAREST).save(preview)
    print('ok', N, H, shades)
