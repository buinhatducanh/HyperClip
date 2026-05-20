Get-ChildItem -Path "$env:APPDATA" -Filter "hyperclip.log" -Recurse -ErrorAction SilentlyContinue | Select-Object FullName, Length, LastWriteTime
Get-ChildItem -Path "$env:LOCALAPPDATA" -Filter "hyperclip.log" -Recurse -ErrorAction SilentlyContinue | Select-Object FullName, Length, LastWriteTime
Get-ChildItem -Path "$env:USERPROFILE" -Filter "hyperclip.log" -Recurse -ErrorAction SilentlyContinue | Select-Object FullName, Length, LastWriteTime
