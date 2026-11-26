Set oShell = CreateObject("WScript.Shell")
oShell.CurrentDirectory = "C:\Users\Administrator\Desktop\HyperClip"
oShell.Environment("Process")("HYPERCLIP_DATA_DIR") = "C:\Users\Administrator\Desktop\HyperClip\HyperClip-Data"
oShell.Environment("Process")("HYPERCLIPB_DATA_DIR") = "C:\Users\Administrator\Desktop\HyperClip\HyperClip-Data"
oShell.Environment("Process")("HYPERCLIP_EDITION") = "long"

' 1. Khoi chay trinh theo doi dong ung dung tu dong don dep (an hoan toan)
oShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\Administrator\Desktop\HyperClip\watch-shutdown.ps1""", 0, False

' 2. Tu dong dong bo nhe ho so AdsPower truoc khi mo app (cap nhat ID + them profile moi tao, toi da ~1.5s)
If oShell.Environment("Process")("HYPERCLIP_NO_SYNC") <> "1" Then
    oShell.Run """C:\Users\Administrator\Desktop\HyperClip\app\_internal\resources\node\node.exe"" ""C:\Users\Administrator\Desktop\HyperClip\tools\sync_adspower.js"" --startup --quiet", 0, True
End If

' 3. Khoi dong HyperClip truc tiep (giao dien UI binh thuong, khong hien CMD)
oShell.Run """C:\Users\Administrator\Desktop\HyperClip\app\HyperClip.exe""", 1, False
