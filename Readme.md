#Tab S8
cd "/sdcard/Projects/crawl-vod";  git checkout sources ;  

python server.py -source javtiful -domain javtiful.com -detail-threads 1 -news-threads 1 -port 5004 -proxy-threads 7 -chunk_size 512KB -max_connections 30 -max_keepalive 10 -timeout "connect=3.0,read=None"  &

python server.py -source missav -domain missav.ws -detail-threads 1 -news-threads 1 -port 5003 -proxy-threads 7 -chunk_size 512KB -max_connections 30 -max_keepalive 10 -timeout "connect=3.0,read=None"  &

python server.py -source vlxx -domain vlxx.moi -detail-threads 1 -news-threads 1 -port 5002 -proxy-threads 7 -chunk_size 512KB -max_connections 30 -max_keepalive 10 -timeout "connect=3.0,read=None"  &

python server.py -source sextop1 -domain sextop1.cool -detail-threads 1 -news-threads 1 -port 5001 -proxy-threads 7 -chunk_size 512KB -max_connections 30 -max_keepalive 10 -timeout "connect=3.0,read=None" &
