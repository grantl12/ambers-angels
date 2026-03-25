import subprocess
import time

def stream_relay():
    # Define the command as a list of arguments
    command = [
        "ffmpeg",
        "-i", "rtmp://localhost/live/drone1",
        "-c", "copy",
        "-f", "flv",
        "rtmp://localhost/live/stable"
    ]

    print("Relay started. Press Ctrl+C to stop.")

    while True:
        try:
            # subprocess.run waits for ffmpeg to finish/crash before continuing
            subprocess.run(command)
        except KeyboardInterrupt:
            print("\nStopping relay...")
            break
        
        # Wait 2 seconds before the next attempt
        print("Stream disconnected. Retrying in 2 seconds...")
        time.sleep(2)

if __name__ == "__main__":
    stream_relay()

