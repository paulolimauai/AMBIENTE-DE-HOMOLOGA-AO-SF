# Diretriz de Apresentação Visual de Código Colorido e Localização Exata das Alterações

## 1. Identificação Precisa do Local da Alteração
- Em qualquer alteração de código, **SEMPRE** informar explicitamente:
  - **Arquivo**: Link com caminho completo e clicável (ex: [`server.js`](file:///C:/AMBIENTE%20DE%20HOMOLOGA%C3%87AO/server.js)).
  - **Localização / Seção**: Linha inicial e final afetadas (ex: `Linhas 120 a 145`).
  - **Contexto / Bloco**: Nome da função, rota ou componente alterado.

## 2. Exibição Visual Colorida em Bloco Diff
- Apresentar o código alterado utilizando blocos de código com a sintaxe `diff` colorida:
  - `@@ -L_ini,Qtd +L_novo,Qtd @@` para demarcação exata das linhas.
  - `-` Linhas vermelhas para código removido ou substituído.
  - `+` Linhas verdes para código novo adicionado.
  - Linhas de contexto em cinza/branco para visualização contínua.

## 3. Padrão Visual no VS Code e Terminal
- Manter o VS Code e ferramentas de watch configurados com realce de sintaxe de alta visibilidade, gutter markers coloridos (verde para inserção, vermelho para exclusão, azul para modificação) e visualizador de diff em tempo real.
