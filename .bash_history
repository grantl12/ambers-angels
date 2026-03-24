bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential libpcre3 libpcre3-dev libssl-dev zlib1g-dev git ffmpeg
cd /tmp
wget http://nginx.org/download/nginx-1.24.0.tar.gz
tar -zxvf nginx-1.24.0.tar.gz
git clone https://github.com/arut/nginx-rtmp-module.git
cd nginx-1.24.0
./configure --add-module=../nginx-rtmp-module
make
sudo make install
home
. 
./
/
dir
pwd
cd root
cd home
cd /home
ls
ls -l
pwd
cd .
cd ..
pwd
dir
sudo nano /usr/local/nginx/conf/nginx.conf
sudo /usr/local/nginx/sbin/nginx
curl http://YOUR_SERVER_IP:8080
sudo /usr/local/nginx/sbin/nginx
curl http://YOUR_SERVER_IP:8080
sudo nano /usr/local/nginx/conf/nginx.conf
curl http://YOUR_SERVER_IP:8080
sudo /usr/local/nginx/sbin/nginx
sudo lsof -i :8080
sudo pkill nginx
sudo /usr/local/nginx/sbin/nginx
curl http://YOUR_SERVER_IP:8080
sudo nano /usr/local/nginx/conf/nginx.conf
curl http://0.0.0.0:8080
hostname
ipconfig /all
ifconfig
apt install net-tools
reboot
curl ifconfig.me
sudo /usr/local/nginx/sbin/nginx
curl http://157.245.125.103:8080
ffmpeg -i rtmp://localhost/live/drone1 -t 10 test.mp4
ffmpeg -i rtmp://localhost/live/drone1 -vf fps=2 /frames/frame_%03d.jpg
ffmpeg -i rtmp://localhost/live/drone1 -t 10 test.mp4
mkdir -p /frames
ffmpeg -i rtmp://localhost/live/drone1 -vf fps=2 /frames/frame_%03d.jpg
ls /frames
display /frames/frame_001.jpg
apt install graphicsmagick-imagemagick-compt
display /frames/frame_001.jpg
apt install imagemagick-6.q16
display /frames/frame_001.jpg
sudo apt install openalpr -y
scp root@157.245.125.103:/frames/frame_001.jpg .
sudo apt install fim -y
fim /frames/frame_001.jpg
sudo apt install docker.io -y
docker run -it --rm -v /frames:/data openalpr/openalpr -c us /data/frame_001.jpg
ls /frames
pkill ffmpeg
ffmpeg -i rtmp://localhost/live/drone1 -vf fps=2 -update 1 /frames/frame_%03d.jpg
ffmpeg -i rtmp://localhost/live/drone1
pkill ffmpeg
pkill nginx
/usr/local/nginx/sbin/nginx
ffmpeg -fflags +genpts -rtmp_live live -i rtmp://localhost/live/drone1 -vf fps=2 /frames/frame_%03d.jpg
ffmpeg -fflags +discardcorrupt -flags low_delay -strict experimental -i rtmp://localhost/live/drone1 -vf fps=2 /frames/frame_%03d.jpg
ffmpeg -i rtmp://localhost/live/drone1 -c copy -f flv rtmp://localhost/live/processed
[200~ffmpeg -i rtmp://localhost/live/processed -vf fps=2 /frames/frame_%03d.jpg~
ffmpeg -i rtmp://localhost/live/processed -vf fps=2 /frames/frame_%03d.jpg
ffmpeg -i rtmp://localhost/live/drone1
ifconfig
ffmpeg -i rtmp://localhost/live/drone1 -c copy -f flv rtmp://localhost/live/processed
ls /frames/
rm *.jpg
ls
[200~ffmpeg -i rtmp://localhost/live/drone1 -vf fps=2 /frames/frame_%03d.jpg~
ffmpeg -i rtmp://localhost/live/drone1 -vf fps=2 /frames/frame_%03d.jpg
ls /fr
pwd
cd
dir
ls /frames
ll
ll /frames
ffmpeg -rtmp_live live -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 2 -fflags +discardcorrupt -i rtmp://localhost/live/drone1 -vf fps=2 /frames/frame_%05d.jpg
while true; do   echo "Starting FFmpeg..."     ffmpeg -fflags +discardcorrupt   -i rtmp://localhost/live/drone1   -vf fps=2   /frames/frame_%05d.jpg   echo "FFmpeg crashed. Restarting in 2 seconds...";   sleep 2; done
df -h
pwd
ls
dir
cd ..
ls
df -h
cd /frames/
df -h
df
ls
rm *.jpg
ls
ps
while true; do   echo "Starting FFmpeg..."     ffmpeg -fflags +discardcorrupt   -i rtmp://localhost/live/drone1   -vf fps=2   /frames/frame_%05d.jpg   echo "FFmpeg crashed. Restarting in 2 seconds...";   sleep 2; done
ps
pkill ffmpeg
[200~ffmpeg -i rtmp://localhost/live/drone1 -vf fps=2 -update 1 /frames/frame_%03d.jpg~
ffmpeg -i rtmp://localhost/live/drone1 -vf fps=2 -update 1 /frames/frame_%03d.jpg
ls
scp root@157.245.125.103:/frames/frame_001.jpg "C:\Users\grant\Pictures"
scp root@157.245.125.103:/frames/frame_001.jpg C:\Users\grant\Pictures
scp root@157.245.125.103:/frames/frame_001.jpg C:\Users\grant
scp
scp -F
ssh
ssh_config
~/.ssh/config
cd .
cd ..
dir
~/.ssh/config
cd ~
~/.ssh/config
ls
dir
pwd
ifconfig
quit
bye
exit
ps
pkill ffmpeg
pkill nginx
/usr/local/nginx/sbin/nginx
ffmpeg -i rtmp://localhost/live/drone1 -c copy -f flv test.flv
ffmpeg -i test.flv -c copy test.mp4
ffmpeg -i test.mp4 -vf fps=2 frames/frame_%04d.jpg
ls
cd /frames
ls
chmod 755 frames
dir
pwd
cd ..
cdmod 755 frames
chmod 755 frames
df -h
cd frames
ls
rm *.jpg
ls
ffmpeg -i test.mp4 -vf fps=2 frames/frame_%04d.jpg
cd ..
ls
cd root/
ls
mkdir -p frames
chmod 755 frames
ffmpeg -i test.mp4 -vf fps=2 frames/frame_%04d.jpg
ls
cd frames/
ls
docker run -it --rm -v /frames:/data openalpr/openalpr -c us /data/frame_001.jpg
docker run -it --rm -v /frames:/data openalpr/openalpr -c us /frame_001.jpg
cd ..
docker run -it --rm -v /frames:/data openalpr/openalpr -c us /frame_001.jpg
docker run -it --rm -v /frames:/data openalpr/openalpr -c us /frame_0001.jpg
docker run -it --rm -v /frames:/data openalpr/openalpr -c us /data/frame_001.jpg
docker run -it --rm -v /frames:/data openalpr/openalpr -c us /data/frame_*.jpg
pwd
ls
cd frames/
ls
docker run -it --rm -v /frames:/data openalpr/openalpr -c us /data/frame_*.jpg
docker run -it --rm -v /frames:/data openalpr/openalpr -c us /frame_*.jpg
pwd
docker run -it --rm -v /root/frames:/data openalpr/openalpr -c us /data/frame_0001.jpg
ffmpeg -i test.mp4 -vf "crop=600:200:100:300" cropped_%03d.jpg
ls
cd ..
ls
ffmpeg -i test.mp4 -vf "crop=600:200:100:300" cropped_%03d.jpg
ls
ffmpeg -i test.mp4 -q:v 2 frames/frame_%04d.jpg
docker run -it --rm -v /root/frames:/data openalpr/openalpr -c us /data/frame_0001.jpg
ls
df -h
nano nginx
ls
cd ..
ls
sudo nano /usr/local/nginx/conf/nginx.conf
sudo systemctl restart nginx
df -h
sudo systemctl start nginx
pwd
cd sbin
sudo systemctl start nginx
ls
grep ngi
ls *nig*
ls *ngi*
ls -l
restart
sudo start nginx
pkill nginx
/usr/local/nginx/sbin/nginx
ffmpeg -i rtmp://localhost/live/drone1
cd ..
pwd
ffmpeg -i rtmp://localhost/live/drone1 -c copy -f flv rtmp://localhost/live/stable
ffmpeg -i rtmp://localhost/live/drone1
ffmpeg -i rtmp://localhost/live/drone1 -c copy -f flv rtmp://localhost/live/stable
ffmpeg -i rtmp://localhost/live/stable -c copy -f segment -segment_time 10 -reset_timestamps 1 recording_%03d.mp4
ffmpeg -i rtmp://localhost/live/drone1
ffmpeg -i rtmp://localhost/live/stable -c copy -f segment -segment_time 10 -reset_timestamps 1 recording_%03d.mp4
ffmpeg -i recording_000.mp4 -vf fps=2 frames/frame_%04d.jpg
ffmpeg -i rtmp://localhost/live/drone1 -c copy -f flv rtmp://localhost/live/stable
ffmpeg -i rtmp://localhost/live/stable -c copy -f segment -segment_time 10 -reset_timestamps 1 recording_%03d.mp4
ffmpeg -fflags +genpts -i rtmp://localhost/live/drone1 -c copy -f flv rtmp://localhost/live/stable
exit
ffmpeg -i rtmp://localhost/live/stable -c copy -f segment -segment_time 10 -reset_timestamps 1 recording_%03d.mp4
while true; do   ffmpeg -i rtmp://localhost/live/drone1 -c copy -f flv rtmp://localhost/live/stable;   sleep 2; done
nano AA_Launch.py
ls
ll
git init
nano .gitignore
nano notes
ffmpeg -i rtmp://localhost/live/stable
ffmpeg -loglevel verbose -i rtmp://localhost/live/drone1
mkdir ambers-angels
mv *.sh *.py *.conf *.md ambers-angels 2>/dev/null
cd ambers-angels/
ls
cd ..
ls
pwd
cd ..
ls
cd sbin
ls ng
ls
cd ..
ls
cd /usr/local/nginx/sbin/nginx
cd /usr/local/nginx/sbin/
ls
cp nginx /root/ambers-angels/
cd /root/ambers-angels/
ls
nano nginx 
sudo nano nginx 
ls -l
mv nginx nginx.conf
sudo nano nginx 
cd /usr/local/nginx/sbin/
sudo nano nginx 
pkill nginx 
sudo nano nginx 
cd root
cd /root
ls
cd ambers-angels/
nano GPS.py
nano multiDrone.json
ls
rm nginx.conf 
ls
nano croptop.py
ls
nano notes
git add .
git commit -m "Initial commit - RTMP ingest, recording, and ALPR pipeline working"
git config --global user.email grant.m.lindberg@googlemail.com
git config --global user.name Grant Lindberg
git commit -m "Initial commit - RTMP ingest, recording, and ALPR pipeline working"
git remote add origin https://github.com/grantl12/ambers-angels.git
git branch -M main
git push -u origin main
la -al ~/.ssh
pwd
cd /root
ssh-keygen
ssh-keygen -t ed25519 -C "grant.m.lindberg@googlemail.com"
curl http://127.0.0.1:8000/latest-telemetry/drone1
pwd
cd ambers-angels/
ls
mkdir scripts
ls
cd scripts/
nano start_all.sh
nano stop_all.sh
mkdir -p /root/ambers-angels/scripts
chmod +x /root/ambers-angels/scripts/start_all.sh 
chmod +x /root/ambers-angels/scripts/stop_all.sh 
stop_all.sh
./stop_all.sh 
./start_all.sh 
tail -f /root/ambers-angels/logs/api.log 
tail -f /root/ambers-angels/logs/gps_sender.log 
./stop_all.sh 
./start_all.sh 
tail -f /root/ambers-angels/logs/api.log 
tail -f /root/ambers-angels/logs/gps_sender.log 
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/latest-telemetry/drone1
ls
cd /root
ls
cd frames/
ls
ls -l
cd ..
systemctl status nginx
ffprobe rtmp://127.0.0.1/live/drone1
ffprobe rtmp://157.145.125.103/live/drone1
cat /etc/nginx/nginx.conf 
sudo nano /etc/nginx/nginx.conf 
mv /etc/nginx/nginx.conf /etc/nginx/nginx.conf.old
rm /etc/nginx/nginx.conf 
sudo nano /etc/nginx/nginx.conf 
sudo nano /etc/nginx/sites-available/telemetry 
sudo mkdir -p /var/www/telemetry
sudo cp /root/ambers-angels/pilot/telemetry.html /var/www/telemetry/
sudo rm -f /etc/nginx/sites-enabled/default 
sudo ln -sf /etc/nginx/sites-available/telemetry /etc/nginx/sites-enabled/telemetry 
sudo nginx -t
sudo nano /etc/nginx/nginx.conf 
nginx -V 2>&1
sudo apt update
sudo apt install -y libnginx-mod-rtmp
ls /usr/lib/nginx/modules | grep rtmp
sudo nano /etc/nginx/nginx.conf 
sudo nginx -t
sudo systemctl restart nginx
sudo ufw allow 80/tcp
sudo ufw allow 1935/tcp
curl http://127.0.0.1/
sudo systemctl start ufw
curl http://157.245.125.103/
curl http://127.0.0.1/api/health
curl http://157.245.125.103/api/health
ss -ltnp | grep 1935
ffprobe rtmp://127.0.0.1/live/drone1
cd ambers-angels/
cat notes
clear
ffmpeg -i rtmp://127.0.0.1/live/drone1 -vf fps=2 /root/frames/drone1/frame_%06d.jpg
cd ..
cd frames/
ls 
ls -l
rm *
ls
ffmpeg -i rtmp://127.0.0.1/live/drone1 -vf fps=2 /root/frames/drone1/frame_%06d.jpg
mkdir -p /root/frames/drone1
ffmpeg -i rtmp://127.0.0.1/live/drone1 -vf fps=2 /root/frames/drone1/frame_%06d.jpg
