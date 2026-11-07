# Dev helper: drive the running plugin via deep links.
#   ./scripts/deck.ps1 restart | open | snapshot | press <col> <row> [long]
param([string]$cmd = "snapshot", [string]$c = "0", [int]$r = 0, [string]$long = "")
$base = "streamdeck://plugins/message/com.evanw.discordvoice"
switch ($cmd) {
  "restart" {
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*discordvoice.sdPlugin*' -and $_.Name -eq 'node.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  }
  "open" { Start-Process "$base/open" }
  "favorites" { Start-Process "$base/favorites?ids=$c" }
  "snapshot" { Start-Process "$base/snapshot" }
  "press" { $l = if ($long) { "&long=1" } else { "" }; Start-Process "$base/press?c=$c&r=$r$l" }
}
