(function(root, factory){
  'use strict';
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.CroquisLocalityOrder = api;
  if(typeof document !== 'undefined'){
    const start = () => api.mount(document, {
      getLocalities:() => typeof LOCS === 'undefined' ? [] : LOCS,
      getGroup:() => typeof congregacionActivaId === 'undefined' ? '' : congregacionActivaId,
      label:(loc, index) => typeof territorySelectorLabel === 'function'
        ? territorySelectorLabel({...loc, displayNum:index + 1}) : loc.name,
      save:(order, group) => typeof applyLocalityOrder === 'function' && applyLocalityOrder(order, group)
    });
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
    else start();
  }
})(typeof window === 'undefined' ? globalThis : window, function(){
  'use strict';
  function normalizeOrder(raw){
    if(!Array.isArray(raw)) return [];
    const seen = new Set();
    return raw.flatMap(value => {
      if(typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) return [];
      const id = String(value).trim();
      if(!id || seen.has(id)) return [];
      seen.add(id);
      return [id];
    });
  }
  function orderedIds(locs, raw){
    const ids = normalizeOrder((locs || []).map(loc => loc.num));
    const available = new Set(ids);
    const saved = normalizeOrder(raw).filter(id => available.has(id));
    const chosen = new Set(saved);
    return saved.concat(ids.filter(id => !chosen.has(id)));
  }
  function reorder(locs, raw){
    const byId = new Map((locs || []).map(loc => [String(loc.num),loc]));
    return orderedIds(locs, raw).map(id => byId.get(id));
  }
  function moveTo(raw, id, position){
    const order = normalizeOrder(raw), from = order.indexOf(String(id));
    if(from < 0 || !Number.isFinite(Number(position))) return order;
    const to = Math.max(0, Math.min(order.length - 1, Math.trunc(Number(position)) - 1));
    order.splice(from,1);
    order.splice(to,0,String(id));
    return order;
  }
  function mount(doc, options){
    const dialog = doc.getElementById('locality-order-dialog');
    const trigger = doc.getElementById('btn-locality-order');
    const list = doc.getElementById('locality-order-list');
    const status = doc.getElementById('locality-order-status');
    if(!dialog || !trigger || !list || dialog.dataset.mounted) return;
    dialog.dataset.mounted = 'true';
    let draft = [], group = '', dragging = '', touchDrag = null;
    const rowFor = id => Array.from(list.children).find(row => row.dataset.orderId === id);
    const say = text => { status.textContent = text; };
    const focusRow = (id, selector) => {
      const element = rowFor(id)?.querySelector(selector);
      element?.focus({preventScroll:true});
      rowFor(id)?.scrollIntoView({block:'nearest'});
    };
    const arrowSvg = down => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"' + (down ? ' transform="rotate(180 12 12)"' : '') + '/></svg>';
    function render(){
      const locs = options.getLocalities();
      draft = orderedIds(locs,draft);
      const byId = new Map(locs.map(loc => [String(loc.num),loc]));
      list.replaceChildren();
      draft.forEach((id,index) => {
        const loc = byId.get(id), label = options.label(loc,index);
        const row = doc.createElement('li');
        row.className = 'locality-order-row'; row.dataset.orderId = id;
        const handle = doc.createElement('button');
        handle.type = 'button'; handle.draggable = true; handle.className = 'locality-order-handle';
        handle.dataset.orderDrag = ''; handle.title = 'Arrastrar para cambiar de puesto';
        handle.setAttribute('aria-label','Mover ' + label + '. También puedes usar las flechas del teclado.');
        handle.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="8" cy="5" r="1.5"/><circle cx="16" cy="5" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="19" r="1.5"/><circle cx="16" cy="19" r="1.5"/></svg>';
        const input = doc.createElement('input');
        input.type = 'number'; input.inputMode = 'numeric'; input.min = '1'; input.max = String(draft.length);
        input.value = String(index + 1); input.className = 'locality-order-position';
        input.setAttribute('aria-label','Puesto de ' + label);
        const name = doc.createElement('span');
        name.className = 'locality-order-name'; name.textContent = label;
        row.append(handle,input,name);
        [-1,1].forEach(delta => {
          const button = doc.createElement('button');
          button.type = 'button'; button.className = 'locality-order-step'; button.dataset.orderDelta = String(delta);
          button.disabled = delta < 0 ? index === 0 : index === draft.length - 1;
          button.setAttribute('aria-label',(delta < 0 ? 'Subir ' : 'Bajar ') + label);
          button.title = delta < 0 ? 'Subir un puesto' : 'Bajar un puesto';
          button.innerHTML = arrowSvg(delta > 0); row.append(button);
        });
        list.append(row);
      });
    }
    function move(id, position, focusSelector = '.locality-order-handle'){
      draft = moveTo(draft,id,position); render(); focusRow(id,focusSelector);
      say('Localidad en el puesto ' + (draft.indexOf(id) + 1) + '.');
    }
    function changePosition(input){
      const id = input.closest('[data-order-id]').dataset.orderId;
      const position = Number(input.value);
      if(!input.value || !Number.isInteger(position) || position < 1 || position > draft.length){
        input.value = String(draft.indexOf(id) + 1);
        say('Escribe un puesto del 1 al ' + draft.length + '.'); return;
      }
      move(id,position,'.locality-order-position');
    }
    trigger.addEventListener('click',() => {
      group = options.getGroup();
      if(!group || options.getLocalities().length < 2) return;
      draft = orderedIds(options.getLocalities(),[]); say(''); render(); dialog.showModal();
    });
    const close = () => dialog.close();
    doc.getElementById('locality-order-close').addEventListener('click',close);
    doc.getElementById('locality-order-cancel').addEventListener('click',close);
    dialog.addEventListener('close',() => { touchDrag = null; dragging = ''; trigger.focus({preventScroll:true}); });
    doc.getElementById('locality-order-save').addEventListener('click',() => {
      if(options.getGroup() !== group){ say('La congregación cambió. Cierra y vuelve a abrir esta lista.'); return; }
      const order = orderedIds(options.getLocalities(),draft);
      if(options.save(order,group)) close();
      else say('No se pudo guardar el orden. Intenta de nuevo.');
    });
    list.addEventListener('click',event => {
      const button = event.target.closest('[data-order-delta]'); if(!button) return;
      const id = button.closest('[data-order-id]').dataset.orderId;
      move(id,draft.indexOf(id) + 1 + Number(button.dataset.orderDelta),'.locality-order-position');
    });
    list.addEventListener('change',event => { if(event.target.matches('.locality-order-position')) changePosition(event.target); });
    list.addEventListener('keydown',event => {
      if(event.target.matches('.locality-order-position') && event.key === 'Enter'){
        event.preventDefault(); changePosition(event.target);
      }
      if(!event.target.closest('[data-order-drag]') || !['ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const id = event.target.closest('[data-order-id]').dataset.orderId;
      move(id,draft.indexOf(id) + 1 + (event.key === 'ArrowUp' ? -1 : 1));
    });
    list.addEventListener('dragstart',event => {
      const handle = event.target.closest('[data-order-drag]'); if(!handle){event.preventDefault();return;}
      dragging = handle.closest('[data-order-id]').dataset.orderId;
      event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain',dragging);
      rowFor(dragging)?.classList.add('is-dragging');
    });
    const clearTarget = () => list.querySelectorAll('.is-drop-target').forEach(row => row.classList.remove('is-drop-target'));
    list.addEventListener('dragover',event => {
      if(!dragging) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; clearTarget();
      event.target.closest('[data-order-id]')?.classList.add('is-drop-target');
    });
    list.addEventListener('drop',event => {
      const row = event.target.closest('[data-order-id]'); if(!dragging || !row) return;
      event.preventDefault(); const id = dragging; dragging = ''; move(id,draft.indexOf(row.dataset.orderId) + 1);
    });
    list.addEventListener('dragend',() => { dragging = ''; clearTarget(); list.querySelector('.is-dragging')?.classList.remove('is-dragging'); });
    // El asa también admite arrastre táctil; la lista se desplaza normalmente
    // cuando el dedo empieza fuera del asa.
    list.addEventListener('pointerdown',event => {
      const handle = event.target.closest('[data-order-drag]');
      if(!handle || event.pointerType === 'mouse') return;
      handle.setPointerCapture(event.pointerId);
      touchDrag = {id:handle.closest('[data-order-id]').dataset.orderId, target:'', pointer:event.pointerId};
      rowFor(touchDrag.id)?.classList.add('is-dragging');
    });
    list.addEventListener('pointermove',event => {
      if(!touchDrag || touchDrag.pointer !== event.pointerId) return;
      const row = doc.elementFromPoint(event.clientX,event.clientY)?.closest('[data-order-id]');
      clearTarget(); touchDrag.target = row?.dataset.orderId || '';
      row?.classList.add('is-drop-target');
      const body = list.closest('.workspace-dialog-body'), bounds = body.getBoundingClientRect();
      if(event.clientY < bounds.top + 45) body.scrollTop -= 18;
      if(event.clientY > bounds.bottom - 45) body.scrollTop += 18;
    });
    const finishTouch = event => {
      if(!touchDrag || touchDrag.pointer !== event.pointerId) return;
      const drag = touchDrag; touchDrag = null; clearTarget();
      rowFor(drag.id)?.classList.remove('is-dragging');
      if(event.type === 'pointerup' && drag.target) move(drag.id,draft.indexOf(drag.target) + 1);
    };
    list.addEventListener('pointerup',finishTouch); list.addEventListener('pointercancel',finishTouch);
  }
  return {normalizeOrder,orderedIds,reorder,moveTo,mount};
});
