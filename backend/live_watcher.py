import os, time, subprocess, json, requests, shutil, psycopg2

WATCH_DIR = "/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates"
ALERT_DIR = "/home/ambers-angels/proj_dir/ambers-angels/backend/alerts"
API_URL = "http://127.0.0.1:8000/detections"
DB_PARAMS = "dbname=ambersangels user=postgres"

os.makedirs(ALERT_DIR, exist_ok=True)
processed_files = set()

def is_on_watchlist(plate):
    try:
        conn = psycopg2.connect(DB_PARAMS)
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM watchlist WHERE plate_text = %s", (plate,))
        match = cur.fetchone() is not None
        cur.close()
        conn.close()
        return match
    except Exception as e:
        print(f"⚠️ DB Lookup Error: {e}")
        return False

print("🚀 Watcher active. Querying 'watchlist' table for targets...")

while True:
    files = [f for f in os.listdir(WATCH_DIR) if f.endswith(".jpg")]
    for f in files:
        if f not in processed_files:
            path = os.path.join(WATCH_DIR, f)
            result = subprocess.run(['alpr', '-c', 'us', '-j', path], capture_output=True, text=True)
            
            try:
                data = json.loads(result.stdout)
                if data['results']:
                    best = data['results'][0]
                    plate = best['plate']
                    
                    # 1. LOG EVERYTHING
                    requests.post(API_URL, json={
                        "plate_text": plate,
                        "confidence": best['confidence'],
                        "drone_id": "drone-alpha",
                        "detected_at": time.strftime('%Y-%m-%dT%H:%M:%SZ')
                    })
                    
                    # 2. CHECK DB WATCHLIST FOR IMAGE RETENTION
                    if is_on_watchlist(plate):
                        archive_path = os.path.join(ALERT_DIR, f"ALERT_{plate}_{int(time.time())}.jpg")
                        shutil.move(path, archive_path)
                        print(f"🚨 DB MATCH FOUND: {plate}. Image archived.")
                    else:
                        print(f"✅ Logged {plate}. No match, deleting image.")
                        os.remove(path)
                else:
                    os.remove(path)
            except Exception as e:
                print(f"❌ Error: {e}")
            processed_files.add(f)
    time.sleep(0.5)
