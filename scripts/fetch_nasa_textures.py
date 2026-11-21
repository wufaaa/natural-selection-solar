import io
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path
from PIL import Image

OUT_DIR = Path(r"c:\Users\LCB\Desktop\Gemini antigravity\natural-selection-solar\public\assets")
OUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {"User-Agent": "NaturalSelectionGame/1.0 (https://localhost)"}

TARGETS = [
    ("File:Solarsystemscope_texture_8k_mercury.jpg", "mercury.webp", (4096, 2048), "RGB"),
    ("File:Solarsystemscope_texture_4k_venus_atmosphere.jpg", "venus.webp", (4096, 2048), "RGB"),
    ("File:Solarsystemscope_texture_8k_mars.jpg", "mars.webp", (4096, 2048), "RGB"),
    ("File:Solarsystemscope_texture_8k_jupiter.jpg", "jupiter.webp", (4096, 2048), "RGB"),
    ("File:Solarsystemscope_texture_8k_saturn.jpg", "saturn.webp", (4096, 2048), "RGB"),
    ("File:Solarsystemscope_texture_8k_saturn_ring_alpha.png", "saturn_ring.webp", (4096, 256), "RGBA"),
    ("File:Solarsystemscope_texture_2k_uranus.jpg", "uranus.webp", (2048, 1024), "RGB"),
    ("File:Solarsystemscope_texture_2k_neptune.jpg", "neptune.webp", (2048, 1024), "RGB"),
    ("File:Solarsystemscope_texture_8k_moon.jpg", "moon.webp", (4096, 2048), "RGB"),
    ("File:Solarsystemscope_texture_8k_sun.jpg", "sun.webp", (4096, 2048), "RGB"),
    ("File:Solarsystemscope_texture_8k_earth_clouds.jpg", "earth_clouds.webp", (4096, 2048), "RGB"),
    ("File:Solarsystemscope_texture_8k_stars_milky_way.jpg", "milkyway_8k.webp", (6144, 3072), "RGB"),
]


def query_wikimedia_urls(titles):
    joined = "|".join(titles)
    url = (
        "https://commons.wikimedia.org/w/api.php?action=query&titles="
        + urllib.parse.quote(joined, safe="|:_")
        + "&prop=imageinfo&iiprop=url&format=json"
    )
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    pages = data.get("query", {}).get("pages", {})
    result = {}
    for p in pages.values():
        title = p.get("title", "").replace(" ", "_")
        info = p.get("imageinfo", [{}])[0]
        if "url" in info:
            result[title] = info["url"]
    return result


def main():
    Image.MAX_IMAGE_PIXELS = None
    urls = query_wikimedia_urls([t[0] for t in TARGETS])
    for title, out_name, size, mode in TARGETS:
        out_path = OUT_DIR / out_name
        if out_path.exists() and out_path.stat().st_size > 50_000:
            print(f"[SKIP] {out_name} ({out_path.stat().st_size // 1024} KB)")
            continue
        src_url = urls.get(title) or urls.get(title.replace(" ", "_"))
        if not src_url:
            raise RuntimeError(f"Missing Wikimedia URL for {title}. Keys={list(urls.keys())}")
        print(f"[FETCH] {out_name} <- {src_url}")
        req = urllib.request.Request(src_url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
        img = Image.open(io.BytesIO(raw))
        if img.mode != mode:
            img = img.convert(mode)
        if img.size != size:
            img = img.resize(size, Image.Resampling.LANCZOS)
        img.save(out_path, "WEBP", quality=90, method=4)
        print(f"[SAVED] {out_name}: {img.size[0]}x{img.size[1]} ({out_path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
