# Test helper: builds an Access front-end that links Clients and Commandes (as Cdes) of a back-end and holds one saved query and one
# small local table (left out with -NoLocal). Only an Access instance this script starts is used, ended by process id if it hangs. Never commit the output.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests/helpers/make-access-front-end.ps1 -BackEnd <accdb> -Out <accdb> [-Timeout 300] [-NoLocal]
param([Parameter(Mandatory)][string]$BackEnd, [Parameter(Mandatory)][string]$Out, [int]$Timeout = 300, [switch]$NoLocal)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Win -Name U -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);'
$app = $null; $accessPid = 0; $watch = $null
try {
  $before = @(Get-Process MSACCESS -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $app = New-Object -ComObject Access.Application
  [uint32]$p = 0
  [void][Win.U]::GetWindowThreadProcessId([IntPtr]$app.hWndAccessApp(), [ref]$p)
  $current = ''; try { $current = [string]$app.CurrentProject.FullName } catch {}
  if ($p -le 0 -or $before -contains [int]$p -or $current) { throw 'refused to use an Access instance that was already running' }
  $accessPid = $p
  $app.Visible = $false
  $app.AutomationSecurity = 3
  # watchdog: ends our own instance (only) if the script is stuck in a COM call
  $watch = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile', '-Command', "Start-Sleep $Timeout; Stop-Process -Id $accessPid -Force -ErrorAction SilentlyContinue"
  if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Force }
  $app.NewCurrentDatabase($Out)
  $app.DoCmd.TransferDatabase(2, 'Microsoft Access', $BackEnd, 0, 'Clients', 'Clients')
  $app.DoCmd.TransferDatabase(2, 'Microsoft Access', $BackEnd, 0, 'Commandes', 'Cdes')
  if (-not $NoLocal) { $app.CurrentDb().Execute('CREATE TABLE Locale (Libelle TEXT(50))') }
  [void]$app.CurrentDb().CreateQueryDef('QLiee', 'SELECT Nom, Ville FROM Clients;')
  Write-Output 'done'
} finally {
  if ($app -and $accessPid -gt 0) {
    try { $app.CloseCurrentDatabase() } catch {}
    try { $app.Quit(2) } catch {}
    # no ReleaseComObject: it can block once Access is shutting down; wait for our own instance to exit instead
    $pr = Get-Process -Id $accessPid -ErrorAction SilentlyContinue
    try { if ($pr -and -not $pr.WaitForExit(15000)) { $pr.Kill() } } catch {}
  }
  if ($watch) { try { $watch.Kill() } catch {} }
}
