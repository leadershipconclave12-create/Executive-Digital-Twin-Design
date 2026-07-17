# Reads the executive's OWN mailbox through Outlook's local COM interface.
#
# No Microsoft Graph, no Entra app registration, no tenant admin consent — this
# automates the Outlook already running on his machine, as him. He already has
# every right to read his own inbox; nothing new is granted to anyone.
#
# Read-only: enumerates mail + today's meetings. Never sends, moves or deletes.
# Emits a single JSON object on stdout. Never throws: failure is reported as
# {"available":false,"error":...} so the twin can say so instead of guessing.

param([int]$Limit = 25)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Pre-flight: work out WHICH Outlook is on this machine before touching COM.
# Only CLASSIC desktop Outlook exposes the Outlook.Application automation
# interface. The "new Outlook" (Microsoft.OutlookForWindows / olk.exe) is a web
# wrapper with NO COM at all — for that one, local reading is impossible and the
# only route to mail is Microsoft Graph (which needs tenant admin consent).
# Report that precisely rather than surfacing a raw HRESULT.
# ---------------------------------------------------------------------------
$hasClassic = Test-Path "Registry::HKEY_CLASSES_ROOT\Outlook.Application"
if (-not $hasClassic) {
    $newOutlook = $null
    try { $newOutlook = Get-AppxPackage -Name "Microsoft.OutlookForWindows" -ErrorAction SilentlyContinue } catch { }
    if ($newOutlook) {
        [pscustomobject]@{
            available = $false
            reason    = "new_outlook_only"
            error     = "Only the NEW Outlook (Store app) is installed. It exposes no COM automation, so mail cannot be read locally."
            fix       = "Install/enable classic Outlook (Microsoft 365 Apps for Enterprise), or toggle 'New Outlook' off to switch back to classic. Otherwise mail needs Microsoft Graph + tenant admin consent."
        } | ConvertTo-Json -Compress
        exit 0
    }
    [pscustomobject]@{
        available = $false
        reason    = "no_outlook"
        error     = "Classic Outlook is not installed on this machine."
        fix       = "Install classic desktop Outlook (Microsoft 365 Apps), sign in once, then retry."
    } | ConvertTo-Json -Compress
    exit 0
}

try {
    $ol = New-Object -ComObject Outlook.Application
    $ns = $ol.GetNamespace("MAPI")

    # 6 = olFolderInbox
    $inbox = $ns.GetDefaultFolder(6)
    $items = $inbox.Items
    $items.Sort("[ReceivedTime]", $true)

    $msgs = New-Object System.Collections.ArrayList
    $i = 0
    foreach ($m in $items) {
        if ($i -ge $Limit) { break }
        # 43 = olMail (skip meeting requests, reports, etc.)
        if ($m.Class -ne 43) { continue }
        $body = ""
        if ($m.Body) { $body = $m.Body.Substring(0, [Math]::Min(2000, $m.Body.Length)) }
        [void]$msgs.Add([pscustomobject]@{
            id      = [string]$m.EntryID
            from    = [string]$m.SenderName
            address = [string]$m.SenderEmailAddress
            to      = [string]$m.To
            subject = [string]$m.Subject
            date    = $m.ReceivedTime.ToString("o")
            unread  = [bool]$m.UnRead
            body    = $body
        })
        $i++
    }

    # 9 = olFolderCalendar — today's meetings only
    $meetings = New-Object System.Collections.ArrayList
    try {
        $cal = $ns.GetDefaultFolder(9).Items
        $cal.IncludeRecurrences = $true
        $cal.Sort("[Start]")
        $from = (Get-Date).Date
        $to = $from.AddDays(1)
        $filter = "[Start] >= '" + $from.ToString("g") + "' AND [Start] < '" + $to.ToString("g") + "'"
        foreach ($a in $cal.Restrict($filter)) {
            [void]$meetings.Add([pscustomobject]@{
                subject  = [string]$a.Subject
                start    = $a.Start.ToString("o")
                duration = [int]$a.Duration
                organizer = [string]$a.Organizer
            })
        }
    } catch { }

    [pscustomobject]@{
        available = $true
        total     = [int]$inbox.Items.Count
        unread    = [int]$inbox.UnReadItemCount
        messages  = $msgs
        meetings  = $meetings
    } | ConvertTo-Json -Depth 4 -Compress
}
catch {
    # Classic Outlook is registered but the read still failed — most often no
    # mail profile has been configured yet (never signed in).
    $msg = [string]$_.Exception.Message
    $reason = "com_error"
    $fix = "Open Outlook once, sign in, and let it finish creating your mail profile; then retry."
    if ($msg -match "profile|MAPI") { $reason = "no_profile" }
    [pscustomobject]@{
        available = $false
        reason    = $reason
        error     = $msg
        fix       = $fix
    } | ConvertTo-Json -Compress
}
