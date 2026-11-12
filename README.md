# Piece Helper

App da guilda **Piece화** (Grand Chase Classic) para Windows. Junta, num lugar só:

- **Troca de contas** da Steam (e Riot, Ubisoft e Battle.net em beta): troca de conta com um clique e o botão "Jogar GC".
- **Máquina virtual com placa de vídeo**: cria uma VM do Hyper-V do zero (baixa o Windows da Microsoft, instala sozinho, deixa o Windows leve, coloca a placa de vídeo, instala a Steam e copia o Grand Chase), para abrir uma segunda conta no mesmo PC.

## Baixar

Vá em [**Releases**](../../releases/latest) e baixe o `.zip`. Extraia a pasta inteira num lugar fixo e abra o `PieceHelper.exe`.
O Windows pode mostrar "O Windows protegeu o computador" porque o app não é assinado: clique em **Mais informações → Executar assim mesmo**.

## Requisitos da máquina virtual

- **Windows 10/11 Pro, Education ou Enterprise** (o Home não tem Hyper-V).
- **Virtualização ligada na BIOS** (SVM na AMD, VT-x na Intel).
- **Placa de vídeo compatível com GPU-P** (a maioria das NVIDIA, AMD e Intel atuais; notebooks com NVIDIA costumam não funcionar). O app avisa se a sua não for.
- Abrir o Piece Helper **como administrador** para a parte da VM (a própria tela tem o botão).
- Recomendado: o **mesmo Windows** no PC e na VM (11 com 11, 10 com 10).
- Cada VM precisa da sua própria licença do Windows para ser ativada.
- Alguns jogos com anti-cheat não abrem em máquinas virtuais; o app não tenta esconder a VM.

## Segurança

O app não guarda senhas: só troca os arquivos de sessão que os próprios launchers criam, com backup antes.

## Créditos

- Troca de contas inspirada no [TcNo Account Switcher](https://github.com/TCNOco/TcNo-Acc-Switcher).
- Cópia de drivers da placa adaptada do [Easy-GPU-PV](https://github.com/jamesstringerparsec/Easy-GPU-PV) (MIT).
- Download do Windows pelo [Fido](https://github.com/pbatard/Fido) (GPLv3), baixado do GitHub oficial na hora.

Feito com [Electron](https://www.electronjs.org/). Licença: GPL-3.0.
