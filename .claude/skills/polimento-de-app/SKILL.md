---
name: polimento-de-app
description: "Use esta skill quando o usuário pedir para 'polir', 'dar o acabamento', 'deixar do meu jeito' ou 'aplicar as melhorias de sempre' em um app web (React/PWA ou similar), normalmente no fim de um projeto. Ela reúne as preferências de experiência de uso do usuário: navegação com rolagem previsível, imagens que nunca somem nem embaçam, trabalho pesado em segundo plano com progresso visível, listas limpas e recolhíveis, dados sincronizados entre celular e computador, tratamento de erros sem tela travada, e publicação automática. Aplicar como checklist: verificar item a item, implementar o que faltar e testar no navegador antes de publicar."
---

# Polimento de app: as melhorias de sempre

Checklist do acabamento que o usuário quer em todo app. Percorra cada item,
implemente o que estiver faltando e teste no navegador (Playwright) antes de
publicar. Explique em português do Brasil, com frases curtas, o que mudou.

## 1. Navegação e rolagem

- Abrir uma tela nova (tocar num card, num link) começa **no topo**.
- **Voltar** restaura a posição exata da lista de onde o usuário saiu, esperando
  a lista carregar (dados assíncronos) antes de rolar.
- Um componente único cuida disso (ex.: `ScrollManager` com
  `useLocation` + `useNavigationType`: `POP` restaura, o resto vai ao topo).
- Vários tabs/janelas abertos não podem travar o app: ao atualizar o esquema
  do banco local, a aba antiga recarrega sozinha e a nova mostra
  "Atualizando…" com instrução em vez de "Carregando…" sem fim.

## 2. Imagens (capas, fotos)

- Nunca mostrar ícone quebrado nem texto por cima: `<img alt="">` invisível
  até o `onLoad`; container com `role="img"` e `aria-label`.
- Reiniciar o estado de carregamento **durante a renderização** (padrão
  "prevKey"), nunca em `useEffect`: imagem em cache dispara `onLoad` antes do
  efeito e ficaria invisível para sempre.
- Cadeia de fontes em ordem de preferência (principal → reserva → miniatura),
  com segunda tentativa da principal após 2 s; depois um ícone neutro.
- Tamanho certo para cada lugar: ~500 px em cards, ~250 px em listas, versão
  grande (1000–1200 px) na tela de detalhe, carregada **por trás** e trocada
  quando terminar (primeiro mostra a mesma imagem que o card já tem em cache).
- `crossOrigin="anonymous"` só em hosts que respondem CORS; cache offline
  (service worker) restrito a `request.destination === 'image'` e a respostas
  200, nunca domínios de API.
- Preferir fontes com CDN rápida como reserva quando a principal oscila.

## 3. Trabalho pesado em segundo plano

- Importações, buscas em APIs externas e cálculos longos rodam numa **fila
  global fora do React** (continua ao trocar de tela) e retomam ao reabrir o
  app.
- Barra fixa e discreta com o que está rodando ("Importando X · 12 de 40"),
  com Parar / Continuar / Fechar, visível em qualquer tela.
- Ações que o usuário está esperando (buscar, abrir detalhe) têm prioridade
  sobre o segundo plano; uma importação nova interrompe tarefas longas e as
  devolve à fila.
- Respeitar limites das APIs (fila com espaçamento, `Retry-After`, tentativas
  em 503/429) e cancelar buscas antigas ao continuar digitando (AbortSignal,
  ~300 ms de atraso).
- Remover repetidos antes de gravar em lote; nunca deixar uma tarefa
  travar sem mensagem (contar falhas e parar com erro visível).

## 4. Listas e telas

- Topo enxuto: busca + um "Ordenar"; filtros escondidos atrás de um botão
  com contador e "Limpar"; totais numa linha discreta, não em caixas.
- Agrupamentos recolhíveis quando a lista cresce (grupo = linha com foto,
  nome, contagem e seta ▸/▾; começa recolhido; lembra o que ficou aberto;
  busca abre os grupos com resultado).
- Hierarquia visual clara entre grupo e item: faixa colorida à esquerda,
  rótulo pequeno em caixa alta, foto redonda para pessoa/grupo e quadrada
  para item, itens recuados com traço fino, espaço maior entre grupos.
- Filtro/busca nunca some enquanto se digita (basear a exibição no total, não
  no resultado filtrado); estado vazio com frase útil.
- Informação sensível ou "de bastidor" (ex.: valor pago) fica só no
  formulário, fora das visualizações.
- Botões de ação no cabeçalho agrupados na mesma linha; um único botão
  primário por tela.

## 5. Dados e sincronização

- Offline-first: tudo funciona sem internet; dados no IndexedDB (Dexie).
- Sincronização opcional por conta (e-mail e senha), "último a gravar
  ganha", com `uid` global determinístico por registro (o mesmo item em dois
  aparelhos nunca duplica), flag `dirty` marcada por middleware, exclusões
  com lápides, e "desde quando" pelo relógio do **servidor**.
- Dados pré-carregados nascem com data fixa antiga e não sujos: qualquer
  edição do usuário ganha deles.
- Migrações de esquema sempre em versão nova; garantir unicidade antes de
  criar índices únicos (com sufixo em colisão); nunca alterar versão publicada.
- Exportar/importar backup JSON nas configurações.
- Valores calculados automaticamente nunca sobrescrevem o que o usuário
  editou à mão (guardar `source: manual`).

## 6. Erros e estados

- Falha ao abrir o banco: tela com a mensagem e botão "Recarregar", nunca
  "Carregando…" infinito.
- Mensagens de erro em português, dizendo o que aconteceu e o que fazer.
- Indicador de conexão/sincronização no cabeçalho (☁ sincronizado / offline).

## 7. Publicação

- Deploy automático a cada push (GitHub Pages ou similar), caminho base
  calculado pelo nome do repositório, `404.html` = cópia do `index.html`.
- PWA instalável (manifest, ícones, service worker com atualização
  automática); orientar a fechar e abrir o app após publicar.
- Chaves de serviços só em secrets do CI ou `.env`; nunca no repositório.

## Como aplicar

1. Ler o `CLAUDE.md` do projeto e listar quais itens acima já existem.
2. Implementar o que falta, um grupo por commit, com mensagem em português.
3. Testar no navegador cada comportamento alterado (rolagem, imagens,
   segundo plano, listas), inclusive o caminho de "voltar" e cache quente.
4. Publicar e resumir para o usuário o que mudou, sem jargão.
