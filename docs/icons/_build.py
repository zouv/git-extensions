"""Build the Git Extensions PNG/ICO/ICNS icon set from the SVG source.

Renders the 512x512 SVG with headless Microsoft Edge at 2048x2048 (4x, to
avoid Edge's viewport clipping), chroma-keys the magenta background to
transparent, then downscales straight to each target size. The layout is
defined inside the SVG, so no cropping or re-centering is done.

Outputs live in docs/icons; the script also installs the Tauri icon names
(32x32.png / 64x64.png / 128x128.png / 128x128@2x.png / icon.png / icon.ico /
icon.icns) into src-tauri/icons. It uses only Pillow + NumPy and a local
Microsoft Edge; no network access.

Chroma-key math MUST use float32, not int16: dark/light pixels differ from
#ff00ff by more than 181 per channel, whose squares overflow int16 and produce
NaN alpha, making dark fills / light strokes vanish.
"""
from io import BytesIO
from pathlib import Path
import os
import shutil
import struct
import subprocess
import time

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SVG = HERE / "git-extensions.svg"
PREFIX = "git-extensions"
APP_ICONS = ROOT / "src-tauri" / "icons"

RENDER = 2048   # 4x the 512 viewBox
TARGET = 1024   # master output size
ICO_SIZES = [256, 128, 64, 48, 32, 24, 16]
PNG_SIZES = [1024, 512, 256, 128, 64, 48, 32, 16]
ICNS_SIZES = [(1024, "ic10"), (512, "ic09"), (256, "ic08"), (128, "ic07")]
STORE_ICONS = {
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}


def find_edge() -> str:
    candidates = [
        os.environ.get("GITEXT_EDGE"),
        shutil.which("msedge"),
        shutil.which("msedge.exe"),
    ]
    for base in (
        os.environ.get("PROGRAMFILES(X86)"),
        os.environ.get("PROGRAMFILES"),
        os.environ.get("LOCALAPPDATA"),
    ):
        if base:
            candidates.append(str(Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe"))
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise SystemExit("Microsoft Edge not found; set GITEXT_EDGE to msedge.exe")


def build_icns(master: Image.Image) -> bytes:
    chunks = []
    for size, chunk_type in ICNS_SIZES:
        buffer = BytesIO()
        master.resize((size, size), Image.Resampling.LANCZOS).save(buffer, format="PNG")
        payload = buffer.getvalue()
        chunks.append(chunk_type.encode("ascii") + struct.pack(">I", 8 + len(payload)) + payload)
    body = b"".join(chunks)
    return b"icns" + struct.pack(">I", 8 + len(body)) + body


def main() -> None:
    edge = find_edge()
    svg_text = SVG.read_text(encoding="utf-8")
    svg_big = svg_text.replace('width="512"', f'width="{RENDER}"').replace('height="512"', f'height="{RENDER}"')

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html,body{{margin:0;padding:0;background:#ff00ff;width:{RENDER}px;height:{RENDER}px;overflow:hidden}}
svg{{display:block;width:{RENDER}px;height:{RENDER}px;background:#ff00ff}}
</style></head><body>
{svg_big}
</body></html>"""

    html_path = HERE / "_build.html"
    raw_path = HERE / "_raw.png"
    html_path.write_text(html, encoding="utf-8")

    print(f"Rendering {SVG.name} at {RENDER}x{RENDER} ...")
    subprocess.run(
        [
            edge,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            f"--window-size={RENDER},{RENDER}",
            f"--screenshot={raw_path}",
            f"file:///{str(html_path).replace(os.sep, '/')}?t={int(time.time() * 1000)}",
        ],
        check=True,
        capture_output=True,
    )

    img = Image.open(raw_path).convert("RGBA")
    arr = np.array(img)

    # Chroma-key magenta -> transparent. float32 avoids int16 overflow.
    rgb = arr[:, :, :3].astype(np.float32)
    key = np.array([255.0, 0.0, 255.0], dtype=np.float32)
    distance = np.sqrt(((rgb - key) ** 2).sum(axis=2))
    alpha = np.clip((distance - 24.0) / 40.0, 0.0, 1.0) * 255.0
    arr[:, :, 3] = alpha.astype(np.uint8)
    keyed = distance < 24.0
    arr[keyed, 0] = 0
    arr[keyed, 1] = 0
    arr[keyed, 2] = 0
    out = Image.fromarray(arr, "RGBA")

    master = out.resize((TARGET, TARGET), Image.Resampling.LANCZOS)
    master.save(HERE / f"{PREFIX}-1024.png")

    marr = np.array(master)
    opaque = marr[:, :, 3] > 10
    ys, xs = np.where(opaque)
    print(
        f"Content bbox: x[{xs.min()},{xs.max()}] y[{ys.min()},{ys.max()}]  "
        f"L={xs.min()} R={TARGET - 1 - xs.max()} T={ys.min()} B={TARGET - 1 - ys.max()}"
    )

    for size in PNG_SIZES:
        master.resize((size, size), Image.Resampling.LANCZOS).save(HERE / f"{PREFIX}-{size}.png")

    frames = [master.resize((size, size), Image.Resampling.LANCZOS).convert("RGBA") for size in ICO_SIZES]
    ico_path = HERE / f"{PREFIX}.ico"
    frames[0].save(ico_path, format="ICO", sizes=[(s, s) for s in ICO_SIZES], append_images=frames[1:])
    print(f"ICO: {ico_path} ({ico_path.stat().st_size} bytes)")

    icns_path = HERE / f"{PREFIX}.icns"
    icns_path.write_bytes(build_icns(master))
    print(f"ICNS: {icns_path} ({icns_path.stat().st_size} bytes)")

    APP_ICONS.mkdir(parents=True, exist_ok=True)
    for source, target in (
        (HERE / f"{PREFIX}-32.png", "32x32.png"),
        (HERE / f"{PREFIX}-64.png", "64x64.png"),
        (HERE / f"{PREFIX}-128.png", "128x128.png"),
        (HERE / f"{PREFIX}-256.png", "128x128@2x.png"),
        (HERE / f"{PREFIX}-1024.png", "icon.png"),
        (ico_path, "icon.ico"),
        (icns_path, "icon.icns"),
    ):
        shutil.copyfile(source, APP_ICONS / target)
    for name, size in STORE_ICONS.items():
        master.resize((size, size), Image.Resampling.LANCZOS).save(APP_ICONS / name)
    print(f"Installed Tauri icons: {APP_ICONS}")

    for path in (html_path, raw_path):
        if path.exists():
            path.unlink()
    print("DONE")


if __name__ == "__main__":
    main()
