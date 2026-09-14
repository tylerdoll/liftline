"""Local emulator; no AWS credentials or remote endpoint are used."""
from moto.server import ThreadedMotoServer
import time
server = ThreadedMotoServer(ip_address="127.0.0.1", port=5000, verbose=False)
server.start()
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    server.stop()
