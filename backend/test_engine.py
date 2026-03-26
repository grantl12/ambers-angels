import easyocr
import cv2

reader = easyocr.Reader(['en']) # This will download the model (approx 100MB)
image_path = "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates/target_target_01.jpg"

print(f"Reading {image_path}...")
results = reader.readtext(image_path)

for (bbox, text, prob) in results:
    print(f"✅ DETECTED: {text} (Confidence: {prob:.2f})")

if not results:
    print("❌ No text found.")
