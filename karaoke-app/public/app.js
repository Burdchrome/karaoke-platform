// Karaoke client.
//
// Single script that powers both the audience page (index.html) and the
// DJ page (dj.html). We detect role from the DOM: if a queue panel exists,
// we're on the DJ page and wire up queue UI; otherwise we're on the audience
// page and skip all queue logic.
//
// Why DOM-detection instead of a global flag? Keeps the HTML files the source
// of truth — if you remove the queue section from a page, that page just
// stops having queue features. No JS edit required.

import CDGraphics from '/libs/cdgraphics/cdgraphics.js';
// SortableJS is DJ-only and a bit heavier (~13KB). We import it
// unconditionally because dynamic ESM imports complicate the bundling story
// later; the audience page just never instantiates it.
import Sortable from '/libs/sortablejs/sortable.esm.js';

// ---- shared elements (exist on both pages) ----
const $q       = document.getElementById('q');
const $status  = document.getElementById('status');
const $list    = document.getElementById('songs');
const $player  = document.getElementById('player');
const $close   = document.getElementById('close');
const $now     = document.getElementById('now-playing');
const $audio   = document.getElementById('audio');
const $canvas  = document.getElementById('canvas');

// ---- DJ-only elements (null on the audience page) ----
const $queueList     = document.getElementById('queue-list');
const $queueCount    = document.getElementById('queue-count');
const $clearQueueBtn = document.getElementById('clear-queue-btn');
const $skipBtn       = document.getElementById('skip');
const $upNext        = document.getElementById('up-next');
const $singer        = document.getElementById('singer');
const IS_DJ = $queueList !== null;

// Persist the singer name across reloads. DJ updates it as people walk up.
if ($singer) {
  $singer.value = localStorage.getItem('singerName') || '';
  $singer.addEventListener('input', () => {
    localStorage.setItem('singerName', $singer.value.trim());
  });
}

const ctx = $canvas.getContext('2d');
let debounceTimer = null;
let lastReqId = 0;
let cdg = null;
let frameId = null;

// ================== shared helpers ==================

// Build the human-readable label for a song. Used by search results, queue
// rows, the "Now Playing" overlay, and the "On Deck" indicator. One rule:
//   - If there's a real artist, show "Artist — Title".
//   - If a requester is provided (queued by name), append " • Requester".
// "(unknown)" is treated as no artist — it's the sentinel the queue uses
// when the parser couldn't extract one.
function formatSongLabel(song, { requestedBy } = {}) {
  const artist = song.artist && song.artist !== '(unknown)' ? song.artist : '';
  const main = artist ? `${artist} — ${song.title}` : song.title;
  return requestedBy ? `${main} • ${requestedBy}` : main;
}

// ================== search & list ==================

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Build the Play (+ Queue on DJ) action cluster for a given file id. The
// "+ Queue" button is only meaningful on the DJ page — audience never sees it
// because IS_DJ === false there.
// data-disc rides along so the audience request slip can show the disc code
// at preview end — that's what patrons write on the paper request.
function actionButtons(id, label, disc) {
  const queueBtn = IS_DJ
    ? `<button class="queue-btn" data-id="${id}" title="Add to queue">+ Queue</button>`
    : '';
  return `
    <div class="actions">
      ${queueBtn}
      <button class="play-btn" data-id="${id}" data-label="${escape(label)}" data-disc="${escape(disc || '')}">&#9654; Play</button>
    </div>`;
}

// Player label for one version of a group. Appends the versionLabel so the
// DJ can tell duet/radio/etc. apart once it's playing — unless the raw title
// still carries the "(…)" suffix itself (single-file groups keep it), which
// would print the label twice.
function versionLabelFor(group, versionLabel) {
  const base = formatSongLabel(group);
  if (!versionLabel || group.title.includes(`(${versionLabel})`)) return base;
  return `${base} (${versionLabel})`;
}

function renderResults(data, query) {
  if (data.matched === 0) {
    $list.innerHTML = `<li class="empty">No songs match "${escape(query)}".</li>`;
    $status.textContent = `0 matches.`;
    return;
  }
  const shown = data.results.length;
  $status.textContent = query
    ? `${data.matched.toLocaleString()} match${data.matched === 1 ? '' : 'es'} (showing ${shown}).`
    : `${data.total.toLocaleString()} songs total (showing ${shown}).`;

  $list.innerHTML = data.results.map(group => {
    const versions = group.versions || [];
    // Single-version groups render as a flat row like before — no toggle.
    // A lone file can still carry a versionLabel (e.g. a solitary
    // "(Radio Version)" rip), so surface it the same way version rows do.
    if (versions.length <= 1) {
      const only = versions[0] || group;
      const label = versionLabelFor(group, only.versionLabel);
      const meta = [group.discCode, only.versionLabel].filter(Boolean).map(escape).join(' &middot; ');
      return `
        <li data-id="${group.id}">
          <div class="info">
            <span class="artist">${escape(group.artist || '(unknown)')}</span>
            <span class="title"> &mdash; ${escape(group.title)}</span>
          </div>
          <span class="disc">${meta}</span>
          ${actionButtons(group.id, label, group.discCode)}
        </li>
      `;
    }

    // Multi-version group: a header row with a count toggle, plus a nested,
    // collapsed list of versions. Each version keeps its own file id so
    // play/queue act on the exact disc the user picked.
    const versionRows = versions.map(v => {
      const label = versionLabelFor(group, v.versionLabel);
      const meta = [v.discCode, v.versionLabel].filter(Boolean).map(escape).join(' &middot; ') || '&mdash;';
      return `
        <li class="version" data-id="${v.id}">
          <span class="disc">${meta}</span>
          ${actionButtons(v.id, label, v.discCode)}
        </li>
      `;
    }).join('');

    return `
      <li class="group" data-id="${group.id}">
        <div class="info">
          <span class="artist">${escape(group.artist || '(unknown)')}</span>
          <span class="title"> &mdash; ${escape(group.title)}</span>
        </div>
        <div class="actions">
          <button class="versions-toggle" aria-expanded="false" title="Show all versions">${versions.length} versions &#9662;</button>
        </div>
        <ul class="versions hidden">${versionRows}</ul>
      </li>
    `;
  }).join('');
}

async function search(query) {
  const reqId = ++lastReqId;
  try {
    const url = '/api/songs?limit=50' + (query ? '&search=' + encodeURIComponent(query) : '');
    const r = await fetch(url);
    const data = await r.json();
    if (reqId !== lastReqId) return; // stale response
    renderResults(data, query);
  } catch (err) {
    $status.textContent = 'Error: ' + err.message;
  }
}

$q.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => search($q.value.trim()), 150);
});

// ================== queue (DJ only) ==================

async function refreshQueue() {
  try {
    const r = await fetch('/api/queue');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    renderQueue(data.queue);
  } catch (err) {
    $queueList.innerHTML = `<li class="empty">Queue unavailable: ${escape(err.message)}</li>`;
  }
}

function renderQueue(entries) {
  $queueCount.textContent = entries.length;
  updateUpNext(entries);
  if (entries.length === 0) {
    $queueList.innerHTML = `<li class="empty">Queue is empty. Hit <strong>+ Queue</strong> on any song to add it.</li>`;
    return;
  }
  $queueList.innerHTML = entries.map((e, i) => {
    // The "≡" span is the drag handle. Only this element initiates a drag —
    // see the `handle:` option passed to Sortable. Buttons stay independently
    // clickable.
    const handle = `<span class="drag-handle" title="Drag to reorder">&#x2261;</span>`;
    if (!e.song) {
      return `<li class="qrow" data-entry-id="${e.id}">${handle}<span class="qpos">${i+1}.</span> <span class="qinfo">(unknown song ${escape(e.songId)})</span>
        <button class="remove-btn" data-entry="${e.id}">&times;</button></li>`;
    }
    const artist = e.song.artist || '(unknown)';
    const requester = e.requestedBy
      ? `<span class="qrequester">${escape(e.requestedBy)}</span>`
      : '';
    return `
      <li class="qrow" data-entry-id="${e.id}">
        ${handle}
        <span class="qpos">${i+1}.</span>
        <span class="qinfo">
          <span class="qartist">${escape(artist)}</span>
          <span class="qtitle"> &mdash; ${escape(e.song.title)}</span>
          ${requester}
        </span>
        <button class="play-btn small" data-id="${e.song.id}" data-label="${escape(formatSongLabel(e.song, { requestedBy: e.requestedBy }))}">&#9654;</button>
        <button class="remove-btn" data-entry="${e.id}" title="Remove from queue">&times;</button>
      </li>
    `;
  }).join('');
}

async function addToQueue(songId) {
  try {
    const requestedBy = $singer ? $singer.value.trim() : '';
    const r = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId, requestedBy }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    refreshQueue();
  } catch (err) {
    alert('Failed to add to queue: ' + err.message);
  }
}

async function removeFromQueue(entryId) {
  try {
    const r = await fetch(`/api/queue/${encodeURIComponent(entryId)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    refreshQueue();
  } catch (err) {
    alert('Failed to remove: ' + err.message);
  }
}

if (IS_DJ) {
  // Drag-to-reorder. Sortable watches the <ul> and survives our innerHTML
  // re-renders because it tracks children by reference, not by element identity.
  // The `handle:` option means only the ≡ span starts a drag — clicking
  // Play/Remove buttons stays independent.
  Sortable.create($queueList, {
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'qrow-ghost',
    chosenClass: 'qrow-chosen',
    onEnd: async (evt) => {
      // No actual move happened (just clicked, didn't drag).
      if (evt.oldIndex === evt.newIndex) return;
      const li = evt.item;
      const entryId = li?.dataset?.entryId;
      if (!entryId) return;
      try {
        await fetch('/api/queue/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entryId, newPosition: evt.newIndex }),
        });
        // No explicit refresh needed — SSE will broadcast the new order and
        // renderQueue will sort everything. The optimistic DOM change Sortable
        // already made will match the broadcast, so no visible flicker.
      } catch (err) {
        console.error('move failed', err);
        refreshQueue(); // pull authoritative state on error
      }
    },
  });

  $clearQueueBtn.addEventListener('click', async () => {
    if (!confirm('Clear the entire queue?')) return;
    await fetch('/api/queue', { method: 'DELETE' });
    refreshQueue();
  });

  // Queue clicks: Play (small) and remove.
  //
  // When the DJ clicks ▶ on a queue entry, we both play it AND remove it from
  // the queue. If we didn't remove it, djAdvance() would pop the same entry
  // again when the audio ends — infinite loop.
  $queueList.addEventListener('click', async (e) => {
    const playBtn   = e.target.closest('button.play-btn');
    const removeBtn = e.target.closest('button.remove-btn');
    if (playBtn) {
      const entryId = playBtn.closest('li.qrow')?.dataset?.entryId;
      if (entryId) {
        await fetch(`/api/queue/${encodeURIComponent(entryId)}`, { method: 'DELETE' });
        refreshQueue();
      }
      return openPlayer(playBtn.dataset.id, playBtn.dataset.label);
    }
    if (removeBtn) return removeFromQueue(removeBtn.dataset.entry);
  });
}

// ================== player ==================

// Tear audio playback down to a clean state. Stops the lyric render loop,
// pauses and unloads the audio element, clears the CDG buffer, and wipes
// the canvas. Called from both openPlayer (to clean up the previous song
// before loading a new one) and closePlayer (to fully shut down).
//
// Note: we use removeAttribute('src') instead of setting src=''. Setting
// src to an empty string still triggers a load attempt and a console error
// in some browsers. Removing the attribute is the only clean teardown.
function resetAudio() {
  stopRenderLoop();
  $audio.pause();
  $audio.removeAttribute('src');
  cdg = null;
  ctx.clearRect(0, 0, $canvas.width, $canvas.height);
}

async function openPlayer(id, label, disc) {
  resetAudio();
  resetPreviewHint();
  currentSong = { label, disc: disc || '' };

  $now.textContent = label;
  $player.classList.remove('hidden');
  document.body.classList.add('player-open');

  $audio.src = `/api/stream/${id}/mp3`;

  try {
    const r = await fetch(`/api/stream/${id}/cdg`);
    if (!r.ok) throw new Error(`CDG fetch failed: HTTP ${r.status}`);
    const buffer = await r.arrayBuffer();
    cdg = new CDGraphics(buffer);
    drawFrame(0);
  } catch (err) {
    console.error('CDG load error', err);
    $now.textContent = label + '  (lyrics failed to load)';
  }

  $audio.play().catch(err => console.warn('autoplay blocked:', err.message));
}

function closePlayer() {
  resetAudio();
  $player.classList.add('hidden');
  document.body.classList.remove('player-open');
}

function drawFrame(timeSec) {
  if (!cdg) return;
  const frame = cdg.render(timeSec);
  if (!frame.isChanged) return;
  ctx.putImageData(frame.imageData, 0, 0);
}

function renderLoop() {
  frameId = requestAnimationFrame(renderLoop);
  drawFrame($audio.currentTime);
}

function startRenderLoop() { if (frameId === null) renderLoop(); }
function stopRenderLoop()  { if (frameId !== null) { cancelAnimationFrame(frameId); frameId = null; } }

$audio.addEventListener('play',   startRenderLoop);
$audio.addEventListener('pause',  stopRenderLoop);
$audio.addEventListener('ended',  stopRenderLoop);
$audio.addEventListener('seeked', () => drawFrame($audio.currentTime));

// Audience-only: cap previews at 30 seconds. This is a catalog browse, not
// a jukebox — people can confirm "yes, that's the song" without us streaming
// full tracks to the internet. DJ side is untouched (full playback for gigs).
// Note: client-side cap. A determined user with DevTools could bypass it.
// Fine for the audience use case; revisit server-side if it ever matters.
//
// At the cap we PAUSE (don't close) and swap the hint text to explain why.
// Hard-closing the player at 30s felt jarring — the lyrics vanished mid-song
// with no warning. Pausing leaves the last frame on screen so the moment
// lands softer; the user closes with Esc or the close button when ready.
const PREVIEW_SECONDS = 30;
const $previewHint = document.getElementById('preview-hint');
const PREVIEW_HINT_DEFAULT = $previewHint ? $previewHint.innerHTML : '';

// The song currently in the player, kept for the request slip.
let currentSong = { label: '', disc: '' };

// Request slip (audience page only; null on DJ). Shown at preview end —
// this is the hand-off moment: the patron decides, and the slip shows
// exactly what to write on the paper request for the DJ.
const $slip      = document.getElementById('request-slip');
const $slipSong  = document.getElementById('slip-song');
const $slipDisc  = document.getElementById('slip-disc');

function resetPreviewHint() {
  if ($previewHint) $previewHint.innerHTML = PREVIEW_HINT_DEFAULT;
  if ($slip) $slip.classList.add('hidden');
  $player.classList.remove('preview-ended');
}

function showRequestSlip() {
  if (!$slip) return;
  $slipSong.textContent = currentSong.label;
  $slipDisc.textContent = currentSong.disc ? `Disc ${currentSong.disc}` : '';
  $slip.classList.remove('hidden');
  $player.classList.add('preview-ended');
  if ($previewHint) $previewHint.innerHTML = '';
}

if (!IS_DJ) {
  // No one-shot flag here: the cap must re-fire every time playback reaches
  // it, otherwise pressing play again after the pause resumes unbounded audio.
  const enforcePreviewCap = () => {
    if ($audio.currentTime >= PREVIEW_SECONDS) {
      $audio.pause();
      showRequestSlip();
    }
  };
  $audio.addEventListener('timeupdate', enforcePreviewCap);
  // Catches play pressed while already at/past the cap, before any timeupdate.
  $audio.addEventListener('play', enforcePreviewCap);
  // Scrubbing past the cap: clamp the seek back to the cap boundary.
  $audio.addEventListener('seeking', () => {
    if ($audio.currentTime > PREVIEW_SECONDS) {
      $audio.currentTime = PREVIEW_SECONDS;
      enforcePreviewCap();
    }
  });
}

// DJ-only: the Skip button manually advances to the next queued song.
// Auto-advance on 'ended' is intentionally NOT wired up — Shooter wants
// to talk between songs and click into each one himself (per Sunday
// 2026-05-29 convo). If we ever want auto-advance back, add:
//   $audio.addEventListener('ended', djAdvance);
// Audience playback just stops (no advance, no queue concept on their side).
if (IS_DJ) {
  $skipBtn.addEventListener('click', djAdvance);
}

// Pulls the head of the queue, plays it, removes it from the queue.
// Called from the Skip button (and previously the audio 'ended' event,
// before manual advance became the desired behavior).
async function djAdvance() {
  try {
    const r = await fetch('/api/queue');
    if (!r.ok) throw new Error(`queue HTTP ${r.status}`);
    const { queue } = await r.json();

    if (queue.length === 0) {
      closePlayer();
      return;
    }

    const head = queue[0];

    if (!head.song) {
      // Queue entry references a song id we no longer know about (cache stale,
      // file moved, etc.). Drop it and try again on the next entry.
      await fetch(`/api/queue/${encodeURIComponent(head.id)}`, { method: 'DELETE' });
      return djAdvance();
    }

    const label = formatSongLabel(head.song);

    // Remove the entry first, then start playback. Doing remove-first means
    // the queue list never shows the song that's currently playing — the
    // queue panel only ever shows "what's next."
    await fetch(`/api/queue/${encodeURIComponent(head.id)}`, { method: 'DELETE' });
    refreshQueue();
    openPlayer(head.song.id, label);
  } catch (err) {
    console.error('djAdvance error', err);
    // Don't lock the DJ out — close the player so they can manually pick.
    closePlayer();
  }
}

// Update the "Up next" hint in the player overlay so the DJ knows what's
// coming. Called whenever the queue refreshes.
function updateUpNext(entries) {
  if (!$upNext) return;
  if (entries.length === 0) {
    $upNext.textContent = 'Deck is empty — player will close when this ends.';
    $upNext.classList.remove('has-next');
    return;
  }
  const head = entries[0];
  if (!head.song) {
    $upNext.textContent = 'On Deck: (unknown song)';
    $upNext.classList.remove('has-next');
    return;
  }
  $upNext.textContent = `On Deck: ${formatSongLabel(head.song, { requestedBy: head.requestedBy })}`;
  $upNext.classList.add('has-next');
}

// Search list click delegation.
$list.addEventListener('click', (e) => {
  const toggle   = e.target.closest('button.versions-toggle');
  const playBtn  = e.target.closest('button.play-btn');
  const queueBtn = e.target.closest('button.queue-btn');
  if (toggle) {
    const versionList = toggle.closest('li.group')?.querySelector('ul.versions');
    if (versionList) {
      const isNowHidden = versionList.classList.toggle('hidden');
      toggle.setAttribute('aria-expanded', String(!isNowHidden));
    }
    return;
  }
  if (playBtn)  return openPlayer(playBtn.dataset.id, playBtn.dataset.label, playBtn.dataset.disc);
  if (queueBtn) return addToQueue(queueBtn.dataset.id);
});

$close.addEventListener('click', closePlayer);
const $slipDone = document.getElementById('slip-done');
if ($slipDone) $slipDone.addEventListener('click', closePlayer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$player.classList.contains('hidden')) closePlayer();
});

// ================== init ==================

search('');
if (IS_DJ) {
  // Initial snapshot via HTTP so the queue is visible even if SSE is slow to
  // connect or blocked by an aggressive proxy.
  refreshQueue();

  // Live updates via Server-Sent Events. EventSource auto-reconnects on
  // network blips, so we don't need to babysit the connection.
  const events = new EventSource('/api/events');
  events.addEventListener('queue', (e) => {
    try {
      const data = JSON.parse(e.data);
      renderQueue(data.queue);
    } catch (err) {
      console.warn('Bad SSE payload', err);
    }
  });
  events.addEventListener('error', () => {
    // EventSource will retry on its own. Just log so the DevTools console
    // shows whether reconnects are happening.
    console.warn('SSE connection error; EventSource will retry.');
  });
}
