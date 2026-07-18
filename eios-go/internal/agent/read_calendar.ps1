# Reads his own Outlook calendar for a window of days via local COM.
# Read-only: never creates, moves or cancels anything. Emits one JSON object.
# Failure is reported as {"available":false,...} — the twin never guesses a day.

param([int]$Days = 1)

$ErrorActionPreference = "Stop"

$hasClassic = Test-Path "Registry::HKEY_CLASSES_ROOT\Outlook.Application"
if (-not $hasClassic) {
    $newOutlook = $null
    try { $newOutlook = Get-AppxPackage -Name "Microsoft.OutlookForWindows" -ErrorAction SilentlyContinue } catch { }
    if ($newOutlook) {
        [pscustomobject]@{ available=$false; reason="new_outlook_only";
            error="Only the NEW Outlook (Store app) is installed. It exposes no COM automation, so the calendar cannot be read locally.";
            fix="Enable classic Outlook (toggle 'New Outlook' off), or use Microsoft Graph with tenant admin consent." } | ConvertTo-Json -Compress
        exit 0
    }
    [pscustomobject]@{ available=$false; reason="no_outlook";
        error="Classic Outlook is not installed on this machine.";
        fix="Install classic desktop Outlook, sign in once, then retry." } | ConvertTo-Json -Compress
    exit 0
}

try {
    $ol = New-Object -ComObject Outlook.Application
    $ns = $ol.GetNamespace("MAPI")
    $cal = $ns.GetDefaultFolder(9).Items      # 9 = olFolderCalendar
    $cal.IncludeRecurrences = $true
    $cal.Sort("[Start]")

    $from = (Get-Date).Date
    $to = $from.AddDays([Math]::Max(1, $Days))
    $filter = "[Start] >= '" + $from.ToString("g") + "' AND [Start] < '" + $to.ToString("g") + "'"

    $events = New-Object System.Collections.ArrayList
    foreach ($a in $cal.Restrict($filter)) {
        $loc = [string]$a.Location
        $bodyHead = ""
        try { if ($a.Body) { $bodyHead = $a.Body.Substring(0, [Math]::Min(400, $a.Body.Length)) } } catch { }
        $isTeams = ($loc -match "Teams") -or ($bodyHead -match "Microsoft Teams") -or ($bodyHead -match "teams.microsoft.com")
        [void]$events.Add([pscustomobject]@{
            subject   = [string]$a.Subject
            start     = $a.Start.ToString("o")
            end       = $a.End.ToString("o")
            duration  = [int]$a.Duration        # minutes
            organizer = [string]$a.Organizer
            location  = $loc
            busy      = [int]$a.BusyStatus       # 0 free 1 tentative 2 busy 3 oof 4 workingElsewhere
            allDay    = [bool]$a.AllDayEvent
            isTeams   = [bool]$isTeams
        })
    }

    [pscustomobject]@{ available=$true; events=$events } | ConvertTo-Json -Depth 4 -Compress
}
catch {
    $msg = [string]$_.Exception.Message
    $reason = "com_error"; $fix = "Open Outlook once and let it finish creating your mail profile; then retry."
    if ($msg -match "profile|MAPI") { $reason = "no_profile" }
    [pscustomobject]@{ available=$false; reason=$reason; error=$msg; fix=$fix } | ConvertTo-Json -Compress
}
