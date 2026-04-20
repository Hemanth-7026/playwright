import * as childProcess from 'child_process';
import type { Logger } from '../types';

/**
 * UIA-based utility for focusing input fields and dumping window controls.
 *
 * These helpers use Windows UI Automation via PowerShell to interact
 * with native application controls (input fields, buttons, labels).
 */

/**
 * Focus a specific input field (Edit control) in a window via UI Automation.
 *
 * @param handle  - The window handle (HWND)
 * @param logger  - Logger instance
 * @param fieldName - Optional: match input by Name or AutomationId (substring).
 *                    If omitted, focuses the first Edit control found.
 * @returns true if an input was focused, false otherwise.
 */
export async function focusInputField(handle: number, logger: Logger, fieldName?: string): Promise<boolean> {
  const nameFilter = fieldName
    ? `if ($e.Current.Name -like '*${fieldName}*' -or $e.Current.AutomationId -like '*${fieldName}*')`
    : '';

  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$hwnd = [IntPtr]${handle}
$element = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)

$editCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Edit
)
$edits = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)

$focused = $false
foreach ($e in $edits) {
  ${nameFilter ? nameFilter + ' {' : ''}
    try {
      $e.SetFocus()
      Write-Output "Focused: Name='$($e.Current.Name)' AutomationId='$($e.Current.AutomationId)'"
      $focused = $true
      break
    } catch {
      Write-Output "Could not focus: $($_.Exception.Message)"
    }
  ${nameFilter ? '}' : ''}
}

if (-not $focused) { throw "No input field found to focus" }`;

  return new Promise((resolve) => {
    childProcess.execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 10_000, windowsHide: true },
        (err, stdout) => {
          if (err) {
            logger.warn('focusInput', `Failed: ${err.message}`);
            resolve(false);
          } else {
            logger.info('focusInput', stdout.trim());
            resolve(true);
          }
        },
    );
  });
}

/**
 * Dump all UI Automation controls (inputs, buttons, labels) in a window.
 *
 * Useful for debugging — tells you what control names/AutomationIds exist
 * so you can target them with focusInputField or ClickApprovalHandler.
 *
 * @param handle - The window handle (HWND)
 * @returns A human-readable dump of all Edit, Button, and Text controls.
 */
export async function dumpWindowControls(handle: number): Promise<string> {
  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$hwnd = [IntPtr]${handle}
$element = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)

$editCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Edit
)
$edits = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
Write-Output "=== Input Fields (Edit controls) ==="
foreach ($e in $edits) {
  Write-Output "  Name='$($e.Current.Name)' AutomationId='$($e.Current.AutomationId)' ClassName='$($e.Current.ClassName)'"
}

$btnCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Button
)
$buttons = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCondition)
Write-Output "=== Buttons ==="
foreach ($b in $buttons) {
  Write-Output "  Name='$($b.Current.Name)' AutomationId='$($b.Current.AutomationId)' ClassName='$($b.Current.ClassName)'"
}

$textCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Text
)
$texts = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCondition)
Write-Output "=== Labels (Text controls) ==="
foreach ($t in $texts) {
  Write-Output "  Name='$($t.Current.Name)'"
}`;

  return new Promise((resolve, reject) => {
    childProcess.execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 15_000, windowsHide: true },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        },
    );
  });
}
