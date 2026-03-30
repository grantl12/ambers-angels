import subprocess

def crop_video_to_frames(input_file, output_pattern):
    # Construct the command as a list for safety and clarity
    command = [
        "ffmpeg",
        "-i", input_file,
        "-vf", "crop=600:200:100:300",
        output_pattern
    ]

    try:
        print(f"Processing {input_file}...")
        # check=True raises an error if the command fails
        subprocess.run(command, check=True)
        print("Success! Cropped frames have been generated.")
    except subprocess.CalledProcessError as e:
        print(f"FFmpeg error: {e}")
    except FileNotFoundError:
        print("Error: FFmpeg is not installed or not in your system PATH.")

if __name__ == "__main__":
    crop_video_to_frames("test.mp4", "cropped_%03d.jpg")
