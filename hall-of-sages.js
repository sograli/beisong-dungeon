(() => {
  const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const data = () => Array.isArray(window.SAGE_HALL_DATA) ? window.SAGE_HALL_DATA : [];
  function highlightKeyText(value, title = '') {
    const text = String(value ?? '');
    const terms = new Set();
    [...text.matchAll(/[“「『]([^”」』]{2,18})[”」』]/g)].forEach(match => terms.add(match[1]));
    String(title).replace(/[“”「」『』]/g, '').split(/[与和及、：:]/).map(term => term.trim()).filter(term => term.length >= 2).forEach(term => terms.add(term));
    text.split(/[。！？；]/).forEach(sentence => {
      const colon = sentence.search(/[：:]/);
      if (colon >= 2 && colon <= 16) terms.add(sentence.slice(0, colon).replace(/^.*?[，,]/, '').trim());
    });
    const ranges = [];
    [...terms].sort((a, b) => b.length - a.length).forEach(term => {
      let from = 0, index;
      while ((index = text.indexOf(term, from)) >= 0) {
        if (!ranges.some(range => index < range.end && index + term.length > range.start)) ranges.push({start:index, end:index + term.length});
        from = index + term.length;
      }
    });
    ranges.sort((a, b) => a.start - b.start);
    if (!ranges.length) return h(text);
    let output = '', cursor = 0;
    ranges.forEach(range => { output += h(text.slice(cursor, range.start)) + `<mark class="sage-key-highlight">${h(text.slice(range.start, range.end))}</mark>`; cursor = range.end });
    return output + h(text.slice(cursor));
  }
  let pending = null;
  let pageIndex = 0;
  let timer = 0;
  let visibleElapsed = 0;
  let lastTick = 0;
  const expandedCores = new Set();
  let stopSummonPrelude = null;

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
  function coreSymbolClass(title) {
    const value = String(title || '');
    if (/两种自由|分野/.test(value)) return 'split';
    if (/祛魅|上帝死了|批判/.test(value)) return 'broken-ring';
    if (/诸神|多元|视角/.test(value)) return 'constellation';
    if (/理性|科学|证伪|分析/.test(value)) return 'orbit';
    if (/铁笼|官僚|秩序|社会/.test(value)) return 'grid';
    if (/虚无|超人|行动|自由/.test(value)) return 'ascent';
    if (/无意识|欲望|精神|人格/.test(value)) return 'layers';
    if (/道德|恶|责任|价值/.test(value)) return 'balance';
    if (/消费|需求|单向度|异化/.test(value)) return 'loop';
    return 'prism';
  }
  function coreSymbol(core) {
    return `<div class="sage-core-symbol symbol-${coreSymbolClass(core?.title)}" aria-hidden="true"><i></i><i></i><i></i></div>`;
  }

  function ensureView() {
    if (document.querySelector('#sageHallView')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <section class="view sage-hall-view" id="sageHallView">
        <header class="sage-hall-head"><div class="sage-hall-title"><i>Ω</i><div><h1>英灵殿</h1><p>与十位哲人相遇，收集思想碎片</p></div></div><button class="sage-hall-back" id="leaveSageHall">回到庄园</button></header>
        <nav class="sage-hall-tabs"><button class="on" data-sage-tab="draw">抽取</button><button data-sage-tab="gallery">哲人图鉴</button></nav>
        <main class="sage-hall-body"><div id="sageDrawPane" class="sage-draw-pane"></div></main>
      </section>
      <section class="view sage-gallery-view" id="sageGalleryView">
        <header class="sage-hall-head"><div class="sage-hall-title"><i>◇</i><div><h1>哲人图鉴</h1><p>查看已唤醒的思想与英灵碎片</p></div></div><button class="sage-hall-back" id="leaveSageGallery">返回英灵殿</button></header>
        <main class="sage-gallery-body" id="sageGalleryPane"></main>
      </section>
      <section class="sage-study-modal" id="sageStudyModal" hidden><div class="sage-study-box" id="sageStudyBox"></div></section>`);
    const manor = document.querySelector('#manorView .manor-scene');
    if (manor && !manor.querySelector('.manor-hall')) manor.insertAdjacentHTML('beforeend','<button class="manor-building manor-hall" data-open-sage-hall="1"><i>Ω</i><b>英灵殿</b><small>哲思与英灵</small></button>');
    document.querySelector('#leaveSageHall').onclick = () => openManor();
    document.querySelector('#leaveSageGallery').onclick = () => openSageHall();
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
    if (tab === 'gallery') return openSageGallery();
    document.querySelectorAll('[data-sage-tab]').forEach(button => button.classList.toggle('on', button.dataset.sageTab === 'draw'));
    renderDraw();
  }

  function openSageGallery() {
    show('#sageGalleryView');
    document.querySelector('.game-nav').style.display = 'none';
    renderGallery();
  }

  function renderDraw() {
    const hall = hallState();
    const checked = hall.lastCheckIn === localDayKey();
    document.querySelector('#sageDrawPane').innerHTML = `<div class="sage-summon"><div class="sage-summon-animation" aria-hidden="true"><i></i><i></i><i></i><span></span></div><h2>召唤思想碎片</h2><div class="sage-checkin"><div><span>今日签到</span><b>抽卡次数 ${hall.drawTickets}</b></div><button class="sage-action" id="sageDailyCheckIn" ${checked ? 'disabled' : ''}>${checked ? '今日已签到' : '签到 +1'}</button></div><p>每次将随机遇见一条核心命题。完整浏览全部段落，碎片才会回应你。</p><button class="sage-action" id="drawSageCore" ${hall.drawTickets > 0 ? '' : 'disabled'}>呼唤英灵</button></div>`;
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
    document.querySelector('#sageStudyModal').hidden = false;
    playSummonAnimation();
  }

  function showDrawResult() {
    stopSummonPrelude?.();
    stopSummonPrelude = null;
    if (!pending) return;
    const box = document.querySelector('#sageStudyBox');
    box.innerHTML = `<button class="sage-study-close" id="cancelSageDraw">× 放弃</button><div class="sage-draw-result">${coreSymbol(pending.core)}<h2>${h(pending.core.title)}</h2><button class="sage-action" id="beginSageStudy">开始学习</button></div>`;
    document.querySelector('#cancelSageDraw').onclick = failDraw;
    document.querySelector('#beginSageStudy').onclick = () => renderStudyPage(0);
  }

  function playSummonAnimation() {
    stopSummonPrelude?.();
    const box = document.querySelector('#sageStudyBox');
    box.innerHTML = `<button class="sage-study-close" id="cancelSagePrelude">× 放弃</button><div class="sage-prelude"><video id="sageSummonVideo" muted playsinline webkit-playsinline preload="auto" aria-label="英灵召唤动画"><source src="./sage-summon-intro.mp4" type="video/mp4"></video><div class="sage-prelude-status">正在呼唤英灵...</div></div>`;
    const video = document.querySelector('#sageSummonVideo');
    let finished = false, retries = 0, watchdog = 0, resumeTimer = 0;
    const visibilityHandler = () => { if (!document.hidden && !finished && video.paused) video.play().catch(() => retry()) };
    const cleanup = () => {
      clearTimeout(watchdog); clearTimeout(resumeTimer);
      document.removeEventListener('visibilitychange', visibilityHandler);
      video.onended = video.onerror = video.onloadedmetadata = video.oncanplay = video.onpause = null;
      video.pause();
    };
    const finish = () => { if (finished) return; finished = true; cleanup(); showDrawResult() };
    const armWatchdog = delay => { clearTimeout(watchdog); watchdog = setTimeout(finish, delay) };
    const retry = () => {
      if (finished) return;
      if (retries >= 2) return finish();
      retries++;
      const status = box.querySelector('.sage-prelude-status');
      if (status) status.textContent = `动画加载重试 ${retries}/2`;
      video.src = `./sage-summon-intro.mp4?retry=${Date.now()}_${retries}`;
      video.load();
      video.play().catch(() => { resumeTimer = setTimeout(retry, 700) });
    };
    video.onloadedmetadata = () => armWatchdog(Math.min(180000, Math.max(20000, (Number(video.duration) || 20) * 1000 + 10000)));
    video.oncanplay = () => video.play().catch(() => retry());
    video.onerror = retry;
    video.onended = finish;
    video.onpause = () => {
      if (!finished && !document.hidden && !video.ended) resumeTimer = setTimeout(() => video.play().catch(() => retry()), 250);
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    document.querySelector('#cancelSagePrelude').onclick = failDraw;
    stopSummonPrelude = cleanup;
    armWatchdog(30000);
    video.play().catch(() => retry());
  }

  function renderStudyPage(index) {
    clearInterval(timer);
    pageIndex = index;
    visibleElapsed = 0;
    lastTick = performance.now();
    const paragraphs = pending.core.paragraphs;
    const last = index === paragraphs.length - 1;
    document.querySelector('#sageStudyBox').innerHTML = `<button class="sage-study-close" id="cancelSageStudy">× 放弃</button><div class="sage-study-page"><div class="sage-study-meta"><span>${h(pending.core.title)}</span><span>${index + 1}/${paragraphs.length}</span></div><h3>思想段落</h3><p>${highlightKeyText(paragraphs[index], pending.core.title)}</p><div class="sage-study-controls"><small id="sagePageWait">请浏览 5 秒</small><button class="sage-action" id="sagePageNext" disabled>${last ? '完成学习' : '下一段'}</button></div></div>`;
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
    stopSummonPrelude?.();
    stopSummonPrelude = null;
    pending = null;
    document.querySelector('#sageStudyBox').innerHTML = `<div class="sage-draw-result"><div class="sage-draw-icon">×</div><div class="sage-result-status fail">获取失败，本次抽卡无效</div><button class="sage-action" id="closeFailedDraw">返回英灵殿</button></div>`;
    document.querySelector('#closeFailedDraw').onclick = () => { document.querySelector('#sageStudyModal').hidden = true; renderDraw() };
  }

  function renderGallery() {
    document.querySelector('#sageGalleryPane').innerHTML = `<div class="sage-gallery">${data().map(renderSage).join('')}</div>`;
    document.querySelectorAll('[data-sage-core-toggle]').forEach(button => button.onclick = () => {
      const id = button.dataset.sageCoreToggle;
      const content = button.parentElement.querySelector('.sage-core-content');
      const opening = content.hidden;
      content.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
      button.querySelector('span').textContent = opening ? '收起' : '展开';
      if (opening) expandedCores.add(id); else expandedCores.delete(id);
    });
  }

  function renderSage(sage) {
    const owned = sage.cores.filter(core => isOwned(core.id));
    const complete = owned.length === sage.cores.length;
    const fragments = sage.cores.map(core => `<span class="sage-fragment ${isOwned(core.id) ? 'unlocked' : ''}">?</span>`).join('');
    const intro = complete ? `<div class="sage-intro">${sage.intro.map(text => `<p>${h(text)}</p>`).join('')}</div>` : '';
    const cores = sage.cores.map(core => isOwned(core.id)
      ? `<div class="sage-core"><button class="sage-core-toggle" data-sage-core-toggle="${h(core.id)}" aria-expanded="${expandedCores.has(core.id)}"><b>${h(core.title)}</b><span>${expandedCores.has(core.id) ? '收起' : '展开'}</span></button><div class="sage-core-content" ${expandedCores.has(core.id) ? '' : 'hidden'}>${core.paragraphs.map(text => `<p>${highlightKeyText(text, core.title)}</p>`).join('')}</div></div>`
      : `<div class="sage-core locked"><b>${h(core.title)}</b></div>`).join('');
    return `<article class="sage-card"><div class="sage-portrait"><img src="./${h(sage.image)}" alt="${h(sage.name)}" loading="lazy"><div class="sage-fragments count-${sage.cores.length}">${fragments}</div></div><div class="sage-card-copy"><h2>${h(sage.name)}</h2><div class="sage-progress">思想碎片 ${owned.length}/${sage.cores.length}</div>${intro}${cores}</div></article>`;
  }

  addEventListener('DOMContentLoaded', () => {
    ensureView();
    progress();
  });
})();
