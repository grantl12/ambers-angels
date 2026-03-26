from PIL import Image, ImageDraw, ImageFont
import os

path = "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates/verified_test.jpg"

# 1920x1080 (Standard Drone Frame)
img = Image.new('RGB', (1920, 1080), color=(50, 50, 50))
d = ImageDraw.Draw(img)

# White Plate Background
d.rectangle([700, 400, 1220, 650], fill=(255, 255, 255), outline=(0,0,0), width=5)

try:
    # Use a common bold font
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 120)
except:
    font = ImageFont.load_default()

# Draw Text
d.text((750, 460), "AMB3R 1", fill=(0, 0, 0), font=font)

img.save(path, "JPEG", quality=95)
print(f"✅ Generated: {path}")
