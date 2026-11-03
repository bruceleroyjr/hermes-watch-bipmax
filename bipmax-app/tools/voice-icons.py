# Draws the icon row's pill buttons (Voice on/off speaker, New chat bubble) for
# page/index.js iconButton: python tools/voice-icons.py
from PIL import Image, ImageDraw

W, H, S = 92, 80, 4  # button size on the watch (ICON_W x 80), 4x supersampled
RED, BLUE, GREY, PRESS, WHITE = (0xc0, 0x39, 0x2b), (0x24, 0x71, 0xa3), (0x5d, 0x6d, 0x7e), (0x33, 0x33, 0x33), (255, 255, 255)

def button(on, bg, path):
    im = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, W * S - 1, H * S - 1], radius=40 * S, fill=bg + (255,))
    cx, cy = W * S // 2 - 12 * S, H * S // 2  # speaker left of centre, waves / X to its right
    u = S
    d.rectangle([cx - 16 * u, cy - 8 * u, cx - 6 * u, cy + 8 * u], fill=WHITE)  # magnet
    d.polygon([(cx - 6 * u, cy - 8 * u), (cx + 6 * u, cy - 19 * u), (cx + 6 * u, cy + 19 * u), (cx - 6 * u, cy + 8 * u)], fill=WHITE)  # cone
    if on:
        for r in (13, 24):
            d.arc([cx + 4 * u - r * u, cy - r * u, cx + 4 * u + r * u, cy + r * u], -50, 50, fill=WHITE, width=4 * u)
    else:
        x0, k = cx + 16 * u, 9 * u
        d.line([x0, cy - k, x0 + 2 * k, cy + k], fill=WHITE, width=4 * u)
        d.line([x0, cy + k, x0 + 2 * k, cy - k], fill=WHITE, width=4 * u)
    im.resize((W, H), Image.LANCZOS).save(path)

for on, name, bg in ((True, 'voice-on', BLUE), (False, 'voice-off', GREY)):
    button(on, bg, f'assets/bipmax/{name}.png')
    button(on, PRESS, f'assets/bipmax/{name}-press.png')

def pill(bg, path, draw_icon):
    im = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, W * S - 1, H * S - 1], radius=40 * S, fill=bg + (255,))
    draw_icon(d, W * S // 2, H * S // 2, S)
    im.resize((W, H), Image.LANCZOS).save(path)

def chat(d, cx, cy, u):  # speech bubble with a tail
    d.rounded_rectangle([cx - 22 * u, cy - 17 * u, cx + 22 * u, cy + 9 * u], radius=9 * u, fill=WHITE)
    d.polygon([(cx - 12 * u, cy + 5 * u), (cx - 4 * u, cy + 5 * u), (cx - 14 * u, cy + 20 * u)], fill=WHITE)

def sessions(d, cx, cy, u):  # three list rows, each with a bullet
    for dy in (-14, 0, 14):
        d.ellipse([cx - 22 * u, cy + (dy - 3) * u, cx - 16 * u, cy + (dy + 3) * u], fill=WHITE)
        d.rounded_rectangle([cx - 8 * u, cy + (dy - 2) * u, cx + 22 * u, cy + (dy + 2) * u], radius=2 * u, fill=WHITE)

def keyboard(d, cx, cy, u):  # keyboard outline: three rows of keys and a space bar
    d.rounded_rectangle([cx - 26 * u, cy - 16 * u, cx + 26 * u, cy + 16 * u], radius=5 * u, outline=WHITE, width=3 * u)
    for row, dy in ((5, -9), (5, -2)):
        for i in range(row):
            x = cx + (-19 + i * 9.5) * u
            d.rounded_rectangle([x, cy + (dy - 2) * u, x + 4 * u, cy + (dy + 2) * u], radius=u, fill=WHITE)
    d.rounded_rectangle([cx - 13 * u, cy + 5 * u, cx + 13 * u, cy + 9 * u], radius=2 * u, fill=WHITE)

KEYBOARD_GREY = (0x6e, 0x6e, 0x6e)  # plain gray, not the bluish grey of the chat icon

for name, bg, fn in (('keyboard', KEYBOARD_GREY, keyboard), ('chat', GREY, chat), ('sessions', (0x8e, 0x44, 0xad), sessions)):
    pill(bg, f'assets/bipmax/{name}.png', fn)
    pill(PRESS, f'assets/bipmax/{name}-press.png', fn)

def eye(d, cx, cy, u):  # an eye: Review (look at the words before they go)
    d.ellipse([cx - 26 * u, cy - 14 * u, cx + 26 * u, cy + 14 * u], outline=WHITE, width=3 * u)
    d.ellipse([cx - 9 * u, cy - 9 * u, cx + 9 * u, cy + 9 * u], fill=WHITE)

def eye_off(d, cx, cy, u):  # the same eye, struck through
    eye(d, cx, cy, u)
    d.line([cx - 24 * u, cy + 20 * u, cx + 24 * u, cy - 20 * u], fill=WHITE, width=4 * u)

for name, bg, fn in (('review-on', BLUE, eye), ('review-off', KEYBOARD_GREY, eye_off)):
    pill(bg, f'assets/bipmax/{name}.png', fn)
    pill(PRESS, f'assets/bipmax/{name}-press.png', fn)
