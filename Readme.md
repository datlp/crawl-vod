# Termux

```bash
# server
cd "/sdcard/Projects/crawl-vod"; git pull; 

python server.py -port 5004 -source javtiful -domain javtiful.com \ 
-detail-threads 1 -news-threads 1 -proxy-threads 7 \ 
-chunk_size 512KB -max_connections 30 -max_keepalive 10 \
 -timeout "connect=3.0,read=None" &

python server.py -port 5003 -source missav -domain missav.ws \ 
-detail-threads 1 -news-threads 1 -proxy-threads 7 \ 
-chunk_size 512KB -max_connections 30 -max_keepalive 10 \
 -timeout "connect=3.0,read=None" &

python server.py -port 5001 -source sextop1 -domain sextop1.cool \ 
-detail-threads 1 -news-threads 1 -proxy-threads 7 \ 
-chunk_size 512KB -max_connections 30 -max_keepalive 10 \
 -timeout "connect=3.0,read=None" &

python server.py -port 5002 -source vlxx -domain vlxx.moi \ 
-detail-threads 1 -news-threads 1 -proxy-threads 7 \ 
-chunk_size 512KB -max_connections 30 -max_keepalive 10 \
 -timeout "connect=3.0,read=None" &

```

```bash
# crawl
cd "/sdcard/Projects/crawl-vod"; git pull; 


python crawl.py -api localhost:5004 -detail-threads 1 -news-threads 1 &
python crawl.py -api localhost:5003 -detail-threads 1 -news-threads 1 &
python crawl.py -api localhost:5001 -detail-threads 1 -news-threads 1 &
python crawl.py -api localhost:5002 -detail-threads 1 -news-threads 1 &

```

# Windows

```bash
cd "D:/Dat/Projects/crawl-vod"; git pull; 

python server.py -port 5004 -source javtiful -domain javtiful.com -chunk_size 512KB -max_connections 30 -max_keepalive 10 -timeout "connect=3.0,read=None" 
python crawl.py -api localhost:5004 -detail-threads 1 -news-threads 1 

python server.py -port 5003 -source missav -domain missav.ws -detail-threads 1 -news-threads 1 -proxy-threads 7 -chunk_size 512KB -max_connections 30 -max_keepalive 10 -timeout "connect=3.0,read=None" 
python crawl.py -api localhost:5003 -detail-threads 1 -news-threads 1 

python server.py -port 5001 -source sextop1 -domain sextop1.cool -detail-threads 1 -news-threads 1 -proxy-threads 7 -chunk_size 512KB -max_connections 30 -max_keepalive 10 -timeout "connect=3.0,read=None"
python crawl.py -api localhost:5001 -detail-threads 1 -news-threads 1

python server.py -port 5002 -source vlxx -domain vlxx.moi -detail-threads 1 -news-threads 1 -proxy-threads 7 -chunk_size 512KB -max_connections 30 -max_keepalive 10 -timeout "connect=3.0,read=None" 
python crawl.py -api localhost:5002 -detail-threads 1 -news-threads 1

```