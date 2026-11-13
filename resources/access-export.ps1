# Read-only export of an Access database, made by Access itself (BaseCraft import, batch E2).
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File access-export.ps1 -Source <path> -Out <folder>
#   stdin : one line, the database password (empty when there is none)
#   stdout: "step 0 0" (after the copy, before "pid <n>"), "pid <n>" once the Access instance is verified as the script's own,
#           "step 0 0" (after the database is opened; keep-alive lines, a total of 0 is no progress), "step 0 <total>" once the objects are counted,
#           "step <done> <total>" after each object, then "done"
#   manifest.json: a pass-through query's "connect" is only the part before its first ';' (its kind, e.g. ODBC): the rest can hold credentials.
#   exit  : 0 success, 2 Access not installed, 3 source cannot be opened, 1 anything else
#   stderr: one line, the reason (no path, no password)
#   "done" is the last line printed, only once the temporary folder is confirmed deleted (a folder that stays is exit 1).
#   Temporary folder: <Out>\..\src-<guid> (a decrypted copy of a protected source lives there). A caller that ends this
#   script before it exits (timeout) must delete <Out>\..\src-* itself, because `finally` does not run on a kill.
#   Only an Access instance this script started is used: one that already existed (or has a database open) is never touched.
param([string]$Source, [string]$Out)
$ErrorActionPreference = 'Stop'
try { [Console]::InputEncoding = New-Object Text.UTF8Encoding($false) } catch {}
$password = [Console]::In.ReadLine()
if ($null -eq $password) { $password = '' }

function Fail([int]$code, [string]$msg) { [Console]::Error.WriteLine($msg); exit $code }
function Write-Utf8([string]$path, [string]$text) {
  [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}
# SaveAsText writes UTF-16 (BOM) or the ANSI code page depending on the object: normalise to UTF-8 without BOM.
function Convert-ToUtf8([string]$path) {
  $b = [IO.File]::ReadAllBytes($path)
  if ($b.Length -ge 2 -and $b[0] -eq 0xFF -and $b[1] -eq 0xFE) { $t = [Text.Encoding]::Unicode.GetString($b, 2, $b.Length - 2) }
  elseif ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $t = [Text.Encoding]::UTF8.GetString($b, 3, $b.Length - 3) }
  else { $t = [Text.Encoding]::Default.GetString($b) }
  Write-Utf8 $path $t
}
function Prop($obj, [string]$name) { try { $obj.Properties.Item($name).Value } catch { $null } }
# Known literals first (case-insensitive: sources, folders, profile, work folder, password), then generic path shapes.
$lits = New-Object Collections.Generic.List[string]
function Add-Lit([string]$v) {
  if (-not $v) { return }
  $lits.Add($v); $lits.Add($v.Replace('\', '/'))
  try { $f = [IO.Path]::GetFullPath($v); $lits.Add($f); $lits.Add($f.Replace('\', '/')) } catch {}
  try { $pp = Split-Path -Parent $v; if ($pp) { $lits.Add($pp); $lits.Add($pp.Replace('\', '/')) } } catch {}
}
Add-Lit $Source; Add-Lit $Out; Add-Lit $env:USERPROFILE
function Clean([string]$m) {
  foreach ($l in ($lits | Sort-Object Length -Descending)) { $m = [regex]::Replace($m, [regex]::Escape($l), '<path>', 'IgnoreCase') }
  if ($password) { $m = [regex]::Replace($m, [regex]::Escape($password), '<hidden>') }
  $m = $m -replace '[A-Za-z]:[\\/][^"''<>|*?]*', '<path>' -replace '\\\\[^"''<>|*?]*', '<path>' -replace '[\\/]Users[\\/][^"''<>|*?]*', '<path>'
  $m -replace '\s+', ' '
}

if (-not [Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey('Access.Application')) { Fail 2 'Access is not installed' }

Add-Type -Namespace Win -Name U -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);'

$work = $null; $app = $null; $owned = $false; $dao = $null; $accessPid = 0; $code = 1; $reason = 'export failed'
try {
  if (-not $Source -or -not $Out) { throw 'missing argument' }
  $code = 3; $reason = 'the source cannot be opened'
  # DAO takes the password inside a ';'-separated string and Jet refuses a ';' in a password (NewPassword fails): not openable this way.
  if ($password.Contains(';')) { throw 'the password contains a semicolon' }
  $srcFull = (Resolve-Path -LiteralPath $Source).ProviderPath
  Add-Lit $srcFull
  $code = 1; $reason = 'the output folder cannot be used'
  $outFull = (Resolve-Path -LiteralPath $Out).ProviderPath
  Add-Lit $outFull
  $work = Join-Path (Split-Path -Parent $outFull) ('src-' + [guid]::NewGuid().ToString('N'))
  Add-Lit $work
  $ext = [IO.Path]::GetExtension($Source)
  $srcName = [IO.Path]::GetFileName($Source)
  $code = 1; $reason = 'export failed'
  New-Item -ItemType Directory $work | Out-Null
  $copy = Join-Path $work ('db' + $ext)
  Copy-Item -LiteralPath $srcFull -Destination $copy
  Write-Output 'step 0 0'
  # Never use an instance we did not start: snapshot the Access ids first, then check the one we got before changing anything.
  $before = @(Get-Process MSACCESS -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  try { $app = New-Object -ComObject Access.Application } catch { $code = 2; $reason = 'Access is not installed'; throw }
  [uint32]$p = 0
  [void][Win.U]::GetWindowThreadProcessId([IntPtr]$app.hWndAccessApp(), [ref]$p)
  $current = ''; try { $current = [string]$app.CurrentProject.FullName } catch {}
  if ($p -le 0 -or $before -contains [int]$p -or $current) {
    throw 'refused to use an Access instance that was already running'
  }
  $owned = $true   # verified as ours: only now may `finally` close or end it
  $accessPid = $p
  $app.Visible = $false
  $app.AutomationSecurity = 3   # msoAutomationSecurityForceDisable
  Write-Output "pid $accessPid"

  # Open the copy read-only through DAO: runs nothing of the source. CompactDatabase keeps a password, so the password
  # of our own copy is removed with NewPassword (exclusive open) before the read-only open.
  $code = 3; $reason = 'the source cannot be opened'
  if ($password -ne '') {
    $w = $app.DBEngine.OpenDatabase($copy, $true, $false, ";PWD=$password")
    $w.NewPassword($password, '')
    $w.Close()
    $w = $null
  }
  $password = $null
  $dao = $app.DBEngine.OpenDatabase($copy, $false, $true)
  Write-Output 'step 0 0'
  $code = 1; $reason = 'export failed'

  New-Item -ItemType Directory (Join-Path $Out 'queries'), (Join-Path $Out 'forms'), (Join-Path $Out 'reports'), (Join-Path $Out 'macros'), (Join-Path $Out 'modules') -Force | Out-Null

  # structure.json
  $fieldProps = 'Caption','Description','Format','InputMask','DecimalPlaces','TextFormat','DisplayControl','RowSourceType','RowSource','BoundColumn','ColumnCount','ColumnHeads','ColumnWidths','ListRows','ListWidth','LimitToList','AllowValueListEdits'
  $tables = New-Object Collections.Generic.List[object]
  foreach ($td in $dao.TableDefs) {
    $n = $td.Name
    if ($n -like 'MSys*' -or $n -like '~*' -or $td.Connect) { continue }
    $fields = New-Object Collections.Generic.List[object]
    foreach ($f in $td.Fields) {
      $props = [ordered]@{}
      foreach ($pn in $fieldProps) { $v = Prop $f $pn; if ($null -ne $v) { $props[$pn] = $v } }
      $fields.Add([ordered]@{ name = $f.Name; type = [int]$f.Type; size = [int]$f.Size; attributes = [int]$f.Attributes; required = [bool]$f.Required
        allowZeroLength = [bool]$f.AllowZeroLength; defaultValue = [string]$f.DefaultValue; validationRule = [string]$f.ValidationRule
        validationText = [string]$f.ValidationText; props = $props })
    }
    $indexes = New-Object Collections.Generic.List[object]
    foreach ($ix in $td.Indexes) {
      $ixf = New-Object Collections.Generic.List[object]
      foreach ($c in $ix.Fields) { $ixf.Add([ordered]@{ name = $c.Name; desc = [bool]([int]$c.Attributes -band 1) }) }
      $indexes.Add([ordered]@{ name = $ix.Name; primary = [bool]$ix.Primary; unique = [bool]$ix.Unique; foreign = [bool]$ix.Foreign; fields = $ixf })
    }
    $d = Prop $td 'Description'
    $tables.Add([ordered]@{ name = $n; validationRule = [string]$td.ValidationRule; validationText = [string]$td.ValidationText
      description = [string]$d; fields = $fields; indexes = $indexes })
  }
  Write-Utf8 (Join-Path $Out 'structure.json') (ConvertTo-Json ([ordered]@{ tables = $tables }) -Depth 12)

  # Objects to write: queries from DAO, the others through SaveAsText from a scratch base (the source is never current).
  $objects = New-Object Collections.Generic.List[object]
  $errors = New-Object Collections.Generic.List[object]
  $list = New-Object Collections.Generic.List[object]
  foreach ($q in $dao.QueryDefs) { if ($q.Name -notlike '~*') { $list.Add(@{ type = 'query'; name = $q.Name; q = $q }) } }
  $kinds = @(@('form', 'Forms', 2, 'forms', 'txt'), @('report', 'Reports', 3, 'reports', 'txt'), @('macro', 'Scripts', 4, 'macros', 'txt'), @('module', 'Modules', 5, 'modules', 'txt'))
  foreach ($k in $kinds) {
    foreach ($doc in $dao.Containers.Item($k[1]).Documents) { if ($doc.Name -notlike '~*') { $list.Add(@{ type = $k[0]; name = $doc.Name; k = $k }) } }
  }
  $scratch = $false
  $done = 0; $total = $list.Count; $seq = @{}
  Write-Output "step 0 $total"
  foreach ($o in $list) {
    $type = $o.type; $name = $o.name
    $seq[$type] = 1 + [int]$seq[$type]
    try {
      if ($type -eq 'query') {
        $file = "queries/$($seq[$type]).sql"
        Write-Utf8 (Join-Path $Out $file) ([string]$o.q.SQL)
        $objects.Add([ordered]@{ type = $type; name = $name; file = $file; queryType = [int]$o.q.Type; connect = ([string]$o.q.Connect).Split(';')[0]; returnsRecords = [bool]$o.q.ReturnsRecords })
      } else {
        if (-not $scratch) { $app.NewCurrentDatabase((Join-Path $work 'scratch.accdb')); $scratch = $true }
        $k = $o.k
        $app.DoCmd.TransferDatabase(0, 'Microsoft Access', $copy, $k[2], $name, $name)
        $file = "$($k[3])/$($seq[$type]).$($k[4])"
        $app.SaveAsText($k[2], $name, (Join-Path $Out $file))
        Convert-ToUtf8 (Join-Path $Out $file)
        $objects.Add([ordered]@{ type = $type; name = $name; file = $file })
      }
    } catch {
      $errors.Add([ordered]@{ type = $type; name = $name; message = (Clean $_.Exception.Message) })
    }
    $done++
    Write-Output "step $done $total"
  }
  Write-Utf8 (Join-Path $Out 'manifest.json') (ConvertTo-Json ([ordered]@{ format = 1; accessVersion = [string]$app.Version; source = $srcName
    objects = $objects; errors = $errors }) -Depth 12)
  $code = 0
} catch {
  if ($code -eq 0) { $code = 1 }
  if ($code -ne 2) { $reason = $reason + ': ' + (Clean $_.Exception.Message) }
} finally {
  $dao = $null; $o = $null; $list = $null; $f = $null; $td = $null; $q = $null
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  if ($app -and $owned) {
    try { $app.CloseCurrentDatabase() } catch {}
    try { $app.Quit(2) } catch {}
    # no ReleaseComObject: it can block once Access is shutting down; the wait below covers the exit
  }
  $app = $null
  if ($accessPid -gt 0) {   # our own instance only: wait for it to exit, end it by id if it lingers
    $pr = Get-Process -Id $accessPid -ErrorAction SilentlyContinue
    try { if ($pr -and -not $pr.WaitForExit(15000)) { $pr.Kill(); $pr.WaitForExit(5000) | Out-Null } } catch {}   # may exit in between
  }
  if ($work) {
    for ($i = 0; $i -lt 10 -and (Test-Path -LiteralPath $work); $i++) {
      Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
      if (Test-Path -LiteralPath $work) { Start-Sleep -Milliseconds 300 }
    }
    if (Test-Path -LiteralPath $work) { $code = 1; $reason = 'the temporary folder could not be removed' }
  }
}
if ($code -ne 0) { Fail $code $reason }
Write-Output 'done'
exit 0
