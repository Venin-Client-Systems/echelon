import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { logger } from '../lib/logger.js';

const os = platform();

/** Escape a string for safe use in AppleScript */
function escapeAppleScript(str: string): string {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, ' ')
        .replace(/\r/g, '')
        .replace(/\t/g, ' ');
}

/** Escape a string for safe use in PowerShell */
function escapePowerShell(str: string): string {
    return str
        .replace(/'/g, "''")
        .replace(/\n/g, ' ')
        .replace(/\r/g, '');
}

/** Send a desktop notification (macOS/Linux/Windows) */
export function sendDesktopNotification(title: string, message: string): void {
    try {
        switch (os) {
            case 'darwin':
                execFile('osascript', [
                    '-e', `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}" sound name "Ping"`,
                ]);
                break;
            case 'linux':
                execFile('notify-send', [title, message]);
                break;
            case 'win32':
                execFile('powershell', [
                    '-Command',
                    `[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');` +
                        `$n=New-Object System.Windows.Forms.NotifyIcon;` +
                        `$n.Icon=[System.Drawing.SystemIcons]::Information;` +
                        `$n.Visible=$true;` +
                        `$n.ShowBalloonTip(5000,'${escapePowerShell(title)}','${escapePowerShell(message)}',[System.Windows.Forms.ToolTipIcon]::Info)`,
                ]);
                break;
            default:
                logger.debug(`Desktop notifications not supported on ${os}`);
        }
    } catch {
        // Fire-and-forget — don't fail the run over a notification
    }
}

/** Play a sound (macOS only, graceful fallback) */
export function playSound(type: 'success' | 'error' | 'warning'): void {
    if (os !== 'darwin')
        return;

    const sounds: Record<string, string> = {
        success: 'Glass',
        error: 'Basso',
        warning: 'Purr',
    };

    try {
        execFile('afplay', [`/System/Library/Sounds/${sounds[type]}.aiff`]);
    } catch {
        // Ignore
    }
}
