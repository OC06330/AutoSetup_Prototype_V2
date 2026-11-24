# Gravação manual: adicionar Accepted Domain no Awin UI (Main Settings)

Contexto: gravação dos eventos reais do DOM (cliques, teclado, foco e mutações) feita enquanto um humano adicionava um domínio com sucesso. Use como referência para corrigir a extensão Chrome. Na extensão, o passo `applyMain` falhava com "no answer after 60 s; not seen on the page afterwards".

- Página: `https://ui.awin.com/tracking-settings/us/awin/advertiser/129791/main-settings`
- App: Angular (atributos `_ngcontent-ng-c…`, classes `ng-touched` / `ng-dirty` / `ng-valid`, Reactive Forms)
- Domínio adicionado: `greenwood-group.myshopify.com`
- Resultado: sucesso. Depois do Save, a lista foi re-renderizada com 5 tags, incluindo o novo domínio.

## Elementos envolvidos

| Elemento | Seletor confiável | Observações |
|---|---|---|
| Input do novo domínio | `#newValidDomain` | `type="text"`, tem `formcontrolname`, placeholder "E.g. example.com .example.com" |
| Botão "+" (adicionar) | `#newValidDomain` → `.closest('.input-group')` → `.input-group-append span.input-group-text a` | O `<a>` **não tem `href`, nem classe, nem id**: só o atributo `_ngcontent`. Dentro dele há `<i class="fa-regular fa-plus">`. O humano clicou no `<i>` e o clique subiu (bubble) até o `<a>`, onde está o `(click)` do Angular. |
| Tags de domínio | `div.tags.mt-1` | Uma por domínio, com o texto do domínio e um `a.deleteTag.close` ("x") |
| Remover tag | `div.tags a.deleteTag.close` | — |
| Salvar | `button[type=submit].btn.btn-default` (texto "Save") | É o único da página. Envia `form.form-horizontal.p-form` |

## Sequência gravada (eventos relevantes, em ms desde o início)

1. **Limpar o campo** (0–18 s): mousedown/click no `#newValidDomain`, `Backspace` (`input` com `deleteContentBackward`) e clique fora. Ao perder o foco, o campo disparou `change` e `focusout`.
2. **Focar o campo** (19.4 s): `mousedown` → `focusin` → `click` em `#newValidDomain`.
3. **Colar o domínio** (20.4 s): `Ctrl+V` → `paste` → `input` com value = `greenwood-group.myshopify.com`. **Não houve `change` aqui.**
4. **Clicar no "+"** (22.9 s), nesta ordem exata:
   - `mousedown` em `i.fa-regular.fa-plus`
   - `change` no `#newValidDomain` (value = domínio), **disparado pelo blur que o mousedown causou**
   - `focusout` no `#newValidDomain`
   - `click` em `i.fa-regular.fa-plus`
   - **3 ms depois:** o DOM ganhou um `div.tags.mt-1` com o texto "greenwood-group.myshopify.com" e um `a.deleteTag.close` (a tag foi criada no client)
5. **Salvar** (27.7 s): `mousedown` → `focusin` → `click` em `button` "Save" → `submit` do form.
6. **Resposta do servidor** (~3,8 s após o submit): a lista inteira de tags foi re-renderizada (`advance7.shop`, `*.advance7.shop`, `advance7shop.myshopify.com`, `*.advance7shop.myshopify.com`, `greenwood-group.myshopify.com`) junto com um tooltip. Isso indica que o salvamento foi confirmado.

## Diagnóstico provável da falha na extensão

1. **O valor não chega ao FormControl.** Definir só `input.value = '...'` não atualiza o Reactive Form do Angular. No fluxo humano, o Angular recebeu `input` (ao colar) e depois `change` + `blur` antes do clique. A extensão precisa reproduzir isso.
2. **O alvo do clique está errado ou não é encontrado.** O `<a>` do "+" não tem `href`, classe nem texto, então seletores como `a[href]`, `button`, `[title*=add]` ou busca por texto falham. Use a navegação relativa ao input, como mostrado acima.
3. **Falta esperar.** A tag aparece cerca de 3 ms depois do clique no "+". Já o Save só se confirma cerca de 4 s depois do submit, quando a lista é re-renderizada. A verificação "seen on the page" precisa procurar `div.tags` contendo o domínio, com polling ou um `MutationObserver`.
4. **Sem Save, nada persiste.** O "+" só cria a tag localmente.

## Implementação sugerida (content script)

```js
async function addAcceptedDomain(domain, { save = true, timeoutMs = 15000 } = {}) {
  const input = document.querySelector('#newValidDomain');
  if (!input) throw new Error('#newValidDomain não encontrado');

  const hasTag = () =>
    [...document.querySelectorAll('div.tags')].some(t =>
      t.textContent.replace(/\s*x\s*$/, '').trim() === domain);
  if (hasTag()) return 'already-present';

  // 1) Foco + valor pelo setter nativo, para o Angular enxergar a mudança
  input.focus();
  input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, domain);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: domain }));

  // 2) Mesma ordem do humano: change + blur antes do clique
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  input.blur();

  // 3) Clique no <a> do "+" (sem href/classe): relativo ao input
  const plus = input.closest('.input-group')
    ?.querySelector('.input-group-append span.input-group-text a');
  if (!plus) throw new Error('botão + não encontrado');
  const icon = plus.querySelector('i.fa-plus') || plus;
  for (const type of ['mousedown', 'mouseup', 'click']) {
    icon.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }

  // 4) Esperar a tag aparecer no client
  await waitFor(hasTag, 3000, 'tag não apareceu após clicar no +');
  if (!save) return 'added-not-saved';

  // 5) Save e esperar a re-renderização vinda do servidor
  const saveBtn = document.querySelector('button[type=submit].btn.btn-default');
  if (!saveBtn) throw new Error('botão Save não encontrado');
  const before = document.querySelector('div.tags');
  saveBtn.click();
  await waitFor(() => hasTag() && document.querySelector('div.tags') !== before,
    timeoutMs, 'Save não confirmou (lista não re-renderizou)');
  return 'saved';
}

function waitFor(cond, timeoutMs, msg) {
  return new Promise((resolve, reject) => {
    if (cond()) return resolve();
    const obs = new MutationObserver(() => { if (cond()) { obs.disconnect(); clearTimeout(to); resolve(); } });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    const to = setTimeout(() => { obs.disconnect(); reject(new Error(msg)); }, timeoutMs);
  });
}
```

Notas:
- Se os eventos sintéticos não forem aceitos (`isTrusted: false`), há duas alternativas: usar `chrome.debugger` com `Input.dispatchMouseEvent` / `Input.insertText` para gerar eventos confiáveis, ou chamar `plus.click()` diretamente no `<a>`. Na gravação, todos os eventos eram `isTrusted: true`.
- O content script precisa rodar no mundo da página ou ter acesso ao DOM principal. O form não está em iframe nem em shadow DOM.
- Normalize o domínio antes (sem `https://`, sem barra final). O placeholder aceita `example.com` e `.example.com`, e a lista também tem entradas com `*.`.
