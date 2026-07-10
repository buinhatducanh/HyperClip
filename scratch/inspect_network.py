import os
import sys
import subprocess
import urllib.request
import json

print("=== Python Env ===")
print("Python:", sys.executable)
print("HTTP_PROXY:", os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy'))
print("HTTPS_PROXY:", os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy'))
print("ALL_PROXY:", os.environ.get('ALL_PROXY') or os.environ.get('all_proxy'))

print("\n=== Windows Proxy Settings (Registry) ===")
try:
    import winreg
    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
    proxy_enable, _ = winreg.QueryValueEx(key, "ProxyEnable")
    proxy_server, _ = winreg.QueryValueEx(key, "ProxyServer")
    print("ProxyEnable:", proxy_enable)
    print("ProxyServer:", proxy_server)
except Exception as e:
    print("Error reading registry proxy:", e)

print("\n=== Active Network Routes ===")
try:
    res = subprocess.run(["powershell", "-NoProfile", "-Command", "Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Format-Table -AutoSize"], capture_output=True, text=True)
    print(res.stdout)
except Exception as e:
    print("Error running Get-NetRoute:", e)

print("\n=== Network Adapters ===")
try:
    res = subprocess.run(["powershell", "-NoProfile", "-Command", "Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Format-Table -AutoSize"], capture_output=True, text=True)
    print(res.stdout)
except Exception as e:
    print("Error running Get-NetAdapter:", e)

print("\n=== IP Addresses ===")
try:
    res = subprocess.run(["powershell", "-NoProfile", "-Command", "Get-NetIPAddress -AddressFamily IPv4 | Select-Object InterfaceAlias, IPAddress | Format-Table -AutoSize"], capture_output=True, text=True)
    print(res.stdout)
except Exception as e:
    print("Error running Get-NetIPAddress:", e)
