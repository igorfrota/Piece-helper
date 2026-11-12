[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

function Stop-SosVM([string]$n) {
    $vm = Get-VM -Name $n
    if ($vm.State -eq 'Off') { return $false }
    Write-Host 'Desligando a VM (desligamento normal do Windows dela)...'
    Stop-VM -Name $n -Force
    $t = 0
    while ((Get-VM -Name $n).State -ne 'Off' -and $t -lt 120) { Start-Sleep -Seconds 2; $t += 2 }
    if ((Get-VM -Name $n).State -ne 'Off') {
        Write-Host 'A VM nao desligou sozinha em 2 minutos: desligando na forca.'
        Stop-VM -Name $n -TurnOff -Force
    }
    Write-Host 'VM desligada.'
    return $true
}

function Get-SosPartitionPath([string]$gpuId) {
    $parts = @()
    try { $parts = @(Get-VMHostPartitionableGpu -EA Stop) } catch { try { $parts = @(Get-VMPartitionableGpu -EA Stop) } catch {} }
    $k = $gpuId.Replace('\', '#').ToUpper()
    $p = $parts | Where-Object { $_.Name.ToUpper().Contains($k) } | Select-Object -First 1
    if ($p) { return $p.Name }
    return $null
}

function Add-SosGpuAdapter([string]$vmName, [string]$gpuId) {
    Set-VM -Name $vmName -AutomaticStopAction ShutDown -AutomaticCheckpointsEnabled $false -CheckpointType Disabled
    try { Set-VM -Name $vmName -GuestControlledCacheTypes $true -LowMemoryMappedIoSpace 1GB -HighMemoryMappedIoSpace 32GB } catch { Write-Host ('Aviso: ' + $_.Exception.Message) }
    Get-VMGpuPartitionAdapter -VMName $vmName -EA SilentlyContinue | Remove-VMGpuPartitionAdapter
    $path = Get-SosPartitionPath $gpuId
    $c = Get-Command Add-VMGpuPartitionAdapter
    if ($path -and $c.Parameters.ContainsKey('InstancePath')) { Add-VMGpuPartitionAdapter -VMName $vmName -InstancePath $path }
    else { Add-VMGpuPartitionAdapter -VMName $vmName }
    Set-VMGpuPartitionAdapter -VMName $vmName `
      -MinPartitionVRAM 80000000 -MaxPartitionVRAM 100000000 -OptimalPartitionVRAM 100000000 `
      -MinPartitionEncode 80000000 -MaxPartitionEncode 100000000 -OptimalPartitionEncode 100000000 `
      -MinPartitionDecode 80000000 -MaxPartitionDecode 100000000 -OptimalPartitionDecode 100000000 `
      -MinPartitionCompute 80000000 -MaxPartitionCompute 100000000 -OptimalPartitionCompute 100000000
    Write-Host 'Placa adicionada a VM.'
}

# copia os drivers da placa para um Windows ja aberto numa letra (ex.: 'W:')
function Copy-SosGpuDriversTo([string]$letter, [string]$gpuId) {
    $dev = Get-PnpDevice -InstanceId $gpuId
    Write-Host ('Placa: ' + $dev.FriendlyName)
    $script:GuestBuild = (Get-Item ($letter + '\Windows\System32\ntoskrnl.exe')).VersionInfo.FileBuildPart
    $store = $letter + '\Windows\System32\HostDriverStore\FileRepository'
    New-Item -ItemType Directory -Force -Path $store | Out-Null
    $copied = @{}
    function Copy-Pkg([string]$path) {
        $low = $path.ToLower()
        $i = $low.IndexOf('\driverstore\filerepository\')
        if ($i -lt 0) { return $false }
        $rest = $path.Substring($i + '\driverstore\filerepository\'.Length)
        $pkg = $rest.Split('\')[0]
        if ($copied.ContainsKey($pkg)) { return $true }
        $copied[$pkg] = $true
        $src = $path.Substring(0, $i) + '\DriverStore\FileRepository\' + $pkg
        $dst = Join-Path $store $pkg
        if (-not (Test-Path $dst)) { Copy-Item -Path $src -Destination $dst -Recurse -Force; Write-Host ('  pacote do driver: ' + $pkg) }
        return $true
    }
    if ($dev.Service) {
        $sp = (Get-CimInstance Win32_SystemDriver -Filter ("Name='" + $dev.Service + "'")).PathName
        if ($sp) { [void](Copy-Pkg $sp) }
    }

    # Pacotes extras do driver: na AMD (e em outras), OpenGL, Vulkan e OpenCL vem em pacotes separados
    # (ex.: amdogl.inf). Sem eles a Steam e jogos OpenGL mostram "LoadLibrary failed with error 126" na VM.
    # 1) caminhos que o proprio registro da placa aponta (OpenGLDriverName, VulkanDriverName...)
    try {
        $drvKey = (Get-PnpDeviceProperty -InstanceId $gpuId -KeyName 'DEVPKEY_Device_Driver' -EA Stop).Data
        $props = Get-ItemProperty ('HKLM:\SYSTEM\CurrentControlSet\Control\Class\' + $drvKey) -EA Stop
        foreach ($pp in $props.PSObject.Properties) {
            if ($pp.Name -like 'PS*') { continue }
            foreach ($v in @($pp.Value)) {
                if ($v -is [string] -and $v -match '(?i)\\driverstore\\filerepository\\') {
                    $full = $v
                    if ($full -notmatch '^[A-Za-z]:') { $full = $env:SystemRoot + '\System32' + $full.Substring($full.ToLower().IndexOf('\driverstore')) }
                    [void](Copy-Pkg $full)
                }
            }
        }
    } catch { Write-Host ('Aviso (pacotes extras do registro): ' + $_.Exception.Message) }
    # 2) componentes de software do driver ligados a placa (SWC\..., como AMD OpenGL/Vulkan/OpenCL).
    #    Monitores e outros filhos (DISPLAY\..., etc.) ficam de fora: os drivers deles sao do proprio Windows.
    $ids = @($gpuId)
    try { $ids += @((Get-PnpDeviceProperty -InstanceId $gpuId -KeyName 'DEVPKEY_Device_Children' -EA Stop).Data | Where-Object { $_ -like 'SWC\*' }) } catch {}

    Write-Host 'Procurando os arquivos do driver (pode levar alguns minutos)...'
    $files = @()
    foreach ($id in $ids) {
        if (-not $id) { continue }
        $drv = Get-CimInstance Win32_PnPSignedDriver -Filter ("DeviceID='" + $id.Replace('\', '\\') + "'")
        if (-not $drv) { continue }
        try { $files += @($drv | Get-CimAssociatedInstance -ResultClassName CIM_DataFile -EA Stop | ForEach-Object { $_.Name }) } catch {}
    }
    if ($files.Count -eq 0) {
        $files = @(Get-CimInstance Win32_PNPSignedDriverCIMDataFile | Where-Object { $ids -contains $_.Antecedent.DeviceID } |
                   ForEach-Object { $_.Dependent.Name })
    }
    $n = 0
    $skip = 0
    foreach ($f in $files) {
        if (-not $f -or -not (Test-Path $f)) { continue }
        if (Copy-Pkg $f) { continue }
        # arquivos que ja fazem parte do Windows da VM (inf, catalogos) nunca sao substituidos
        if ($f -match '(?i)\\windows\\(inf|system32\\catroot2?|winsxs|servicing)\\') { continue }
        $dest = $letter + $f.Substring(2)
        try {
            $dir = Split-Path $dest -Parent
            if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
            Copy-Item -Path $f -Destination $dest -Force -EA Stop
            $n++
        } catch { $skip++ }
    }
    if ($skip) { Write-Host ('  ' + $skip + ' arquivo(s) avulso(s) do driver nao puderam ser copiados (ja existem protegidos na VM); seguindo.') }
    Write-Host ('Arquivos copiados: ' + $copied.Count + ' pacote(s) do driver e ' + $n + ' arquivo(s) avulsos.')
}

function Copy-SosGpuDrivers([string]$vmName, [string]$gpuId) {
    $vhd = (Get-VMHardDiskDrive -VMName $vmName | Where-Object { $_.Path } | Select-Object -First 1).Path
    if (-not $vhd) { throw 'A VM nao tem disco virtual.' }
    Write-Host ('Abrindo o disco da VM: ' + $vhd)
    $disk = Mount-VHD -Path $vhd -PassThru | Get-Disk
    try {
        foreach ($p in @(Get-Partition -DiskNumber $disk.Number)) {
            if (-not $p.DriveLetter -and $p.Type -eq 'Basic' -and $p.Size -gt 10GB) {
                try { $p | Add-PartitionAccessPath -AssignDriveLetter -EA Stop } catch {}
            }
        }
        $letter = $null
        foreach ($p in @(Get-Partition -DiskNumber $disk.Number)) {
            if ($p.DriveLetter -and (Test-Path ($p.DriveLetter + ':\Windows\System32'))) { $letter = $p.DriveLetter + ':'; break }
        }
        if (-not $letter) { throw 'Nao achei o Windows dentro do disco da VM.' }
        Copy-SosGpuDriversTo $letter $gpuId
    }
    finally {
        Write-Host 'Fechando o disco da VM...'
        Dismount-VHD -Path $vhd
    }
}

# copia o Piece Helper (pasta $HelperSrc) para o Windows aberto na letra e cria o atalho para todos os usuarios
function Install-SosHelper([string]$letter) {
    $dst = $letter + '\Piece Helper'
    Write-Host 'Copiando o Piece Helper para dentro da VM...'
    $null = robocopy $HelperSrc $dst /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw 'Nao consegui copiar o Piece Helper para a VM.' }
    $desk = $letter + '\Users\Public\Desktop'
    New-Item -ItemType Directory -Force -Path $desk | Out-Null
    $sh = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk 'Piece Helper.lnk'))
    $sh.TargetPath = 'C:\Piece Helper\PieceHelper.exe'
    $sh.WorkingDirectory = 'C:\Piece Helper'
    $sh.IconLocation = 'C:\Piece Helper\PieceHelper.exe,0'
    $sh.Save()
    Write-Host 'Piece Helper instalado na VM, com atalho na area de trabalho.'
}
