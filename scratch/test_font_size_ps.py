import subprocess
import re

canvas_w = 1080
bottom_bar_h = 576 # For 1080p short mode (canvas_h = 1920, 3/10 is 576)

test_cases = [
    "Short",
    "Medium Length Title",
    "A Much Longer Video Title That Might Wrap",
    "This Is An Extremely Long Video Title That Definitely Needs To Be Scaled Down Significant",
    "PART 1: Konnor Griffin Highlights"
]

for title in test_cases:
    ps_script = f"""
    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap({canvas_w}, {bottom_bar_h})
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $fontSize = [Math]::Max(36, [int]({bottom_bar_h} * 0.35))
    $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
    while ($fontSize -gt 8) {{
        $size = $g.MeasureString("{title}", $font)
        if ($size.Width -le ({canvas_w} * 0.95) -and $size.Height -le {bottom_bar_h}) {{
            break
        }}
        $font.Dispose()
        $fontSize -= 2
        $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
    }}
    Write-Output "title='{title}' len=$("{title}".Length) size=$fontSize width=$($size.Width)"
    $font.Dispose()
    $g.Dispose()
    $bmp.Dispose()
    """
    cmd = ["powershell", "-NoProfile", "-Command", ps_script]
    result = subprocess.run(cmd, capture_output=True, text=True)
    print(result.stdout.strip())
