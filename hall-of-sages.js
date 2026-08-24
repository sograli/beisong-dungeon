(() => {
  const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const data = () => Array.isArray(window.SAGE_HALL_DATA) ? window.SAGE_HALL_DATA : [];
  let pending = null;
  let pageIndex = 0;
  let timer = 0;
  let visibleElapsed = 0;
  let lastTick = 0;

  function hallState() {
    state.sageHall = state.sageHall && typeof state.sageHall === 'object' ? state.sageHall : {};
    state.sageHall.fragments = state.sageHall.fragments && typeof state.sageHall.fragments === 'object' ? state.sageHall.fragments : {};
    state.sageHall.drawTickets = Math.max(0, Math.floor(Number(state.sageHall.drawTickets) || 0));
    state.sageHall.lastCheckIn = typeof state.sageHall.lastCheckIn === 'string' ? state.sageHall.lastCheckIn : '';
    return state.sageHall;
  }

  function progress() { return hallState().fragments }
  function localDayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function isOwned(coreId) { return !!progress()[coreId] }
  function allCores() { return data().flatMap(sage => sage.cores.map(core => ({sage, core}))) }

  function ensureView() {
    if (document.querySelector('#sageHallView')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <section class="view sage-hall-view" id="sageHallView">
        <header class="sage-hall-head"><div class="sage-hall-title"><i>Ω</i><div><h1>英灵殿</h1><p>与十位哲人相遇，收集思想碎片</p></div></div><button class="sage-hall-back" id="leaveSageHall">回到庄园</button></header>
        <nav class="sage-hall-tabs"><button class="on" data-sage-tab="draw">抽取</button><button data-sage-tab="gallery">哲人图鉴</button></nav>
        <main class="sage-hall-body"><div id="sageDrawPane" class="sage-draw-pane"></div><div id="sageGalleryPane" hidden></div></main>
      </section>
      <section class="sage-study-modal" id="sageStudyModal" hidden><div class="sage-study-box" id="sageStudyBox"></div></section>`);
    const manor = document.querySelector('#manorView .manor-scene');
    if (manor && !manor.querySelector('.manor-hall')) manor.insertAdjacentHTML('beforeend','<button class="manor-building manor-hall" data-open-sage-hall="1"><i>Ω</i><b>英灵殿</b><small>哲思与英灵</small></button>');
    document.querySelector('#leaveSageHall').onclick = () => openManor();
    document.querySelectorAll('[data-sage-tab]').forEach(button => button.onclick = () => selectTab(button.dataset.sageTab));
    document.addEventListener('click', event => {
      const entrance = event.target.closest('[data-open-sage-hall]');
      if (!entrance) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openSageHall();
    }, true);
  }

  function openSageHall() {
    progress();
    show('#sageHallView');
    document.querySelector('.game-nav').style.display = 'none';
    selectTab('draw');
  }
  window.openSageHall = openSageHall;

  function selectTab(tab) {
    document.querySelectorAll('[data-sage-tab]').forEach(button => button.classList.toggle('on', button.dataset.sageTab === tab));
    document.querySelector('#sageDrawPane').hidden = tab !== 'draw';
    document.querySelector('#sageGalleryPane').hidden = tab !== 'gallery';
    if (tab === 'draw') renderDraw(); else renderGallery();
  }

  function renderDraw() {
    const hall = hallState();
    const checked = hall.lastCheckIn === localDayKey();
    document.querySelector('#sageDrawPane').innerHTML = `<div class="sage-summon"><div class="sage-summon-orb">Ω</div><h2>召唤思想碎片</h2><div class="sage-checkin"><div><span>今日签到</span><b>抽卡次数 ${hall.drawTickets}</b></div><button class="sage-action" id="sageDailyCheckIn" ${checked ? 'disabled' : ''}>${checked ? '今日已签到' : '签到 +1'}</button></div><p>每次将随机遇见一条核心命题。完整浏览全部段落，碎片才会回应你。</p><button class="sage-action" id="drawSageCore" ${hall.drawTickets > 0 ? '' : 'disabled'}>抽取核心命题</button></div>`;
    document.querySelector('#sageDailyCheckIn').onclick = dailyCheckIn;
    document.querySelector('#drawSageCore').onclick = drawCore;
  }

  function dailyCheckIn() {
    const hall = hallState();
    const today = localDayKey();
    if (hall.lastCheckIn === today) return toast('今天已经签到过了');
    hall.lastCheckIn = today;
    hall.drawTickets += 1;
    save();
    renderDraw();
    toast('签到成功，获得 1 次抽卡次数');
  }

  function drawCore() {
    const all = allCores();
    const missing = all.filter(item => !isOwned(item.core.id));
    const pool = missing.length ? missing : all;
    if (!pool.length) return toast('英灵殿数据尚未载入');
    const hall = hallState();
    if (hall.drawTickets < 1) return toast('抽卡次数不足，请先完成今日签到');
    hall.drawTickets -= 1;
    save();
    const random = window.crypto?.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 0xffffffff);
    pending = pool[random % pool.length];
    pageIndex = 0;
    const box = document.querySelector('#sageStudyBox');
    box.innerHTML = `<button class="sage-study-close" id="cancelSageDraw">× 放弃</button><div class="sage-draw-result"><div class="sage-draw-icon">${h(pending.core.title.charAt(0))}</div><h2>${h(pending.core.title)}</h2><button class="sage-action" id="beginSageStudy">开始学习</button></div>`;
    document.querySelector('#sageStudyModal').hidden = false;
    document.querySelector('#cancelSageDraw').onclick = failDraw;
    document.querySelector('#beginSageStudy').onclick = () => renderStudyPage(0);
  }

  function renderStudyPage(index) {
    clearInterval(timer);
    pageIndex = index;
    visibleElapsed = 0;
    lastTick = performance.now();
    const paragraphs = pending.core.paragraphs;
    const last = index === paragraphs.length - 1;
    document.querySelector('#sageStudyBox').innerHTML = `<button class="sage-study-close" id="cancelSageStudy">× 放弃</button><div class="sage-study-page"><div class="sage-study-meta"><span>${h(pending.core.title)}</span><span>${index + 1}/${paragraphs.length}</span></div><h3>思想段落</h3><p>${h(paragraphs[index])}</p><div class="sage-study-controls"><small id="sagePageWait">请浏览 5 秒</small><button class="sage-action" id="sagePageNext" disabled>${last ? '完成学习' : '下一段'}</button></div></div>`;
    document.querySelector('#cancelSageStudy').onclick = failDraw;
    const next = document.querySelector('#sagePageNext');
    timer = setInterval(() => {
      const now = performance.now();
      if (!document.hidden) visibleElapsed += now - lastTick;
      lastTick = now;
      const remain = Math.max(0, 5000 - visibleElapsed);
      document.querySelector('#sagePageWait').textContent = remain ? `请浏览 ${Math.ceil(remain / 1000)} 秒` : '可以继续';
      if (!remain) { clearInterval(timer); next.disabled = false }
    }, 100);
    next.onclick = () => last ? completeDraw() : renderStudyPage(index + 1);
  }

  function completeDraw() {
    clearInterval(timer);
    progress()[pending.core.id] = Date.now();
    save();
    document.querySelector('#sageStudyBox').innerHTML = `<div class="sage-draw-result"><div class="sage-draw-icon">✓</div><div class="sage-result-status">获取碎片成功</div><button class="sage-action" id="finishSageDraw">查看图鉴</button></div>`;
    pending = null;
    document.querySelector('#finishSageDraw').onclick = () => { document.querySelector('#sageStudyModal').hidden = true; selectTab('gallery') };
  }

  function failDraw() {
    clearInterval(timer);
    pending = null;
    document.querySelector('#sageStudyBox').innerHTML = `<div class="sage-draw-result"><div class="sage-draw-icon">×</div><div class="sage-result-status fail">获取失败，本次抽卡无效</div><button class="sage-action" id="closeFailedDraw">返回英灵殿</button></div>`;
    document.querySelector('#closeFailedDraw').onclick = () => { document.querySelector('#sageStudyModal').hidden = true; renderDraw() };
  }

  function renderGallery() {
    document.querySelector('#sageGalleryPane').innerHTML = `<div class="sage-gallery">${data().map(renderSage).join('')}</div>`;
  }

  function renderSage(sage) {
    const owned = sage.cores.filter(core => isOwned(core.id));
    const complete = owned.length === sage.cores.length;
    const fragments = sage.cores.map(core => `<span class="sage-fragment ${isOwned(core.id) ? 'unlocked' : ''}">?</span>`).join('');
    const intro = complete ? `<div class="sage-intro">${sage.intro.map(text => `<p>${h(text)}</p>`).join('')}</div>` : '';
    const cores = sage.cores.map(core => isOwned(core.id)
      ? `<div class="sage-core"><b>${h(core.title)}</b>${core.paragraphs.map(text => `<p>${h(text)}</p>`).join('')}</div>`
      : `<div class="sage-core locked"><b>${h(core.title)}</b></div>`).join('');
    return `<article class="sage-card"><div class="sage-portrait"><img src="./${h(sage.image)}" alt="${h(sage.name)}" loading="lazy"><div class="sage-fragments count-${sage.cores.length}">${fragments}</div></div><div class="sage-card-copy"><h2>${h(sage.name)}</h2><div class="sage-progress">思想碎片 ${owned.length}/${sage.cores.length}</div>${intro}${cores}</div></article>`;
  }

  addEventListener('DOMContentLoaded', () => {
    ensureView();
    progress();
  });
})();
