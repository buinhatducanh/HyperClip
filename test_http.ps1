try {
  $r = [Net.HttpWebRequest]::Create('http://localhost:3000/')
  $r.Method = 'HEAD'
  $resp = $r.GetResponse()
  Write-Host "Status:" $resp.StatusCode
  $resp.Close()
} catch {
  Write-Host "Error:" $_.Exception.Message
}
