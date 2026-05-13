Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.OwningProcess -in @(20136,14204,24996,24180,23684) } |
  Select-Object LocalAddress, LocalPort, OwningProcess |
  Format-Table -AutoSize
