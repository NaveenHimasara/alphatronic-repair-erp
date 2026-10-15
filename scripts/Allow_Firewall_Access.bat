@echo off
rem Run this ONCE on the main laptop: right-click > "Run as administrator".
rem It lets the other laptops and phones on the Wi-Fi reach the ERP on port 8080.
net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Please right-click this file and choose "Run as administrator".
    echo.
    pause
    exit /b 1
)

echo.
echo  [1/3] Removing old Windows rules that BLOCK Node.js ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetFirewallApplicationFilter | Where-Object { $_.Program -like '*node.exe' } | Get-NetFirewallRule | Where-Object { $_.Action -eq 'Block' } | ForEach-Object { Write-Host ('        removed: ' + $_.DisplayName + ' (' + $_.Profile + ')'); Remove-NetFirewallRule -Name $_.Name }"

echo  [2/3] Setting the Wi-Fi / Ethernet network to Private ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' -and $_.IPv4Connectivity -ne 'Disconnected' } | ForEach-Object { Write-Host ('        ' + $_.InterfaceAlias + ' - ' + $_.Name + ' -> Private'); Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private }"

echo  [3/3] Allowing the ERP port 8080 ...
netsh advfirewall firewall delete rule name="Alphatronic ERP" >nul 2>&1
netsh advfirewall firewall add rule name="Alphatronic ERP" dir=in action=allow protocol=TCP localport=8080 profile=private,domain >nul
netsh advfirewall firewall add rule name="Alphatronic ERP" dir=in action=allow program="%ProgramFiles%\nodejs\node.exe" enable=yes profile=private,domain >nul
echo        done.

echo.
echo  All done. Other laptops and phones on the same Wi-Fi can now open the ERP.
echo  If Windows ever asks again about "Node.js" access, click "Allow".
echo.
pause
