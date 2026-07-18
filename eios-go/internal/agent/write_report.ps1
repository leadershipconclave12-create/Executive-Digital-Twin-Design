# Generates a Word (.docx) report from a title + sections and saves it to his
# Documents folder. This WRITES a new file (it never touches existing files) and
# leaves it closed on disk for him to open, review and send. Emits one JSON obj.
#
# Reads the section payload as JSON from stdin so headings/bodies of any length
# and content survive without quoting games.
#
# Params:
#   -Title  the report title / filename stem

param([string]$Title = "Report")

$ErrorActionPreference = "Stop"

$raw = [Console]::In.ReadToEnd()
$sections = @()
if ($raw.Trim() -ne "") { try { $sections = ($raw | ConvertFrom-Json) } catch { $sections = @() } }

$hasWord = Test-Path "Registry::HKEY_CLASSES_ROOT\Word.Application"
if (-not $hasWord) {
    [pscustomobject]@{ created=$false; reason="no_word";
        error="Microsoft Word is not installed, so a .docx cannot be generated locally.";
        fix="Install Word (Microsoft 365 Apps) or generate the report as plain text instead." } | ConvertTo-Json -Compress
    exit 0
}

try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $doc = $word.Documents.Add()
    $sel = $word.Selection

    $sel.Style = "Title"
    $sel.TypeText($Title)
    $sel.TypeParagraph()
    $sel.Style = "Subtitle"
    $sel.TypeText("Prepared by Assistant - " + (Get-Date -Format "dddd, dd MMM yyyy HH:mm"))
    $sel.TypeParagraph()

    foreach ($s in $sections) {
        if ($s.heading) { $sel.Style = "Heading 1"; $sel.TypeText([string]$s.heading); $sel.TypeParagraph() }
        if ($s.body)    { $sel.Style = "Normal";    $sel.TypeText([string]$s.body);    $sel.TypeParagraph() }
    }

    $safe = ($Title -replace '[\\/:*?"<>|]', '_')
    if ($safe.Length -gt 60) { $safe = $safe.Substring(0, 60) }
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $dir = [Environment]::GetFolderPath("MyDocuments")
    $path = Join-Path $dir ("$safe-$stamp.docx")
    $doc.SaveAs([ref]$path, [ref]16)   # 16 = wdFormatDocumentDefault (.docx)
    $doc.Close($false)
    $word.Quit()

    [pscustomobject]@{ created=$true; path=$path; title=$Title; sections=$sections.Count } | ConvertTo-Json -Compress
}
catch {
    [pscustomobject]@{ created=$false; reason="com_error"; error=[string]$_.Exception.Message;
        fix="Ensure Word is installed and not blocked by policy." } | ConvertTo-Json -Compress
    try { if ($word) { $word.Quit() } } catch { }
}
