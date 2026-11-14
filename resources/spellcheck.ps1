# Spelling on Windows: the OS spell checker (Windows Spell Checking API, ISpellChecker), which Chromium's renderer cannot query.
# Stdin protocol, one request per line: the words separated by tabs. Answer: for each misspelled word one line
# "word<TAB>suggestion<TAB>...", then a line "END". First line printed: "READY <language tag>" or "READY -" (no checker for the tags).
param([Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)][string[]]$Tags)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
[ComImport, Guid("7AB36653-1796-484B-BDFA-E74F1DB7C1DC")] public class SpellCheckerFactoryCoClass { }
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("8E018A9D-2415-4677-BF08-794EA61F94BB")]
public interface ISpellCheckerFactory {
  void get_SupportedLanguages(out IEnumString v);
  void IsSupported([MarshalAs(UnmanagedType.LPWStr)] string tag, out int supported);
  void CreateSpellChecker([MarshalAs(UnmanagedType.LPWStr)] string tag, out ISpellChecker checker);
}
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("B6FD0B71-E2BC-4653-8D05-F197E412770B")]
public interface ISpellChecker {
  void get_LanguageTag([MarshalAs(UnmanagedType.LPWStr)] out string v);
  void Check([MarshalAs(UnmanagedType.LPWStr)] string text, out IEnumSpellingError errors);
  void Suggest([MarshalAs(UnmanagedType.LPWStr)] string word, out IEnumString suggestions);
}
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("803E3BD4-2828-4410-8290-418D1D73C762")]
public interface IEnumSpellingError {
  [PreserveSig] int Next([MarshalAs(UnmanagedType.IUnknown)] out object error);
}
public static class Spell {
  static ISpellChecker checker;
  public static string Open(string[] tags) {
    var factory = (ISpellCheckerFactory)new SpellCheckerFactoryCoClass();
    foreach (var tag in tags) {
      int ok; factory.IsSupported(tag, out ok);
      if (ok != 0) { factory.CreateSpellChecker(tag, out checker); return tag; }
    }
    return null;
  }
  public static string[] Check(string word) {
    var c = checker;
    IEnumSpellingError errors; c.Check(word, out errors);
    object e;
    if (errors.Next(out e) != 0) return null;
    var list = new System.Collections.Generic.List<string>();
    IEnumString s; c.Suggest(word, out s);
    var one = new string[1];
    while (list.Count < 8 && s.Next(1, one, IntPtr.Zero) == 0) list.Add(one[0]);
    return list.ToArray();
  }
}
'@
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$out = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$out.AutoFlush = $true
$used = [Spell]::Open($Tags)
$out.WriteLine('READY ' + $(if ($used) { $used } else { '-' }))
if (-not $used) { exit 0 }
$in = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
while ($null -ne ($line = $in.ReadLine())) {
  foreach ($w in $line.Split("`t")) {
    if ($w.Length -eq 0) { continue }
    $s = [Spell]::Check($w)
    if ($null -ne $s) { $out.WriteLine($w + $(if ($s.Count) { "`t" + ($s -join "`t") } else { '' })) }
  }
  $out.WriteLine('END')
}
