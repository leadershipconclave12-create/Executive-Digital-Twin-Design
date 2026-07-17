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
    [pscustomobject]@{
        available = $false
        error     = [string]$_.Exception.Message
    } | ConvertTo-Json -Compress
}
