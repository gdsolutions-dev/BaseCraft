# Read-only ODBC reader for BaseCraft's External Data > Import > ODBC Database (Windows; Linux uses unixODBC's isql).
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File odbc.ps1
#   stdin : one UTF-8 JSON line: {"op":"dsns"} | {"op":"tables","connection":"<ODBC connection string>"}
#           | {"op":"read","connection":"...","schema":"<or empty>","table":"<a name 'tables' listed>"}
#           The connection string (login included) only travels on stdin, never on the command line.
#   stdout: one JSON value per line. dsns: ["name",...]. tables: [{"name":..,"schema":..},...].
#           read: first line {"columns":[{"name":..,"kind":"int|float|bool|date|text|longText|other","size":n}]}, then one JSON array
#           per row (null, or the value as text: dates "yyyy-MM-dd HH:mm:ss", numbers invariant, yes/no "1"/"0", binary null).
#   exit  : 0 success; 1 failure, one line on stderr (the driver's message).
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Web.Extensions
$json = New-Object Web.Script.Serialization.JavaScriptSerializer
$json.MaxJsonLength = [int]::MaxValue
$inv = [Globalization.CultureInfo]::InvariantCulture
function Out-Line($v) { [Console]::Out.WriteLine($json.Serialize($v)) }
function Kind([Type]$t, [int]$size) {
  switch ($t.FullName) {
    { $_ -in 'System.Int16', 'System.Int32', 'System.Byte', 'System.SByte', 'System.UInt16' } { return 'int' }
    { $_ -in 'System.Int64', 'System.UInt32', 'System.UInt64', 'System.Decimal', 'System.Single', 'System.Double' } { return 'float' }
    'System.Boolean' { return 'bool' }
    'System.DateTime' { return 'date' }
    { $_ -in 'System.String', 'System.TimeSpan', 'System.Guid' } { if ($size -gt 0 -and $size -le 255) { return 'text' } else { return 'longText' } }
    default { return 'other' }
  }
}
try {
  $req = $json.DeserializeObject([Console]::In.ReadLine())
  if ($req['op'] -eq 'dsns') {
    Out-Line ([string[]]@(Get-OdbcDsn | Where-Object { $_.Platform -ne '32-bit' } | ForEach-Object { [string]$_.Name } | Sort-Object -Unique))
    exit 0
  }
  $conn = New-Object Data.Odbc.OdbcConnection($req['connection'])
  $conn.Open()
  try {
    $found = @($conn.GetSchema('Tables').Rows | Where-Object { $_['TABLE_TYPE'] -in 'TABLE', 'VIEW', 'BASE TABLE' } |
      ForEach-Object { @{ name = [string]$_['TABLE_NAME']; schema = [string]$_['TABLE_SCHEM'] } })
    if ($req['op'] -eq 'tables') { Out-Line $found; exit 0 }
    # the table must be one the source listed: its name is quoted by the driver's own rule, never pasted as typed
    $schema = [string]$req['schema']; $table = [string]$req['table']
    if (-not ($found | Where-Object { $_.name -ceq $table -and $_.schema -ceq $schema })) { throw 'Unknown table.' }
    $b = New-Object Data.Odbc.OdbcCommandBuilder
    $q = $b.QuoteIdentifier($table, $conn)
    if ($schema) { $q = $b.QuoteIdentifier($schema, $conn) + '.' + $q }
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT * FROM $q"
    $r = $cmd.ExecuteReader()
    $cols = @($r.GetSchemaTable().Rows | ForEach-Object { @{ name = [string]$_['ColumnName']; kind = (Kind $_['DataType'] ([int]$_['ColumnSize'])); size = [int]$_['ColumnSize'] } })
    Out-Line @{ columns = $cols }
    while ($r.Read()) {
      $row = New-Object object[] $cols.Count
      for ($i = 0; $i -lt $cols.Count; $i++) {
        if ($r.IsDBNull($i) -or $cols[$i].kind -eq 'other') { continue }
        $v = $r.GetValue($i)
        $row[$i] = switch ($cols[$i].kind) {
          'date' { ([datetime]$v).ToString('yyyy-MM-dd HH:mm:ss', $inv) }
          'bool' { if ($v) { '1' } else { '0' } }
          { $_ -in 'int', 'float' } { [string]::Format($inv, '{0}', $v) }
          default { [string]$v }
        }
      }
      Out-Line $row
    }
  } finally { $conn.Dispose() }
} catch {
  [Console]::Error.WriteLine(($_.Exception.Message -replace '\s+', ' '))
  exit 1
}
