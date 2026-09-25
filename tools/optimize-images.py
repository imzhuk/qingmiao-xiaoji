#!/usr/bin/env python3
"""
青苗小记 · 图片优化

把 assets/photos 下的原始图片（PNG / JPG）压缩成 WebP，并额外生成一批小尺寸缩略图，
同时写出 assets/photos/manifest.json 记录每张图的宽高，供 build.js 生成带尺寸占位的 <img>。

用法（在项目根目录）：
    python tools/optimize-images.py            # 增量：只处理还没转过的图
    python tools/optimize-images.py --force    # 全部重转

原图不会被删除 —— 脚本只新增 .webp 与 thumbs/。确认没问题后可以自行删掉旧文件。
"""

import argparse
import json
import os
import sys
import time

try:
    from PIL import Image
except ImportError:
    sys.exit("需要 Pillow：pip install Pillow")

SOURCE_EXTS = (".png", ".jpg", ".jpeg", ".webp")


def human(n):
    return f"{n / 1024:.0f} KB" if n < 1024 * 1024 else f"{n / 1024 / 1024:.2f} MB"


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(description="把相册原图转成 WebP 并生成缩略图")
    ap.add_argument("--dir", default=None, help="照片目录，默认 <项目>/assets/photos")
    ap.add_argument("--quality", type=int, default=88, help="原图 WebP 质量（默认 88）")
    ap.add_argument("--thumb-edge", type=int, default=640, help="缩略图长边像素（默认 640）")
    ap.add_argument("--thumb-quality", type=int, default=68, help="缩略图 WebP 质量（默认 68）")
    ap.add_argument("--force", action="store_true", help="忽略缓存，全部重转")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    photos = args.dir or os.path.join(root, "assets", "photos")
    thumbs = os.path.join(photos, "thumbs")

    if not os.path.isdir(photos):
        sys.exit(f"找不到照片目录：{photos}")
    os.makedirs(thumbs, exist_ok=True)

    sources = sorted(
        name for name in os.listdir(photos)
        if name.lower().endswith(SOURCE_EXTS)
        and not name.lower().endswith(".webp")
        and os.path.isfile(os.path.join(photos, name))
    )
    if not sources:
        sys.exit("没有找到待处理的图片（PNG / JPG）")

    print(f"源目录：{photos}")
    print(f"待处理：{len(sources)} 张\n")
    print(f"{'文件':<22}{'原体积':>11}{'WebP':>11}{'缩略图':>11}{'占比':>8}")

    manifest = {}
    total_before = total_after = 0
    started = time.time()
    converted = 0

    for name in sources:
        src = os.path.join(photos, name)
        stem = os.path.splitext(name)[0]
        full_out = os.path.join(photos, stem + ".webp")
        thumb_out = os.path.join(thumbs, stem + ".webp")
        before = os.path.getsize(src)

        with Image.open(src) as raw:
            width, height = raw.size
            image = raw.convert("RGB")

        need_full = args.force or not os.path.exists(full_out) or os.path.getmtime(full_out) < os.path.getmtime(src)
        need_thumb = args.force or not os.path.exists(thumb_out) or os.path.getmtime(thumb_out) < os.path.getmtime(src)

        if need_full:
            image.save(full_out, "WEBP", quality=args.quality, method=6)
        after = os.path.getsize(full_out)

        # 少数 JPG 本身已经压得很小，转 WebP 反而更大 —— 这种情况保留原图，不做无谓的折腾
        keep_source = after >= before and name.lower().endswith((".jpg", ".jpeg"))
        if keep_source:
            os.remove(full_out)
            after = before
            src_ref = f"assets/photos/{name}"
        else:
            src_ref = f"assets/photos/{stem}.webp"

        if need_thumb:
            scale = args.thumb_edge / max(image.size)
            thumb = image.resize(
                (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                Image.LANCZOS,
            ) if scale < 1 else image
            thumb.save(thumb_out, "WEBP", quality=args.thumb_quality, method=6)
        thumb_size = os.path.getsize(thumb_out)

        manifest[stem] = {
            "src": src_ref,
            "thumb": f"assets/photos/thumbs/{stem}.webp",
            "w": width,
            "h": height,
            "bytes": after,
        }
        total_before += before
        total_after += after
        converted += 1
        mark = "  ← 保留原图" if keep_source else ""
        print(f"{name:<22}{human(before):>11}{human(after):>11}{human(thumb_size):>11}{after / before * 100:>7.1f}%{mark}")

    manifest_path = os.path.join(photos, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write("\n")

    thumb_total = sum(os.path.getsize(os.path.join(thumbs, k + ".webp")) for k in manifest)
    print(f"\n共处理 {converted} 张，用时 {time.time() - started:.1f} 秒")
    print(f"  原图合计   {human(total_before)}")
    print(f"  WebP 合计  {human(total_after)}（压缩到 {total_after / total_before * 100:.1f}%）")
    print(f"  缩略图合计 {human(thumb_total)}")
    print(f"  首屏全量加载（20 张缩略图）约 {human(thumb_total)}")
    print(f"\n已写出 {os.path.relpath(manifest_path, root)}")
    print("原图保留未删除；确认效果后可自行清理 .png / .jpg。")


if __name__ == "__main__":
    main()
