# Diretrizes Globais do Projeto (Auto-Approve, Auto-Exec & Auto-Git Sync)

## 1. Execução Imediata no Terminal e Aprovação Automática Total (Zero Interrupts / Zero Confirmações)
- **Execução Direta e Sem Perguntas**: Todo e qualquer comando de terminal (`run_command`, scripts, ferramentas, deploys, inicialização de servidores) deve ser executado **IMEDIATAMENTE e DIRETAMENTE SEM NUNCA PEDIR CONFIRMAÇÃO** ao usuário.
- **Modificação Direta de Arquivos**: Todo e qualquer arquivo deve ser criado, editado ou excluído diretamente de ponta a ponta sem pedir permissão prévia.
- **Sem Pausas ou Interrupções**: **NUNCA** pausar ou perguntar (*"Posso executar o comando?"*, *"Deseja que eu rode o teste?"*, *"Posso aplicar as alterações?"*, *"Quer que eu envie para o Git?"*).
- **Validação e Auto-Correção Autônoma**: O próprio agente valida a sintaxe (ex: `node --check server.js`), integridade, testes e coerência das alterações, corrigindo autonomamente eventuais erros até entregar a solução 100% funcional.
- **Configuração Permanente**: Esta diretriz de auto-execução e auto-aprovação permanente é contínua e memorizada permanentemente até solicitação explícita do usuário em contrário.

## 2. Sincronização Obrigatória e Automática com o Git (Auto-Push)
- **Sempre Subir ao Finalizar**: Ao concluir qualquer alteração, comando, correção ou nova funcionalidade, **SEMPRE** sincronizar com o repositório Git automaticamente sem perguntar.
- **Fluxo de Sincronização Git**:
  1. `git status` para verificar as alterações.
  2. `git add .` para incluir todas as alterações relevantes.
  3. `git commit -m "<descrição objetiva da alteração realizada>"`
  4. `git push origin <branch_atual>`
- **Garantia de Envio**: O push para o repositório remoto deve ser executado e confirmado antes de dar a resposta final ao usuário.

## 3. Apresentação Visual de Alterações de Código (Padrão Antigravity CLI Diff)
- **Apresentação no Formato Diff**: Ao programar ou alterar qualquer trecho de código, **SEMPRE** apresentar as alterações em bloco visual de `diff` com numeração de linhas, destacando claramente:
  - Linhas originais removidas (`-`)
  - Linhas novas adicionadas (`+`)
  - Linhas de contexto imediatas para rastreabilidade
  Exatamente como na visualização interativa do Antigravity CLI no terminal do VS Code.

