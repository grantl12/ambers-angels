import os
from PIL import Image, ImageDraw, ImageFont

output_dir = "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates"
os.makedirs(output_dir, exist_ok=True)

def create_high_fidelity_plate(text, filename):
    # 1000x1000 Dark Gray Canvas (The Car Bumper)
    img = Image.new('RGB', (1000, 1000), color=(40, 40, 40))
    d = ImageDraw.Draw(img)
    
    # Draw a "Plate Holder" (Black shadow)
    d.rectangle([245, 395, 755, 605], fill=(10, 10, 10))
    
    # Draw the White Plate
    d.rectangle([250, 400, 750, 600], fill=(245, 245, 245), outline=(100, 100, 100), width=5)
    
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 110)
    except:
        font = ImageFont.load_default()
        
    # Center text with clear margins
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
    d.text((500 - tw//2, 500 - th//2), text, fill=(20, 20, 20), font=font)
    
    img.save(os.path.join(output_dir, filename), "JPEG")

create_high_fidelity_plate("AMB3R-1", "target_target_01.jpg")
