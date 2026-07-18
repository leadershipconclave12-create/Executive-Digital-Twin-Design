# Extracts text from a Word / Excel / PowerPoint file via local COM, read-only.
# Opens the app invisibly, reads, and closes WITHOUT saving — the file is never
# modified. Emits one JSON object. Failure is reported, never thrown.

param([string]$Path = "")

$ErrorActionPreference = "Stop"

if ($Path -eq "" -or -not (Test-Path -LiteralPath $Path)) {
    [pscustomobject]@{ available=$false; reason="not_found"; error="File not found: $Path" } | ConvertTo-Json -Compress
    exit 0
}

$ext = [System.IO.Path]::GetExtension($Path).ToLower()
$app = $null

try {
    if ($ext -eq ".docx" -or $ext -eq ".doc") {
        $app = New-Object -ComObject Word.Application
        $app.Visible = $false
        $doc = $app.Documents.Open($Path, $false, $true)   # ReadOnly
        $text = $doc.Content.Text
        $paras = $doc.Paragraphs.Count
        $words = $doc.Words.Count
        $doc.Close($false)
        if ($text.Length -gt 6000) { $text = $text.Substring(0, 6000) }
        [pscustomobject]@{ available=$true; kind="word";
            title=[System.IO.Path]::GetFileName($Path);
            paragraphs=[int]$paras; words=[int]$words; text=$text } | ConvertTo-Json -Compress
    }
    elseif ($ext -eq ".xlsx" -or $ext -eq ".xls" -or $ext -eq ".csv") {
        $app = New-Object -ComObject Excel.Application
        $app.Visible = $false
        $app.DisplayAlerts = $false
        $wb = $app.Workbooks.Open($Path, $false, $true)     # ReadOnly
        $sheets = New-Object System.Collections.ArrayList
        foreach ($ws in $wb.Worksheets) {
            $used = $ws.UsedRange
            $rows = [Math]::Min([int]$used.Rows.Count, 40)
            $cols = [Math]::Min([int]$used.Columns.Count, 12)
            $grid = New-Object System.Collections.ArrayList
            for ($r = 1; $r -le $rows; $r++) {
                $line = New-Object System.Collections.ArrayList
                for ($c = 1; $c -le $cols; $c++) {
                    [void]$line.Add([string]$used.Cells.Item($r, $c).Text)
                }
                [void]$grid.Add($line)
            }
            [void]$sheets.Add([pscustomobject]@{
                name=[string]$ws.Name; rows=[int]$used.Rows.Count; cols=[int]$used.Columns.Count; preview=$grid })
            if ($sheets.Count -ge 3) { break }
        }
        $wb.Close($false)
        [pscustomobject]@{ available=$true; kind="excel";
            title=[System.IO.Path]::GetFileName($Path); sheets=$sheets } | ConvertTo-Json -Depth 6 -Compress
    }
    elseif ($ext -eq ".pptx" -or $ext -eq ".ppt") {
        $app = New-Object -ComObject PowerPoint.Application
        $pres = $app.Presentations.Open($Path, $true, $false, $false)  # ReadOnly, untitled, no window
        $slides = New-Object System.Collections.ArrayList
        foreach ($s in $pres.Slides) {
            $buf = ""
            foreach ($sh in $s.Shapes) {
                if ($sh.HasTextFrame -and $sh.TextFrame.HasText) { $buf += $sh.TextFrame.TextRange.Text + " " }
            }
            if ($buf.Length -gt 500) { $buf = $buf.Substring(0, 500) }
            [void]$slides.Add([pscustomobject]@{ index=[int]$s.SlideIndex; text=$buf.Trim() })
            if ($slides.Count -ge 40) { break }
        }
        $pres.Close()
        [pscustomobject]@{ available=$true; kind="powerpoint";
            title=[System.IO.Path]::GetFileName($Path); slides=$slides } | ConvertTo-Json -Depth 5 -Compress
    }
    else {
        [pscustomobject]@{ available=$false; reason="unsupported_type";
            error="No COM reader for '$ext'."; fix="Open Word/Excel/PowerPoint files." } | ConvertTo-Json -Compress
    }
}
catch {
    [pscustomobject]@{ available=$false; reason="com_error"; error=[string]$_.Exception.Message;
        fix="Ensure the matching Office app is installed and the file isn't open exclusively." } | ConvertTo-Json -Compress
}
finally {
    if ($app -ne $null) { try { $app.Quit() } catch { } }
}
