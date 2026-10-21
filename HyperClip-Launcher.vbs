Set oShell = CreateObject("WScript.Shell")
oShell.CurrentDirectory = "C:\Users\Administrator\Desktop\HyperClip"
oShell.Environment("Process")("HYPERCLIP_DATA_DIR") = "C:\Users\Administrator\Desktop\HyperClip\HyperClip-Data"
oShell.Environment("Process")("HYPERCLIPB_DATA_DIR") = "C:\Users\Administrator\Desktop\HyperClip\HyperClip-Data"
oShell.Environment("Process")("HYPERCLIP_EDITION") = "long"

' 1. Khoi chay trinh theo doi dong ung dung tu dong don dep (an hoan toan)
oShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\Administrator\Desktop\HyperClip\watch-shutdown.ps1""", 0, False

' 2. Khoi dong HyperClip truc tiep (giao dien UI binh thuong, khong hien CMD)
oShell.Run """C:\Users\Administrator\Desktop\HyperClip\HyperClip.exe""", 1, False
