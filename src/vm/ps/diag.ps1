# Piece Helper - exame do PC para a maquina virtual (so le, nao muda nada). Imprime um JSON.
$ErrorActionPreference = 'SilentlyContinue'
$o = [ordered]@{}
$os = Get-CimInstance Win32_OperatingSystem
$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$o.edition = $os.Caption
$o.editionId = $cv.EditionID
$o.build = [int]$os.BuildNumber
$o.ram = [int64]$os.TotalVisibleMemorySize * 1024
$o.ramFree = [int64]$os.FreePhysicalMemory * 1024
$o.threads = [Environment]::ProcessorCount
$o.user = $env:USERNAME
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$o.cpu = $cpu.Name
$o.vtx = [bool]$cpu.VirtualizationFirmwareEnabled
$o.slat = [bool]$cpu.SecondLevelAddressTranslationExtensions
$cs = Get-CimInstance Win32_ComputerSystem
$o.hypervisor = [bool]$cs.HypervisorPresent
$o.maker = $cs.Manufacturer
$bb = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
$o.board = (($bb.Manufacturer + ' ' + $bb.Product).Trim())
$o.boardMaker = $bb.Manufacturer
$o.laptop = [bool](Get-CimInstance Win32_Battery | Select-Object -First 1)
$o.uefi = ($env:firmware_type -eq 'UEFI')
$o.feature = $null
try { $o.feature = (Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -EA Stop).State.ToString() } catch {}
$o.module = [bool](Get-Command Get-VM -EA SilentlyContinue)
$svc = Get-Service vmms -EA SilentlyContinue
$o.vmms = $(if ($svc) { $svc.Status.ToString() } else { $null })
$o.vmmsStart = $(if ($svc) { $svc.StartType.ToString() } else { $null })
# hypervisorlaunchtype no boot atual (Off = Hyper-V instalado mas sem ligar)
$o.launch = $null
$bcd = (& bcdedit.exe /enum '{current}' 2>$null) -join "`n"
if ($bcd -match '(?im)^hypervisorlaunchtype\s+(\S+)') { $o.launch = $Matches[1] }
# reinicio pendente
$o.rebootPending = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') -or
                   (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired')
# discos
$o.drives = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    [ordered]@{ letter = $_.DeviceID.Substring(0, 1); free = [int64]$_.FreeSpace; size = [int64]$_.Size; fs = $_.FileSystem }
})
$o.vhdDir = $null; $o.vmDir = $null
if ($o.module -and $svc -and $svc.Status -eq 'Running') {
    try { $h = Get-VMHost -EA Stop; $o.vhdDir = $h.VirtualHardDiskPath; $o.vmDir = $h.VirtualMachinePath } catch {}
}
# placas de video (fabricante pelo VEN_ do PCI)
$parts = @()
try { $parts = @(Get-VMHostPartitionableGpu -EA Stop) } catch { try { $parts = @(Get-VMPartitionableGpu -EA Stop) } catch {} }
$o.gpus = @(Get-PnpDevice -Class Display -EA SilentlyContinue | Where-Object { $_.Present } | ForEach-Object {
    $id = $_.InstanceId
    $k = $id.Replace('\', '#').ToUpper()
    $p = $parts | Where-Object { $_.Name.ToUpper().Contains($k) } | Select-Object -First 1
    $d = Get-CimInstance Win32_PnPSignedDriver -Filter ("DeviceID='" + $id.Replace('\', '\\') + "'")
    $ven = $null
    if ($id -match 'VEN_([0-9A-F]{4})') { $ven = $Matches[1] }
    $radeon = $null
    try {
        $drvKey = (Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_Driver' -EA Stop).Data
        $cls = Get-ItemProperty ('HKLM:\SYSTEM\CurrentControlSet\Control\Class\' + $drvKey) -EA Stop
        if ($cls.RadeonSoftwareVersion) { $radeon = [string]$cls.RadeonSoftwareVersion }
    } catch {}
    $prob = $null
    try { $prob = (Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_ProblemCode' -EA Stop).Data } catch {}
    [ordered]@{ name = $_.FriendlyName; id = $id; status = $_.Status.ToString(); problem = $prob; ven = $ven;
        path = $(if ($p) { $p.Name } else { $null }); driver = $(if ($d) { $d.DriverVersion } else { $null });
        driverDate = $(if ($d -and $d.DriverDate) { $d.DriverDate.ToString('yyyy-MM-dd') } else { $null }); radeon = $radeon }
})
# maquinas virtuais
$o.vms = @()
if ($o.module -and $svc -and $svc.Status -eq 'Running') {
    $o.vms = @(Get-VM -EA SilentlyContinue | ForEach-Object {
        $g = @(Get-VMGpuPartitionAdapter -VMName $_.Name -EA SilentlyContinue)
        $hd = Get-VMHardDiskDrive -VMName $_.Name | Where-Object { $_.Path } | Select-Object -First 1
        $vhdSize = $null; $vhdFile = $null
        if ($hd) { try { $vi = Get-VHD -Path $hd.Path -EA Stop; $vhdSize = [int64]$vi.Size; $vhdFile = [int64]$vi.FileSize } catch {} }
        [ordered]@{ name = $_.Name; state = $_.State.ToString(); gpu = ($g.Count -gt 0); gpuPath = $(if ($g.Count) { $g[0].InstancePath } else { $null });
            checkpoint = $_.CheckpointType.ToString(); autockpt = [bool]$_.AutomaticCheckpointsEnabled;
            snaps = @(Get-VMSnapshot -VMName $_.Name -EA SilentlyContinue).Count;
            vhd = $(if ($hd) { $hd.Path } else { $null }); vhdSize = $vhdSize; vhdFile = $vhdFile;
            net = [bool](Get-VMNetworkAdapter -VMName $_.Name | Where-Object { $_.SwitchName } | Select-Object -First 1);
            toolsOff = @(Get-VMIntegrationService -VMName $_.Name -EA SilentlyContinue | Where-Object { -not $_.Enabled } | ForEach-Object { $_.Name }) }
    })
    $o.switches = @(Get-VMSwitch -EA SilentlyContinue | ForEach-Object { $_.Name })
    try { $o.enhanced = [bool](Get-VMHost).EnableEnhancedSessionMode } catch { $o.enhanced = $true }
}
$o | ConvertTo-Json -Depth 5 -Compress
