# Gerador de Tabela de Preços

Este projeto gera uma imagem PNG a partir de um template HTML/CSS moderno.

## Como usar

1. Edite o arquivo `index.html` e altere a variável `data` no final do arquivo com os novos preços/medidas.
2. Execute o comando abaixo para gerar a nova imagem:

```bash
google-chrome --headless --disable-gpu --screenshot=tabela_precos.png --window-size=1100,1600 projects/price-list/index.html
```

(Ou peça para a Vicky: "Gera a tabela de preços de novo com os dados atualizados")

## Estrutura

- `index.html`: Template visual (HTML + CSS + Dados JSON).
- `tabela_precos.png`: Resultado gerado (não versionado, gerado sob demanda).
