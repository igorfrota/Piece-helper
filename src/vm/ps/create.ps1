function Optimize-SosOffline([string]$root) {
    Write-Host 'Deixando o Windows leve (tirando apps e funcoes inuteis)...'
    $apps = $BloatApps.Split(',')
    try {
        $prov = @(Get-AppxProvisionedPackage -Path ($root + '\'))
        foreach ($a in $prov) {
            if ($apps -contains $a.DisplayName) {
                try { Remove-AppxProvisionedPackage -Path ($root + '\') -PackageName $a.PackageName | Out-Null; Write-Host ('  removido: ' + $a.DisplayName) } catch {}
            }
        }
    } catch { Write-Host ('Aviso (apps): ' + $_.Exception.Message) }

    function Set-SosReg([string]$key, [string]$name, [int]$val) {
        & reg.exe add $key /v $name /t REG_DWORD /d $val /f | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Host ('  aviso: nao consegui mudar ' + $name) }
    }
    $okLoad = $true
    foreach ($pair in @(@('HKLM\SOS_SOFT', '\Windows\System32\config\SOFTWARE'), @('HKLM\SOS_SYS', '\Windows\System32\config\SYSTEM'),
                        @('HKLM\SOS_USER', '\Users\Default\NTUSER.DAT'))) {
        & reg.exe load $pair[0] ($root + $pair[1]) | Out-Null
        if ($LASTEXITCODE -ne 0) { $okLoad = $false }
    }
    try {
        if (-not $okLoad) { Write-Host 'Aviso: nao consegui abrir as configuracoes do Windows da VM; os ajustes foram pulados.'; return }
        $p = 'HKLM\SOS_SOFT\Policies\Microsoft\Windows'
        Set-SosReg "$p\DataCollection" 'AllowTelemetry' 0
        Set-SosReg "$p\DataCollection" 'DoNotShowFeedbackNotifications' 1
        Set-SosReg "$p\CloudContent" 'DisableWindowsConsumerFeatures' 1
        Set-SosReg "$p\CloudContent" 'DisableConsumerAccountStateContent' 1
        Set-SosReg "$p\CloudContent" 'DisableSoftLanding' 1
        Set-SosReg "$p\Windows Search" 'AllowCortana' 0
        Set-SosReg "$p\Windows Search" 'DisableWebSearch' 1
        Set-SosReg "$p\Windows Search" 'ConnectedSearchUseWeb' 0
        Set-SosReg "$p\AdvertisingInfo" 'DisabledByGroupPolicy' 1
        Set-SosReg "$p\Windows Feeds" 'EnableFeeds' 0
        Set-SosReg "$p\WindowsCopilot" 'TurnOffWindowsCopilot' 1
        Set-SosReg "$p\OneDrive" 'DisableFileSyncNGSC' 1
        Set-SosReg 'HKLM\SOS_SOFT\Policies\Microsoft\Dsh' 'AllowNewsAndInterests' 0
        Set-SosReg 'HKLM\SOS_SOFT\Microsoft\PolicyManager\default\NewsAndInterests\AllowNewsAndInterests' 'value' 0
        foreach ($svc in 'DiagTrack', 'dmwappushservice', 'WSearch', 'SysMain', 'MapsBroker', 'RetailDemo') {
            if (Test-Path ('Registry::HKLM\SOS_SYS\ControlSet001\Services\' + $svc)) { Set-SosReg ('HKLM\SOS_SYS\ControlSet001\Services\' + $svc) 'Start' 4 }
        }
        $u = 'HKLM\SOS_USER\Software\Microsoft\Windows\CurrentVersion'
        foreach ($v in 'SilentInstalledAppsEnabled', 'SystemPaneSuggestionsEnabled', 'SoftLandingEnabled', 'PreInstalledAppsEnabled',
                       'OemPreInstalledAppsEnabled', 'ContentDeliveryAllowed', 'SubscribedContent-338388Enabled',
                       'SubscribedContent-338389Enabled', 'SubscribedContent-353694Enabled', 'SubscribedContent-353696Enabled',
                       'SubscribedContent-310093Enabled') { Set-SosReg "$u\ContentDeliveryManager" $v 0 }
        Set-SosReg "$u\Search" 'BingSearchEnabled' 0
        Set-SosReg "$u\AdvertisingInfo" 'Enabled' 0
        Set-SosReg "$u\Explorer\Advanced" 'TaskbarMn' 0
        Set-SosReg "$u\Explorer\Advanced" 'ShowCopilotButton' 0
        Set-SosReg "$u\Explorer\Advanced" 'Start_IrisRecommendations' 0
        Set-SosReg "$u\Explorer\VisualEffects" 'VisualFXSetting' 2
        Set-SosReg "$u\Privacy" 'TailoredExperiencesWithDiagnosticDataEnabled' 0
        cmd.exe /c 'reg delete "HKLM\SOS_USER\Software\Microsoft\Windows\CurrentVersion\Run" /v OneDriveSetup /f >nul 2>&1'
        Set-SosReg 'HKLM\SOS_USER\Software\Policies\Microsoft\Windows\WindowsCopilot' 'TurnOffWindowsCopilot' 1
        Set-SosReg 'HKLM\SOS_USER\System\GameConfigStore' 'GameDVR_Enabled' 0
        Write-Host 'Funcoes inuteis desligadas.'
    }
    finally {
        [gc]::Collect(); [gc]::WaitForPendingFinalizers(); Start-Sleep -Seconds 1
        Close-SosHives
    }
}

$created = $false
Close-SosHives
if (Get-VM -Name $VMName -EA SilentlyContinue) { throw ("Ja existe uma VM chamada '" + $VMName + "'.") }
$vhdDir = (Get-VMHost).VirtualHardDiskPath
if ($VhdDir) { $vhdDir = $VhdDir }
New-Item -ItemType Directory -Force -Path $vhdDir | Out-Null
$vhd = Join-Path $vhdDir ($VMName + '.vhdx')
if (Test-Path $vhd) { throw ('Ja existe um disco com esse nome: ' + $vhd + '. Escolha outro nome para a VM.') }
$drv = (Get-Item $vhdDir).PSDrive
if ($drv.Free -lt 30GB) { throw ('Pouco espaco livre no disco ' + $drv.Name + ': (' + [math]::Round($drv.Free / 1GB) + ' GB). Precisa de pelo menos 30 GB.') }
Write-Host ('O disco da VM vai ficar em ' + $vhd)

Write-Host '##STEP 2'
Write-Host 'Abrindo a ISO do Windows...'
$img = Mount-DiskImage -ImagePath $Iso -PassThru
try {
    Start-Sleep -Seconds 2
    $isoLetter = (Get-DiskImage -ImagePath $Iso | Get-Volume).DriveLetter + ':'
    $wim = Join-Path $isoLetter 'sources\install.wim'
    if (-not (Test-Path $wim)) { $wim = Join-Path $isoLetter 'sources\install.esd' }
    if (-not (Test-Path $wim)) { throw 'Essa ISO nao parece ser de instalacao do Windows (faltou sources\install.wim ou install.esd).' }
    $imgs = @(Get-WindowsImage -ImagePath $wim)
    $pick = $imgs | Where-Object { $_.ImageName -match ' Pro$' } | Select-Object -First 1
    if (-not $pick) { $pick = $imgs | Where-Object { $_.ImageName -match 'Pro' -and $_.ImageName -notmatch ' N( |$)' } | Select-Object -First 1 }
    if (-not $pick) { $pick = $imgs[0] }
    Write-Host ('Edicao do Windows: ' + $pick.ImageName)
    $info = Get-WindowsImage -ImagePath $wim -Index $pick.ImageIndex
    $uiLang = @($info.Languages)[[int]$info.DefaultLanguageIndex]
    if (-not $uiLang) { $uiLang = @($info.Languages)[0] }

    Write-Host 'Criando o disco virtual...'
    New-VHD -Path $vhd -SizeBytes ([int64]$DiskGB * 1GB) -Dynamic | Out-Null
    $created = $true
    $disk = Mount-VHD -Path $vhd -PassThru | Get-Disk
    $sL = $null; $wL = $null
    try {
        $used = @((Get-PSDrive -PSProvider FileSystem).Name)
        $letters = @([char[]](90..70) | ForEach-Object { [string]$_ } | Where-Object { $used -notcontains $_ })
        $sL = $letters[0]; $wL = $letters[1]
        $dp = "select disk " + $disk.Number + "`r`nclean`r`nconvert gpt`r`ncreate partition efi size=260`r`n" +
              "format quick fs=fat32 label=`"System`"`r`nassign letter=" + $sL + "`r`ncreate partition msr size=16`r`n" +
              "create partition primary`r`nformat quick fs=ntfs label=`"Windows`"`r`nassign letter=" + $wL + "`r`nexit`r`n"
        $dpf = [IO.Path]::GetTempFileName()
        Set-Content -Path $dpf -Value $dp -Encoding ASCII
        $dpOut = diskpart /s $dpf
        Remove-Item $dpf -EA SilentlyContinue
        if (-not (Test-Path ($wL + ':\'))) { $dpOut | ForEach-Object { Write-Host $_ }; throw 'Nao consegui preparar o disco virtual.' }

        Write-Host '##STEP 3'
        Write-Host 'Copiando o Windows para o disco da VM. Leva de 5 a 15 minutos; nao feche o Piece Helper...'
        Expand-WindowsImage -ImagePath $wim -Index $pick.ImageIndex -ApplyPath ($wL + ':\') | Out-Null
        Write-Host 'Windows copiado. Preparando a inicializacao...'
        $bOut = bcdboot ($wL + ':\Windows') /s ($sL + ':') /f UEFI
        if ($LASTEXITCODE -ne 0) { $bOut | ForEach-Object { Write-Host $_ }; throw 'Nao consegui preparar a inicializacao do Windows.' }

        Write-Host '##STEP 4'
        if ($Lite -eq '1') { Optimize-SosOffline ($wL + ':') }
        if ($SteamGlFix -eq '1') { Set-SosSteamGlFix ($wL + ':') }
        Write-Host 'Configurando o Windows para pular as telas de instalacao (usuario sem senha, sem conta da Microsoft)...'
        $tz = (Get-TimeZone).Id
        $loc = (Get-Culture).Name
        $xml = $Unattend.Replace('__UILANG__', $uiLang).Replace('__LOCALE__', $loc).Replace('__TZ__', $tz)
        $panther = $wL + ':\Windows\Panther'
        New-Item -ItemType Directory -Force -Path $panther | Out-Null
        [IO.File]::WriteAllText((Join-Path $panther 'unattend.xml'), $xml, (New-Object Text.UTF8Encoding $false))
        $script:GuestBuild = (Get-Item ($wL + ':\Windows\System32\ntoskrnl.exe')).VersionInfo.FileBuildPart

        if ($GpuId) {
            Write-Host 'Copiando os drivers da placa de video para dentro da VM...'
            Copy-SosGpuDriversTo ($wL + ':') $GpuId
        }
        if ($SteamSetup) {
            New-Item -ItemType Directory -Force -Path ($wL + ':\SOS') | Out-Null
            Copy-Item -Path $SteamSetup -Destination ($wL + ':\SOS\SteamSetup.exe') -Force
            Write-Host 'Instalador da Steam colocado na VM: ela se instala sozinha no primeiro inicio.'
        }
        if ($HelperSrc) { Install-SosHelper ($wL + ':') }
        if ($Games) {
            $lib = $wL + ':\Program Files (x86)\Steam\steamapps'
            New-Item -ItemType Directory -Force -Path (Join-Path $lib 'common') | Out-Null
            foreach ($g in @($Games | ConvertFrom-Json)) {
                Write-Host ('Copiando ' + $g.name + ' (' + $g.gb + ' GB) do seu PC para a VM...')
                $null = robocopy $g.src (Join-Path $lib ('common\' + $g.dir)) /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
                if ($LASTEXITCODE -ge 8) { Write-Host ('  aviso: alguns arquivos de ' + $g.name + ' nao foram copiados (o jogo estava aberto?). A Steam baixa o que faltar.') }
                Copy-Item -Path $g.manifest -Destination $lib -Force
                Write-Host ('  ' + $g.name + ' copiado.')
            }
        }
    }
    finally {
        Write-Host 'Fechando o disco virtual...'
        Close-SosHives
        # tira as letras que o Piece Helper deu para as partes do disco, para nao sobrar unidade fantasma no Explorador
        foreach ($l in @($sL, $wL)) {
            if ($l) {
                try { Get-Partition -DriveLetter $l -EA Stop | Remove-PartitionAccessPath -AccessPath ($l + ':') -EA Stop } catch {}
                cmd.exe /c ('mountvol ' + $l + ': /D >nul 2>&1')
            }
        }
        Dismount-VHD -Path $vhd -EA SilentlyContinue
    }
}
catch {
    if ($created -and -not (Get-VM -Name $VMName -EA SilentlyContinue)) {
        Close-SosHives
        for ($i = 0; $i -lt 5 -and (Test-Path $vhd); $i++) {
            try { Dismount-VHD -Path $vhd -EA SilentlyContinue } catch {}
            Start-Sleep -Seconds 2
            Remove-Item $vhd -Force -EA SilentlyContinue
        }
        if (Test-Path $vhd) { Write-Host ('Nao consegui apagar o disco virtual incompleto. Reinicie o PC e apague: ' + $vhd) }
        else { Write-Host 'O disco virtual incompleto foi apagado.' }
    }
    throw
}
finally {
    Dismount-DiskImage -ImagePath $Iso -EA SilentlyContinue | Out-Null
}

Write-Host '##STEP 5'
Write-Host 'Criando a maquina virtual...'
$sw = Get-VMSwitch -Name 'Default Switch' -EA SilentlyContinue
if (-not $sw) { $sw = Get-VMSwitch -EA SilentlyContinue | Select-Object -First 1 }
$p = @{ Name = $VMName; Generation = 2; MemoryStartupBytes = ([int64]$RamGB * 1GB); VHDPath = $vhd }
if ($VmDir) { New-Item -ItemType Directory -Force -Path $VmDir | Out-Null; $p.Path = $VmDir }
if ($sw) { $p.SwitchName = $sw.Name } else { Write-Host 'Aviso: nao achei uma rede virtual; a VM vai ficar sem internet.' }
New-VM @p | Out-Null
Set-VMProcessor -VMName $VMName -Count ([int]$Cpus)
Set-VMMemory -VMName $VMName -DynamicMemoryEnabled $false -StartupBytes ([int64]$RamGB * 1GB)
Set-VMFirmware -VMName $VMName -EnableSecureBoot On -SecureBootTemplate 'MicrosoftWindows'
try { Set-VMKeyProtector -VMName $VMName -NewLocalKeyProtector; Enable-VMTPM -VMName $VMName } catch { Write-Host ('Aviso (TPM): ' + $_.Exception.Message) }
Set-VM -Name $VMName -AutomaticCheckpointsEnabled $false -AutomaticStopAction ShutDown
if ($GpuId) { Add-SosGpuAdapter $VMName $GpuId }
Write-Host ('VM criada: ' + $Cpus + ' processadores, ' + $RamGB + ' GB de memoria, disco de ' + $DiskGB + ' GB.')
if ($StartVM -eq '1') { Start-VM -Name $VMName; Write-Host 'VM ligada. O primeiro inicio do Windows leva alguns minutos.' }
@{ guest = $script:GuestBuild; vhd = $vhd } | ConvertTo-Json | Set-Content -Path $ResultFile -Encoding UTF8
