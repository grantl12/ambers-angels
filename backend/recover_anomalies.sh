#!/bin/bash

ANOMALY_DIR="/home/ambers-angels/proj_dir/ambers-angels/backend/test_plates/anomalies"
API_URL="http://localhost:8000/detections"

echo "🔎 Starting Recovery Scan on $ANOMALY_DIR..."

for frame in "$ANOMALY_DIR"/*.jpg; do
    # 1. Run ALPR on the 'lost' frame
    # We use -n 1 to get the best guess
    RESULT=$(alpr -c us -j -n 1 "$frame")
    
    # 2. Extract Plate and Confidence using python for clean parsing
    PLATE=$(echo "$RESULT" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['results'][0]['plate']) if data['results'] else print('')")
    CONF=$(echo "$RESULT" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['results'][0]['confidence']) if data['results'] else print('0')")

    if [ -n "$PLATE" ]; then
        echo "🎯 Found $PLATE ($CONF%) in $(basename "$frame"). Sending to Brain..."
        
        # 3. Push to the Backend
        # The Backend will now use the Fuzzy Matcher we just installed!
        curl -s -X POST "$API_URL" \
             -H "Content-Type: application/json" \
             -d "{
               \"drone_id\": \"recovery_bot\",
               \"plate_best\": \"$PLATE\",
               \"confidence\": $CONF,
               \"best_frame_id\": \"$(basename "$frame")\"
             }" > /dev/null
    fi
done

echo "✅ Recovery Scan Complete. Check your Discord/Logs for hits!"
