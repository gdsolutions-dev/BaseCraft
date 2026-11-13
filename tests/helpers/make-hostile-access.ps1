# Builds a hostile Access base: its code writes a sentinel file as soon as it runs.
# It proves a property of the export (nothing of the source runs); it is generated on purpose.
param([Parameter(Mandatory)][string]$Out, [Parameter(Mandatory)][string]$Sentinel, [switch]$WeirdQuery, [switch]$Passthrough)
$ErrorActionPreference = 'Stop'
$tmp = Join-Path $env:TEMP ('hostile-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $tmp | Out-Null
$app = New-Object -ComObject Access.Application
$app.Visible = $false
Add-Type -Namespace Win -Name U -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);'
[uint32]$accessPid = 0
[void][Win.U]::GetWindowThreadProcessId([IntPtr]$app.hWndAccessApp(), [ref]$accessPid)
Write-Output "pid $accessPid"
try {
  if (Test-Path $Out) { Remove-Item $Out -Force }
  $app.NewCurrentDatabase($Out)
  $app.CurrentDb().Execute('CREATE TABLE T1 (Id LONG, Nom TEXT(50))')
  # the function must not be named like the file (the VBA project takes the file's name): Run/RunCode would not find it
  $sent = $Sentinel -replace '"', '""'
  $mod = "Option Compare Database`r`nOption Explicit`r`nPublic Function WriteSentinel()`r`n  Dim f As Integer`r`n  f = FreeFile`r`n  Open `"$sent`" For Output As #f`r`n  Print #f, `"ran`"`r`n  Close #f`r`nEnd Function`r`n"
  $form = "Version =21`r`nVersionRequired =20`r`nBegin Form`r`n    Width =4000`r`n    OnLoad =`"[Event Procedure]`"`r`n    Begin`r`n        Begin Section`r`n            Height =600`r`n        End`r`n    End`r`nEnd`r`nCodeBehindForm`r`nAttribute VB_Name = `"Form_Demarrage`"`r`nOption Compare Database`r`nOption Explicit`r`nPrivate Sub Form_Load()`r`n  WriteSentinel`r`nEnd Sub`r`n"
  $macro = "Version =196611`r`nColumnsShown =8`r`nBegin`r`n    Action =`"RunCode`"`r`n    Argument =`"WriteSentinel()`"`r`nEnd`r`nBegin`r`n    Action =`"MsgBox`"`r`n    Argument =`"hostile`"`r`nEnd`r`n"
  foreach ($x in @(@(5, 'ModHostile', $mod), @(2, 'Demarrage', $form), @(4, 'AutoExec', $macro))) {
    $f = Join-Path $tmp ($x[1] + '.txt')
    $enc = if ($x[0] -eq 5) { [Text.Encoding]::Default } else { New-Object Text.UnicodeEncoding($false, $true) }   # a module is loaded as ANSI text
    [IO.File]::WriteAllText($f, $x[2], $enc)
    $app.LoadFromText($x[0], $x[1], $f)
  }
  $db = $app.CurrentDb()
  $p = $db.CreateProperty('StartupForm', 10, 'Demarrage')
  $db.Properties.Append($p)
  if ($WeirdQuery) { $db.CreateQueryDef('a/b:c?', 'SELECT Id FROM T1') | Out-Null }
  if ($Passthrough) { $qd = $db.CreateQueryDef('PT', 'SELECT 1'); $qd.Connect = 'ODBC;DSN=x;UID=u;PWD=secret;'; $qd = $null }
} finally {
  $db = $null; $p = $null; [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  try { $app.CloseCurrentDatabase() } catch {}
  $app.Quit(2)
  # no ReleaseComObject: it can block once Access is shutting down; wait for our own instance to exit instead
  $pr = if ($accessPid -gt 0) { Get-Process -Id $accessPid -ErrorAction SilentlyContinue }
  if ($pr -and -not $pr.WaitForExit(15000)) { $pr.Kill() }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
