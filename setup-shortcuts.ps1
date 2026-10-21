$wsh = New-Object -ComObject WScript.Shell

# Desktop Shortcuts
$desktop = [Environment]::GetFolderPath('Desktop')
$exePath = "C:\Users\Administrator\Desktop\HyperClip\HyperClip.exe"
$workDir = "C:\Users\Administrator\Desktop\HyperClip"

foreach ($name in @("HyperClip.lnk", "HyperClip v3.lnk")) {
    $lnkPath = Join-Path $desktop $name
    $sc = $wsh.CreateShortcut($lnkPath)
    $sc.TargetPath = "wscript.exe"
    $sc.Arguments = "`"C:\Users\Administrator\Desktop\HyperClip\HyperClip-Launcher.vbs`""
    $sc.WorkingDirectory = $workDir
    $sc.IconLocation = "$exePath,0"
    $sc.Description = "HyperClip - Video Dai"
    $sc.Save()
    Write-Host "Configured launcher shortcut: $lnkPath"
}
