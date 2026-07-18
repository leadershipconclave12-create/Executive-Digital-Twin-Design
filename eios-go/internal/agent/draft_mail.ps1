# Creates a DRAFT in Outlook and saves it to the Drafts folder. It NEVER sends.
# The executive opens Drafts, reads it, edits if needed, and hits Send himself —
# the twin proposes words, he remains the sender. Emits one JSON object.
#
# Params:
#   -To       recipient(s), semicolon-separated (ignored when -ReplyTo is used)
#   -Subject  subject line (ignored when -ReplyTo is used; reply keeps "RE:")
#   -Body     the draft body (plain text)
#   -ReplyTo  optional EntryID of a message to reply to (keeps the thread)

param(
    [string]$To = "",
    [string]$Subject = "",
    [string]$Body = "",
    [string]$ReplyTo = ""
)

$ErrorActionPreference = "Stop"

$hasClassic = Test-Path "Registry::HKEY_CLASSES_ROOT\Outlook.Application"
if (-not $hasClassic) {
    [pscustomobject]@{ created=$false; reason="new_outlook_only";
        error="Only the NEW Outlook (Store app) is installed - no COM automation, so a draft cannot be created locally.";
        fix="Enable classic Outlook, or draft via Microsoft Graph with admin consent." } | ConvertTo-Json -Compress
    exit 0
}

try {
    $ol = New-Object -ComObject Outlook.Application
    $ns = $ol.GetNamespace("MAPI")

    if ($ReplyTo -ne "") {
        $orig = $ns.GetItemFromID($ReplyTo)
        $mail = $orig.Reply()
        if ($Body -ne "") { $mail.Body = $Body + "`r`n`r`n" + $mail.Body }
    } else {
        $mail = $ol.CreateItem(0)     # 0 = olMailItem
        if ($To -ne "") { $mail.To = $To }
        if ($Subject -ne "") { $mail.Subject = $Subject }
        $mail.Body = $Body
    }

    $mail.Save()                       # -> Drafts. No .Send() anywhere, by design.

    [pscustomobject]@{
        created = $true
        entryId = [string]$mail.EntryID
        subject = [string]$mail.Subject
        to      = [string]$mail.To
        savedTo = "Drafts"
    } | ConvertTo-Json -Compress
}
catch {
    $msg = [string]$_.Exception.Message
    $reason = "com_error"; $fix = "Open Outlook once, sign in, then retry."
    if ($msg -match "profile|MAPI") { $reason = "no_profile" }
    [pscustomobject]@{ created=$false; reason=$reason; error=$msg; fix=$fix } | ConvertTo-Json -Compress
}
