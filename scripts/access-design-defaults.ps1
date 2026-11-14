# Dev tool (not shipped), E4: measures in the installed Microsoft Access what SaveAsText leaves out of a form or report.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/access-design-defaults.ps1 [-Timeout 600]
# Writes src/shared/access-design-defaults.ts (built-in defaults per block type) and
# tests/fixtures/access/Ventes-complet.props.json (the fixture's truth, read through the object model).
# Method: see "Measure" below. Only an Access instance this script starts is used, ended by process id if it hangs.
param(
  [string]$Fixture = (Join-Path $PSScriptRoot '..\tests\fixtures\access\Ventes-complet.accdb'),
  [string]$OutTs = (Join-Path $PSScriptRoot '..\src\shared\access-design-defaults.ts'),
  [string]$OutJson = (Join-Path $PSScriptRoot '..\tests\fixtures\access\Ventes-complet.props.json'),
  [int]$Timeout = 600
)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Win -Name U -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);'
$inv = [Globalization.CultureInfo]::InvariantCulture
$M = [Type]::Missing

# SaveAsText names, as the brief lists them. SaveAsText name -> object-model name where they differ (filled from the probe).
$names = 'Left Top Width Height Visible Enabled Locked TabStop TabIndex BackStyle BackColor OldBorderStyle BorderLineStyle BorderWidth BorderColor ForeColor FontName FontSize FontWeight FontItalic FontUnderline TextAlign CanGrow CanShrink KeepTogether RepeatSection ForceNewPage LeftMargin TopMargin RightMargin BottomMargin LeftPadding TopPadding RightPadding BottomPadding GridlineStyleLeft GridlineStyleTop GridlineStyleRight GridlineStyleBottom GridlineWidthLeft GridlineWidthTop GridlineWidthRight GridlineWidthBottom GridlineColor HorizontalAnchor VerticalAnchor DefaultView NavigationButtons RecordSelectors AllowAdditions AllowEdits AllowDeletions ColumnCount ColumnHeads BoundColumn LimitToList DecimalPlaces SizeMode PictureAlignment LineSlant GroupHeader GroupFooter SortOrder GroupOn GroupInterval'.Split(' ')
# Pairs (SaveAsText name -> object-model name), found by setting each property through the object model and diffing SaveAsText:
#   controls: OldBorderStyle = BorderStyle (0 transparent, 1 solid, 2 dashes ... 8 double solid), BorderLineStyle = BorderLineStyle
#   (0 solid, 1 dashes ... 7 double; it is remembered while the border is transparent). A form or report writes BorderStyle itself.
# Every other listed name is the same in both.
$alias = @{ OldBorderStyle = 'BorderStyle' }

function Num($v) {
  if ($v -is [bool]) { return [int]$v }
  if ($v -is [string]) { return $v }
  if ($v -is [ValueType] -and $v -isnot [datetime]) { return $v }
  $null
}
function Get-One($o, [string]$n, [bool]$isForm) {
  $on = if ($alias.ContainsKey($n) -and -not $isForm) { $alias[$n] } else { $n }
  try { return Num $o.Properties.Item($on).Value } catch {}
  try { return Num ([System.__ComObject].InvokeMember($on, 'GetProperty', $null, $o, $null)) } catch {}
  $null
}
function Indexed($o, [string]$prop, [int]$i) { if ($prop -eq 'Section') { ,$o.Section($i) } else { ,$o.GroupLevel($i) } }
function Read-Props($o, [bool]$isForm = $false) {
  $r = [ordered]@{}
  foreach ($n in $(if ($isForm) { $names -replace '^OldBorderStyle$', 'BorderStyle' } else { $names })) { $v = Get-One $o $n $isForm; if ($null -ne $v) { $r[$n] = $v } }
  $r
}

$resolveTs = @'
/** The value of `name` for a block: its own, else the form's default block of its type, else ACCESS_DEFAULTS; `NotDefault` is the
 *  opposite of what the fallbacks give. undefined when nobody knows. */
export function resolveAccess(block: AccessBlock, name: string, defaults: ReadonlyMap<string, AccessBlock>): number | string | undefined {
  const flip = (v: number | string | undefined) => (typeof v === 'number' ? 1 - v : undefined)
  const table = Object.hasOwn(ACCESS_DEFAULTS, block.type) ? ACCESS_DEFAULTS[block.type] : undefined
  const builtin = table && Object.hasOwn(table, name) ? table[name] : undefined
  const own = block.props.get(name)
  if (typeof own === 'number' || typeof own === 'string') return own
  if (typeof own === 'object' && 'lines' in own) return undefined
  const inherited = defaults.get(block.type)?.props.get(name)
  let fallback: number | string | undefined = builtin
  if (typeof inherited === 'number' || typeof inherited === 'string') fallback = inherited
  else if (typeof inherited === 'object' && 'notDefault' in inherited) fallback = flip(builtin)
  else if (typeof inherited === 'object' && !own) return undefined
  return own ? flip(fallback) : fallback
}
'@

$tmp = Join-Path $env:TEMP ('e4defaults-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $tmp | Out-Null
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
  Write-Output "pid $accessPid"
  # watchdog: ends our own instance (only) if the script is stuck in a COM call
  $watch = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile', '-Command', "Start-Sleep $Timeout; Stop-Process -Id $accessPid -Force -ErrorAction SilentlyContinue"
  $version = [string]$app.Version

  # --- Measure 1: built-in defaults. One scratch object per block type, loaded from a text that holds the block with only its Name
  # (no default blocks, no position), opened hidden in Design view; every property of the list is then read from it.
  $app.NewCurrentDatabase((Join-Path $tmp 'scratch.accdb'))
  $textOf = @{ Form = 2; Report = 3 }
  function Load-Text([string]$kind, [string]$name, [string]$body) {
    $f = Join-Path $tmp 'x.txt'
    [IO.File]::WriteAllText($f, "Version =21`nVersionRequired =20`nBegin $kind`n$body`nEnd`n", [Text.Encoding]::Unicode)
    $app.LoadFromText($textOf[$kind], $name, $f)
  }
  function Open-Obj([string]$kind, [string]$name) {
    if ($kind -eq 'Form') { $app.DoCmd.OpenForm($name, 1, $M, $M, $M, 1); (,$app.Forms.Item($name)) }
    else { $app.DoCmd.OpenReport($name, 1, $M, $M, 1); (,$app.Reports.Item($name)) }
  }
  function Close-Obj([string]$kind, [string]$name) { $app.DoCmd.Close($(if ($kind -eq 'Form') { 2 } else { 3 }), $name, 2) }

  $defaults = @{ Form = [ordered]@{}; Report = [ordered]@{} }   # kind -> type -> props
  $controlTypes = @{}                                            # ControlType number -> block type
  $ctl = 'Label', 'TextBox', 'ComboBox', 'ListBox', 'CheckBox', 'ToggleButton', 'CommandButton', 'Image', 'Line', 'Rectangle', 'PageBreak', 'Subform', 'OptionGroup', 'Tab', 'Attachment', 'EmptyCell', 'BoundObjectFrame', 'UnboundObjectFrame', 'Chart', 'CustomControl', 'Edge', 'ModernChart', 'NavigationControl', 'WebBrowser'
  $nested = @{ OptionGroup = @('OptionButton'); Tab = @('Page'); NavigationControl = @('NavigationButton') }
  foreach ($kind in 'Form', 'Report') {
    # the object itself, with every section type it can have
    $secs = if ($kind -eq 'Form') { @('FormHeader', 'Section', 'FormFooter') } else { @('FormHeader', 'PageHeader', 'BreakHeader', 'Section', 'BreakFooter', 'PageFooter', 'FormFooter') }
    $body = " Begin`n"
    if ($kind -eq 'Report') { $body += "  Begin BreakLevel`n   ControlSource =`"X`"`n  End`n" }
    foreach ($s in $secs) { $body += "  Begin $s`n   Name =`"S_$s`"`n  End`n" }
    $body += " End"
    Load-Text $kind "M_$kind" $body
    $o = Open-Obj $kind "M_$kind"
    $defaults[$kind][$kind] = Read-Props $o $true
    $defaults[$kind][$kind].Remove('Visible')   # the window's, hidden here: not the property of the text
    $idx = if ($kind -eq 'Form') { @{ FormHeader = 1; Section = 0; FormFooter = 2 } } else { @{ Section = 0; FormHeader = 1; FormFooter = 2; PageHeader = 3; PageFooter = 4; BreakHeader = 5; BreakFooter = 6 } }
    foreach ($s in $secs) { $defaults[$kind][$s] = Read-Props (Indexed $o 'Section' $idx[$s]) }
    if ($kind -eq 'Report') {
      $gl = Indexed $o 'GroupLevel' 0
      $defaults[$kind]['BreakLevel'] = Read-Props $gl
    }
    Close-Obj $kind "M_$kind"
    foreach ($t in $ctl) {
      $inner = "Begin $t`n Name =`"C`"`n End"
      foreach ($c in $nested[$t]) { $inner = "Begin $t`n Name =`"C`"`n Begin`n Begin $c`n Name =`"C2`"`n End`n End`n End" }
      Load-Text $kind "M_${kind}_$t" " Begin`n Begin Section`n Name =`"S`"`n Begin`n $inner`n End`n End`n End"
      $o = Open-Obj $kind "M_${kind}_$t"
      $c = $o.Controls.Item('C')
      $defaults[$kind][$t] = Read-Props $c
      $controlTypes[[int]$c.ControlType] = $t
      foreach ($n in $nested[$t]) {
        $c2 = $o.Controls.Item('C2')
        $defaults[$kind][$n] = Read-Props $c2
        $controlTypes[[int]$c2.ControlType] = $n
      }
      Close-Obj $kind "M_${kind}_$t"
    }
  }
  $app.CloseCurrentDatabase()

  # --- Measure 2: the fixture's truth. The fixture is copied, its form and report imported into a scratch base (the source is never
  # current, nothing of it runs), opened hidden in Design view; the same properties are read from the object, its sections and controls.
  $copy = Join-Path $tmp 'fixture.accdb'
  Copy-Item -LiteralPath $Fixture -Destination $copy
  $app.NewCurrentDatabase((Join-Path $tmp 'truth.accdb'))
  $objects = New-Object Collections.Generic.List[object]
  foreach ($spec in @(@('Form', 2, 'FClients', 'form'), @('Report', 3, 'ECommandes', 'report'))) {
    $kind = $spec[0]
    $app.DoCmd.TransferDatabase(0, 'Microsoft Access', $copy, $spec[1], $spec[2], $spec[2])
    $o = Open-Obj $kind $spec[2]
    $entry = [ordered]@{ kind = $spec[3]; name = $spec[2]; props = (Read-Props $o $true) }
    $entry.props.Remove('Visible')
    if ($kind -eq 'Report') {
      $pr = $o.Printer   # numbers only: no printer or device name is read
      $pg = [ordered]@{}
      foreach ($k in 'Orientation', 'PaperSize', 'LeftMargin', 'TopMargin', 'RightMargin', 'BottomMargin', 'ItemsAcross') { $pg[$k.Substring(0, 1).ToLower() + $k.Substring(1)] = [int]$pr.$k }
      $entry.page = $pg
    }
    $sections = New-Object Collections.Generic.List[object]
    $groups = 0
    if ($kind -eq 'Report') { while ($groups -lt 10) { try { [void](Indexed $o 'GroupLevel' $groups) } catch { break }; $groups++ } }
    $max = 4 + 2 * $groups
    for ($i = 0; $i -le $max; $i++) {
      try { $s = Indexed $o 'Section' $i } catch { continue }
      $sections.Add([ordered]@{ name = [string]$s.Name; props = (Read-Props $s) })
    }
    if ($kind -eq 'Report') {
      for ($g = 0; $g -lt $groups; $g++) {
        $gl = Indexed $o 'GroupLevel' $g
        $sections.Add([ordered]@{ name = "BreakLevel$g"; props = (Read-Props $gl) })
      }
    }
    $controls = New-Object Collections.Generic.List[object]
    foreach ($c in $o.Controls) {
      $ct = [int]$c.ControlType
      $type = if ($controlTypes.ContainsKey($ct)) { $controlTypes[$ct] } else { "ControlType$ct" }
      $controls.Add([ordered]@{ name = [string]$c.Name; type = $type; props = (Read-Props $c) })
    }
    $entry.sections = $sections; $entry.controls = $controls
    $objects.Add($entry)
    Close-Obj $kind $spec[2]
  }
  $app.CloseCurrentDatabase()

  # --- Write the outputs
  # A block type measured in a form and in a report: the values must agree where both have the property (the report lacks some,
  # e.g. Locked and the anchors); the union is kept. A disagreement is printed and the form's value is kept.
  $merged = [ordered]@{}
  foreach ($t in ($defaults.Form.Keys + $defaults.Report.Keys | Sort-Object -Unique)) {
    $f = $defaults.Form[$t]; $r = $defaults.Report[$t]
    $m = [ordered]@{}
    if ($r) { foreach ($k in $r.Keys) { $m[$k] = $r[$k] } }
    if ($f) { foreach ($k in $f.Keys) { if ($m.Contains($k) -and "$($m[$k])" -ne "$($f[$k])") { Write-Output "form and report differ: $t.$k form $($f[$k]) report $($m[$k])" }; $m[$k] = $f[$k] } }
    $merged[$t] = $m
  }
  function Lit($v) { if ($v -is [string]) { ConvertTo-Json $v -Compress } else { [Convert]::ToString($v, $inv) } }
  $sb = New-Object Text.StringBuilder
  [void]$sb.AppendLine('// Generated by scripts/access-design-defaults.ps1 (Microsoft Access ' + $version + '): do not edit by hand.')
  [void]$sb.AppendLine("import type { AccessBlock } from './access-text'")
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('/** Per block type, per property name as SaveAsText writes it, the value of a property the text leaves out. Booleans are 0 or 1. */')
  [void]$sb.AppendLine('export const ACCESS_DEFAULTS: Readonly<Record<string, Readonly<Record<string, number | string>>>> = {')
  foreach ($t in $merged.Keys) {
    $key = if ($t -match '^[A-Za-z_]\w*$') { $t } else { "'$t'" }
    $items = @($merged[$t].Keys | ForEach-Object { "$_`: $(Lit $merged[$t][$_])" })
    [void]$sb.AppendLine("  ${key}: { $($items -join ', ') },")
  }
  [void]$sb.AppendLine('}')
  [void]$sb.AppendLine($resolveTs)
  $utf8 = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($OutTs, $sb.ToString().TrimEnd() + "`n", $utf8)
  [IO.File]::WriteAllText($OutJson, (ConvertTo-Json ([ordered]@{ accessVersion = $version; objects = $objects }) -Depth 8), $utf8)
  Write-Output 'done'
} finally {
  if ($app -and $accessPid -gt 0) {
    try { $app.CloseCurrentDatabase() } catch {}
    try { $app.Quit(2) } catch {}
    $pr = Get-Process -Id $accessPid -ErrorAction SilentlyContinue
    try { if ($pr -and -not $pr.WaitForExit(15000)) { $pr.Kill() } } catch {}
  }
  if ($watch) { try { $watch.Kill() } catch {} }
  for ($i = 0; $i -lt 10 -and (Test-Path -LiteralPath $tmp); $i++) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath $tmp) { Start-Sleep -Milliseconds 300 } }
}
