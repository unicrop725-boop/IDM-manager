#!/usr/bin/env python3
"""
Generate all brand assets, app icons, favicons, extension icons, and WebP images
from the master brand logo: Gemini_Generated_Image_zcn06azcn06azcn0.png
With enhanced contrast and sharpness tuning for small icons (16x16, 32x32, 48x48).
"""

import os
from PIL import Image, ImageEnhance

SOURCE_PATH = "Gemini_Generated_Image_zcn06azcn06azcn0.png"

def make_square(img):
    w, h = img.size
    min_dim = min(w, h)
    left = (w - min_dim) // 2
    top = (h - min_dim) // 2
    return img.crop((left, top, left + min_dim, top + min_dim))

def main():
    if not os.path.exists(SOURCE_PATH):
        print(f"Error: {SOURCE_PATH} not found!")
        return

    print(f"Loading master logo: {SOURCE_PATH}")
    master = Image.open(SOURCE_PATH).convert("RGBA")
    square = make_square(master)

    # 1. Website Public Images (PNG + WebP)
    website_targets = [
        ("website/public/img/favicon-32.png", (32, 32), "PNG"),
        ("website/public/img/icon-128.png", (128, 128), "PNG"),
        ("website/public/img/icon-256.png", (256, 256), "PNG"),
        ("website/public/img/logo.png", (512, 512), "PNG"),
        ("website/public/img/favicon-32.webp", (32, 32), "WEBP"),
        ("website/public/img/icon-128.webp", (128, 128), "WEBP"),
        ("website/public/img/icon-256.webp", (256, 256), "WEBP"),
        ("website/public/img/logo.webp", (512, 512), "WEBP"),
        ("website/public/logo.webp", (512, 512), "WEBP"),
    ]

    # 2. Browser Extension Icons
    extension_targets = [
        ("extension/icons/icon16.png", (16, 16), "PNG"),
        ("extension/icons/icon32.png", (32, 32), "PNG"),
        ("extension/icons/icon48.png", (48, 48), "PNG"),
        ("extension/icons/icon128.png", (128, 128), "PNG"),
    ]

    # 3. Tauri Desktop App Icons
    tauri_targets = [
        ("src-tauri/icons/32x32.png", (32, 32), "PNG"),
        ("src-tauri/icons/64x64.png", (64, 64), "PNG"),
        ("src-tauri/icons/128x128.png", (128, 128), "PNG"),
        ("src-tauri/icons/128x128@2x.png", (256, 256), "PNG"),
        ("src-tauri/icons/icon.png", (512, 512), "PNG"),
        ("src-tauri/icons/Square30x30Logo.png", (30, 30), "PNG"),
        ("src-tauri/icons/Square44x44Logo.png", (44, 44), "PNG"),
        ("src-tauri/icons/Square71x71Logo.png", (71, 71), "PNG"),
        ("src-tauri/icons/Square89x89Logo.png", (89, 89), "PNG"),
        ("src-tauri/icons/Square107x107Logo.png", (107, 107), "PNG"),
        ("src-tauri/icons/Square142x142Logo.png", (142, 142), "PNG"),
        ("src-tauri/icons/Square150x150Logo.png", (150, 150), "PNG"),
        ("src-tauri/icons/Square284x284Logo.png", (284, 284), "PNG"),
        ("src-tauri/icons/Square310x310Logo.png", (310, 310), "PNG"),
        ("src-tauri/icons/StoreLogo.png", (50, 50), "PNG"),
    ]

    all_targets = website_targets + extension_targets + tauri_targets

    for rel_path, size, fmt in all_targets:
        os.makedirs(os.path.dirname(rel_path), exist_ok=True)
        resized = square.resize(size, Image.Resampling.LANCZOS)
        
        # Apply slight contrast and sharpness boost for small sizes so the icon pops
        if size[0] <= 48:
            resized = ImageEnhance.Contrast(resized).enhance(1.15)
            resized = ImageEnhance.Sharpness(resized).enhance(1.4)
            
        if fmt == "WEBP":
            resized.save(rel_path, format="WEBP", quality=95, method=6)
        else:
            resized.save(rel_path, format="PNG", optimize=True)
        print(f"Generated: {rel_path} ({size[0]}x{size[1]} {fmt})")

    # Generate multi-layer favicon.ico in both website/public/favicon.ico and root favicon.ico
    for ico_dest in ["website/public/favicon.ico", "website/public/img/favicon.ico", "favicon.ico"]:
        ico_sizes = [(16, 16), (32, 32), (48, 48)]
        ico_layers = []
        for s in ico_sizes:
            r = square.resize(s, Image.Resampling.LANCZOS)
            r = ImageEnhance.Contrast(r).enhance(1.2)
            r = ImageEnhance.Sharpness(r).enhance(1.5)
            ico_layers.append(r)
        ico_layers[0].save(ico_dest, format="ICO", sizes=ico_sizes, append_images=ico_layers[1:])
        print(f"Generated multi-size Favicon: {ico_dest}")

    # Generate multi-layer icon.ico for Windows desktop app
    ico_path = "src-tauri/icons/icon.ico"
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_imgs = [square.resize(s, Image.Resampling.LANCZOS) for s in ico_sizes]
    ico_imgs[0].save(ico_path, format="ICO", sizes=ico_sizes, append_images=ico_imgs[1:])
    print(f"Generated multi-size Windows icon: {ico_path}")

    # Generate brand WebP in root as well for direct reference
    root_webp = "brand-logo.webp"
    square.resize((512, 512), Image.Resampling.LANCZOS).save(root_webp, format="WEBP", quality=95)
    print(f"Generated: {root_webp}")

    print("\nAll brand assets successfully generated!")

if __name__ == "__main__":
    main()
