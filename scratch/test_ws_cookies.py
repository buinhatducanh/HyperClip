import socket
import urllib.request
import json
import urllib.parse
import base64
import os

def handshake(ws_url):
    parsed = urllib.parse.urlparse(ws_url)
    host = parsed.netloc
    path = parsed.path
    if parsed.query:
        path += "?" + parsed.query
        
    parts = host.split(":")
    ip = parts[0]
    port = int(parts[1]) if len(parts) > 1 else 80
    
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect((ip, port))
    
    req = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    s.sendall(req.encode('utf-8'))
    
    # Read response headers
    resp = b""
    while b"\r\n\r\n" not in resp:
        chunk = s.recv(1024)
        if not chunk:
            break
        resp += chunk
        
    headers, body = resp.split(b"\r\n\r\n", 1)
    print("Handshake Response Headers:\n", headers.decode())
    return s, body

def send_ws_text(s, text):
    payload = text.encode('utf-8')
    length = len(payload)
    
    # Header: FIN=1, Opcode=1 (text)
    header = bytearray([0x81])
    
    # Mask bit is 1 for client frames, length
    if length <= 125:
        header.append(0x80 | length)
    elif length <= 65535:
        header.append(0x80 | 126)
        header.extend(length.to_bytes(2, byteorder='big'))
    else:
        header.append(0x80 | 127)
        header.extend(length.to_bytes(8, byteorder='big'))
        
    # Mask key: use 0, 0, 0, 0 (no-op mask)
    mask = bytearray([0, 0, 0, 0])
    header.extend(mask)
    
    s.sendall(header + payload)

def read_ws_frame(s, initial_body=b""):
    buf = initial_body
    
    def read_exact(n):
        nonlocal buf
        while len(buf) < n:
            chunk = s.recv(4096)
            if not chunk:
                raise EOFError("Connection closed")
            buf += chunk
        res = buf[:n]
        buf = buf[n:]
        return res
        
    # Read first 2 bytes
    hdr = read_exact(2)
    opcode = hdr[0] & 0x0F
    is_masked = (hdr[1] & 0x80) != 0
    length = hdr[1] & 0x7F
    
    if length == 126:
        len_bytes = read_exact(2)
        length = int.from_bytes(len_bytes, byteorder='big')
    elif length == 127:
        len_bytes = read_exact(8)
        length = int.from_bytes(len_bytes, byteorder='big')
        
    if is_masked:
        mask = read_exact(4)
    else:
        mask = None
        
    payload = read_exact(length)
    if mask:
        payload = bytearray(payload)
        for i in range(len(payload)):
            payload[i] ^= mask[i % 4]
            
    return opcode, payload, buf

def main():
    # 1. Get browser WebSocket URL
    with urllib.request.urlopen("http://127.0.0.1:9222/json/version") as response:
        data = json.loads(response.read().decode())
    ws_url = data["webSocketDebuggerUrl"]
    print("Connecting to:", ws_url)
    
    s, initial_body = handshake(ws_url)
    
    # 2. Send command: Storage.getCookies
    cmd = {"id": 1, "method": "Storage.getCookies"}
    send_ws_text(s, json.dumps(cmd))
    
    # 3. Read response frame
    opcode, payload, rest = read_ws_frame(s, initial_body)
    resp_text = payload.decode('utf-8')
    print("Received WS Frame:")
    resp_json = json.loads(resp_text)
    print(json.dumps(resp_json, indent=2)[:1000]) # Print first 1000 chars

if __name__ == "__main__":
    main()
