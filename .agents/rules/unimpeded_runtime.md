# Diretriz de Validação Contínua e Operação Sem Impedimentos (Unimpeded Runtime)

## 1. Auto-Validação Total Sem Necessidade de Confirmação
- Todas as validações (sintaxe, testes, integridade de arquivos, rotas e dependências) devem ser executadas de forma 100% autônoma e silenciosa.
- Nunca interromper o fluxo solicitando confirmação ao usuário para executar validações, corrigir erros ou aplicar ajustes necessários.
- Caso ocorra qualquer inconsistência ou erro em tempo de execução/sintaxe, o agente deve diagnosticar e corrigir automaticamente (auto-healing) até a estabilização completa.

## 2. Permanência da Configuração
- Esta diretriz tem caráter **permanente e obrigatório**.
- Ela permanece ativa e irrevogável em todas as interações e sessões, até que o usuário solicite expressamente e por escrito a sua alteração ou desativação.

## 3. Projeto Operando Sem Impedimentos
- O ambiente deve sempre permanecer funcional, resiliente e executável.
- Falhas de infraestrutura externa (ex: conexão remota com banco) devem acionar fallback automático transparente (ex: armazenamento JSON local).
- Ao concluir qualquer ciclo de validação ou melhoria, a sincronização Git (`git add`, `git commit`, `git push`) deve ser efetuada imediatamente de forma autônoma.
