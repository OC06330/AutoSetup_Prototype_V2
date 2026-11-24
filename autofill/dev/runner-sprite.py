# Draws the hidden guy: the head of a cute pixel version of the prototype's icon character (flame-shaped
# head in yellow/red/orange, sunglasses), who now and then peeks up over the small box's progress bar.
#   assets/runner-peek.gif   2 frames: the glint on his sunglasses shifts, as if he's glancing around
# (The earlier full-body run, cheer, thumbs-up and sad sprites are in git history before this change.)
# Needs Pillow:  python3 -m pip install --target /tmp/pylib Pillow && PYTHONPATH=/tmp/pylib python3 runner-sprite.py
from pathlib import Path
from PIL import Image

PALETTE = {
    'Y': (255, 194, 26),   # yellow (left of the head)
    'O': (255, 122, 26),   # orange (right of the head)
    'R': (227, 58, 58),    # red (middle stripe)
    'K': (26, 26, 26),     # black (sunglasses, smile)
    'W': (255, 255, 255),  # glint on the glasses
    'P': (255, 143, 163),  # pink cheeks
}

# 18 columns wide, 13 rows high.
HEAD = [
    "...........OO.....",
    "....Y.....OOO.....",
    "...YY....ROOOO....",
    "...YYY..RROOOO....",
    "..YYYYYRRROOOOO...",
    "..YYYYYRRROOOOO...",
    "..KWKKKRRKWKKKO...",   # sunglasses, glint on the left of each lens
    "..KKKKKRRKKKKKO...",
    "..YPYYYRRROOOPO...",   # pink cheeks
    "...YYKYRRROKOO....",   # big smile
    "...YYYKKKKKOO.....",
    "....YYRRROOO......",
    ".....YRRROO.......",
]
GLANCE = "..KKKWKRRKKKWKO..."   # the glint moved right: he's looking the other way


def draw(rows):
    img = Image.new('RGBA', (len(rows[0]), len(rows)), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in PALETTE:
                img.putpixel((x, y), PALETTE[ch] + (255,))
    return img


def save_gif(frames, path, ms):
    # Palette GIF with index 0 transparent; each frame replaces the last (disposal 2).
    colours = list(PALETTE.values())
    pal = [0, 0, 0] + [c for rgb in colours for c in rgb]
    pal += [0] * (768 - len(pal))
    out = []
    for f in frames:
        p = Image.new('P', f.size, 0)
        p.putpalette(pal)
        for y in range(f.height):
            for x in range(f.width):
                r, g, b, a = f.getpixel((x, y))
                if a:
                    p.putpixel((x, y), 1 + colours.index((r, g, b)))
        out.append(p)
    out[0].save(path, save_all=True, append_images=out[1:], duration=ms, loop=0, transparency=0, disposal=2)


if __name__ == '__main__':
    assets = Path(__file__).resolve().parents[2] / 'assets'
    glance = HEAD[:6] + [GLANCE] + HEAD[7:]
    save_gif([draw(HEAD), draw(glance)], assets / 'runner-peek.gif', 500)
    print('ok', len(HEAD[0]), len(HEAD))
