# Diretrizes Globais do Projeto (Auto-Approve, Auto-Exec & Auto-Git Sync)

## 1. Execução Imediata no Terminal e Aprovação Automática Total (Zero Interrupts / Zero Confirmações / Sem "Yes" ou "OK")
- **Aceitação Prévia e Irrestrita**: Qualquer pedido de alteração, melhoria, correção ou comando feito pelo usuário é automaticamente e previamente aprovado. O usuário **NÃO PRECISA digitar "yes", "ok", dar enter ou clicar em botões de confirmação no teclado**.
- **Execução Direta e Sem Perguntas**: Todo e qualquer comando de terminal (`run_command`, scripts, ferramentas, deploys, inicialização de servidores) deve ser executado **IMEDIATAMENTE e DIRETAMENTE SEM NUNCA PEDIR CONFIRMAÇÃO** ao usuário.
- **Modificação Direta de Arquivos**: Todo e qualquer arquivo deve ser criado, editado ou excluído diretamente de ponta a ponta sem pedir permissão prévia.
- **Sem Pausas, Dúvidas ou Interrupções**: **NUNCA** pausar, perguntar ou aguardar validação (*"Posso executar o comando?"*, *"Deseja que eu rode o teste?"*, *"Posso aplicar as alterações?"*, *"Quer que eu envie para o Git?"*, *"Como deseja proceder?"*).
- **Validação e Auto-Correção Autônoma**: O próprio agente valida a sintaxe (ex: `node --check server.js`), integridade, testes e coerência das alterações, corrigindo autonomamente eventuais erros até entregar a solução 100% funcional.
- **Configuração Permanente**: Esta diretriz de auto-execução, auto-validação e auto-aprovação permanente é contínua e memorizada permanentemente até solicitação explícita do usuário em contrário.

## 2. Validação Total Autônoma e Resiliência Operacional (Sem Impedimentos)
- **Auto-Validação Silenciosa**: Todas as verificações de código, testes de rotas, integridade de banco de dados e sintaxe são executadas autonomamente.
- **Resiliência e Continuidade Operacional**: O projeto deve manter-se sempre em estado operacional. Em caso de indisponibilidade de serviços externos ou banco de dados remoto, o sistema utiliza fallbacks locais (ex: JSON local) para continuar funcionando sem interrupção.
- **Auto-Healing**: Diante de qualquer erro ou advertência de runtime, o agente diagnostica a causa raiz e aplica a correção diretamente sem exigir intervenção manual.

## 3. Sincronização Obrigatória e Automática com o Git (Auto-Push)
- **Sempre Subir ao Finalizar**: Ao concluir qualquer alteração, comando, correção ou nova funcionalidade, **SEMPRE** sincronizar com o repositório Git automaticamente sem perguntar.
- **Fluxo de Sincronização Git**:
  1. `git status` para verificar as alterações.
  2. `git add .` para incluir todas as alterações relevantes.
  3. `git commit -m "<descrição objetiva da alteração realizada>"`
  4. `git push origin <branch_atual>`
- **Garantia de Envio**: O push para o repositório remoto deve ser executado e confirmado antes de dar a resposta final ao usuário.

## 4. Apresentação Visual Colorida e Localização Exata das Alterações (Diff Padrão Antigravity)
- **Indicação Exata de Onde Está Sendo Alterado**: Ao alterar qualquer código, **SEMPRE** identificar:
  - Arquivo modificado com link clicável.
  - Intervalo de linhas afetado (`Linhas X a Y`).
  - Função, classe ou bloco correspondente.
- **Bloco de Código Colorido no Formato Diff**: Apresentar o trecho modificado com sintaxe `diff` colorida:
  - `@@ -L_orig,Qtd +L_nova,Qtd @@` (demarcador de linha)
  - `-` Linhas vermelhas para código antigo removido/substituído
  - `+` Linhas verdes para código novo inserido
  - Linhas de contexto para facilitar a leitura imediata
