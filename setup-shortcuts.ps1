$wsh = New-Object -ComObject WScript.Shell

# Desktop Shortcuts
$desktop = [Environment]::GetFolderPath('Desktop')
$exePath = "C:\Users\Administrator\Desktop\HyperClip\HyperClip.exe"
$workDir = "C:\Users\Administrator\Desktop\HyperClip"

$icoPath = "C:\Users\Administrator\Desktop\HyperClip\app\_internal\resources\icon.ico"
foreach ($name in @("HyperClip.lnk", "HyperClip v3.lnk")) {
    $lnkPath = Join-Path $desktop $name
    $sc = $wsh.CreateShortcut($lnkPath)
    $sc.TargetPath = $exePath
    $sc.Arguments = ""
    $sc.WorkingDirectory = $workDir
    $sc.IconLocation = "$icoPath,0"
    $sc.Description = "HyperClip - Video Dai"
    $sc.Save()
    Write-Host "Configured native shortcut: $lnkPath -> $exePath"
}
