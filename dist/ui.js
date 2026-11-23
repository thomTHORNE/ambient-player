/**
 * UI module: formatting, icons, channel row markup and dialogs.
 * Every string that came from outside (video titles, channel names, mix names)
 * passes through esc() before it reaches innerHTML.
 */
/** Escape text for safe use inside HTML markup and attributes. */
export function esc(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
export function pad2(n) {
    return Math.floor(n).toString().padStart(2, '0');
}
/** Seconds to HH:MM:SS. */
export function formatHMS(seconds) {
    return clockParts(seconds).join(':');
}
/** Short form for lists: M:SS under an hour, H:MM:SS above. */
export function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0)
        return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
/** Seconds to the three clock fields: hours, minutes, seconds. */
export function clockParts(seconds) {
    if (!isFinite(seconds) || seconds < 0)
        seconds = 0;
    return [
        pad2(seconds / 3600),
        pad2((seconds % 3600) / 60),
        pad2(seconds % 60),
    ];
}
/** Volume 0..1 to a decibel readout. */
export function formatDb(volume) {
    if (volume <= 0.001)
        return '−∞ dB';
    const db = 20 * Math.log10(volume);
    return `${db <= -0.05 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`;
}
export function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
/** Replace text with a short fade-up, used when the focused channel changes. */
export function swapText(el, text, delay = 0) {
    if (el.textContent === text)
        return;
    el.textContent = text;
    if (prefersReducedMotion())
        return;
    el.animate([
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' },
    ], { duration: 320, delay, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'backwards' });
}
/** Line icons on a 24px grid, 1.6px stroke, round joins. */
const line = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const icons = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.9-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor"/></svg>',
    prev: line('<path d="M18 6v12l-9-6z"/><path d="M6 6v12"/>'),
    next: line('<path d="M6 6v12l9-6z"/><path d="M18 6v12"/>'),
    stop: line('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
    repeat: line('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
    plus: line('<path d="M12 5v14M5 12h14"/>'),
    trash: line('<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 12.5h9l1-12.5"/>'),
    clock: line('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    timer: line('<path d="M10 2.5h4"/><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5 15 10.5"/>'),
    layers: line('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
    live: line('<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/>'),
    activity: line('<path d="M21 12h-4l-3 8-4-16-3 8H3"/>'),
    link: line('<path d="M10 13.5a4.5 4.5 0 0 0 6.8.5l2.7-2.7a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5"/><path d="M14 10.5a4.5 4.5 0 0 0-6.8-.5l-2.7 2.7a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/>'),
    volume: line('<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
    source: line('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="m10 9.5 4.5 2.5-4.5 2.5z"/>'),
    bookmark: line('<path d="M18 20.5 12 16l-6 4.5V5.5A2 2 0 0 1 8 3.5h8a2 2 0 0 1 2 2z"/>'),
    hourglass: line('<path d="M6.5 3h11M6.5 21h11"/><path d="M7.5 3c0 5 9 5 9 9s-9 4-9 9M16.5 3c0 5-9 5-9 9s9 4 9 9"/>'),
};
export function stateInfo(track) {
    switch (track.state) {
        case 'playing': return { label: 'Playing', tone: 'live' };
        case 'paused': return { label: 'On hold', tone: 'idle' };
        case 'loading': return { label: 'Loading', tone: 'busy' };
        case 'error': return { label: 'Unavailable', tone: 'warn' };
    }
}
export function trackTitle(track) {
    if (track.state === 'error')
        return track.error?.message || 'This video cannot play here';
    if (track.state === 'loading' && !track.meta)
        return 'Loading channel';
    return track.meta?.title || 'Untitled video';
}
/**
 * Markup for one channel row. The row's own volume slider stays hidden behind
 * a toggle (volumeOpen) so scrolling the list cannot nudge it by accident.
 */
export function channelRowHtml(track, index, focused, volumeOpen = false) {
    const title = esc(trackTitle(track));
    const author = esc(track.meta?.author || 'YouTube');
    const thumb = track.meta?.thumbnailUrl
        ? `<img class="ch__thumb" src="${esc(track.meta.thumbnailUrl)}" alt="" loading="lazy" />`
        : '<span class="ch__thumb ch__thumb--empty" aria-hidden="true"></span>';
    const playing = track.state === 'playing';
    const usable = track.state === 'playing' || track.state === 'paused';
    const { label, tone } = stateInfo(track);
    const vol = Math.round(track.volume * 100);
    return `
    <li class="ch is-${track.state}${focused ? ' is-focus' : ''}" data-track-id="${esc(track.id)}">
      <div class="ch__main">
        <button class="ch__focus" type="button" data-action="focus" aria-current="${focused ? 'true' : 'false'}" aria-label="Show ${title} in the player">
          ${thumb}
          <span class="ch__text">
            <span class="ch__title">${title}</span>
            <span class="ch__meta">
              <span class="ch__state tone-${tone}">${label}</span>
              <span class="ch__time">${pad2(index + 1)} · ${author}</span>
            </span>
          </span>
        </button>
        <button class="vol-toggle${volumeOpen ? ' is-open' : ''}" type="button" data-action="vol-toggle" aria-expanded="${volumeOpen}" aria-controls="vol-${esc(track.id)}" aria-label="Volume for ${title}: ${vol} percent"${usable ? '' : ' disabled'}>
          ${icons.volume}<span class="vol-toggle__num">${vol}</span>
        </button>
        <button class="round-btn ch__toggle${playing ? ' is-on' : ''}" type="button" data-action="toggle" aria-label="${playing ? 'Pause' : 'Play'} ${title}"${usable ? '' : ' disabled'}>${playing ? icons.pause : icons.play}</button>
      </div>
      <label class="ch__vol" id="vol-${esc(track.id)}"${volumeOpen && usable ? '' : ' hidden'}>
        <span class="visually-hidden">Volume for ${title}</span>
        <span class="ch__vol-icon" aria-hidden="true">${icons.volume}</span>
        <input class="slider" type="range" min="0" max="100" step="1" value="${vol}" style="--v:${vol}%" data-action="volume"${usable ? '' : ' disabled'} />
        <span class="ch__volnum" aria-hidden="true">${vol}</span>
      </label>
    </li>`;
}
/** Update the live parts of a row in place, so focus and slider drags survive. */
export function patchChannelRow(li, track) {
    const playing = track.state === 'playing';
    li.classList.toggle('is-playing', playing);
    li.classList.toggle('is-paused', track.state === 'paused');
    const state = li.querySelector('.ch__state');
    if (state) {
        const { label, tone } = stateInfo(track);
        state.textContent = label;
        state.className = `ch__state tone-${tone}`;
    }
    const toggle = li.querySelector('.ch__toggle');
    if (toggle && toggle.classList.contains('is-on') !== playing) {
        toggle.classList.toggle('is-on', playing);
        toggle.innerHTML = playing ? icons.pause : icons.play;
        toggle.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${trackTitle(track)}`);
    }
    const vol = li.querySelector('input[data-action="volume"]');
    const volNum = li.querySelector('.ch__volnum');
    const v = Math.round(track.volume * 100);
    if (vol) {
        if (document.activeElement !== vol)
            vol.value = String(v);
        vol.style.setProperty('--v', `${v}%`);
    }
    if (volNum)
        volNum.textContent = String(v);
    const volToggle = li.querySelector('.vol-toggle');
    const volToggleNum = volToggle?.querySelector('.vol-toggle__num');
    if (volToggle && volToggleNum) {
        volToggleNum.textContent = String(v);
        volToggle.setAttribute('aria-label', `Volume for ${trackTitle(track)}: ${v} percent`);
    }
}
/** Show or hide a row's own volume slider. */
export function setRowVolumeOpen(li, open) {
    const toggle = li.querySelector('.vol-toggle');
    const panel = li.querySelector('.ch__vol');
    if (!toggle || !panel)
        return;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('is-open', open);
    panel.hidden = !open;
}
/** Render the saved mixes list. */
export function renderSavedPlaylists(playlists, container) {
    if (playlists.length === 0) {
        container.innerHTML = '<li class="mix mix--empty">Saved mixes appear here.</li>';
        return;
    }
    container.innerHTML = playlists
        .map((p) => {
        const name = esc(p.name);
        return `
        <li class="mix">
          <span class="mix__text">
            <span class="mix__name">${name}</span>
            <span class="mix__count">${p.urls.length} channel${p.urls.length === 1 ? '' : 's'}</span>
          </span>
          <button class="btn btn--quiet btn--small" type="button" data-mix-action="load" data-playlist-name="${name}" aria-label="Load mix ${name}">Load</button>
          <button class="icon-btn" type="button" data-mix-action="delete" data-playlist-name="${name}" aria-label="Delete mix ${name}">${icons.trash}</button>
        </li>`;
    })
        .join('');
}
/** Ask whether a loaded mix replaces or joins the current channels. */
export function showReplaceAppendModal(message) {
    return new Promise((resolve) => {
        const opener = document.activeElement;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
      <div class="modal panel" role="dialog" aria-modal="true" aria-labelledby="modalTitle" aria-describedby="modalBody">
        <h2 id="modalTitle" class="modal__title">Load this mix?</h2>
        <p id="modalBody" class="modal__body">${esc(message)}</p>
        <div class="modal__actions">
          <button class="btn btn--quiet" type="button" data-choice="cancel">Cancel</button>
          <button class="btn" type="button" data-choice="append">Add to current</button>
          <button class="btn btn--primary" type="button" data-choice="replace">Replace current</button>
        </div>
      </div>`;
        document.body.appendChild(overlay);
        const finish = (choice) => {
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            opener?.focus();
            resolve(choice);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                finish('cancel');
            }
            else if (e.key === 'Tab') {
                const buttons = Array.from(overlay.querySelectorAll('button'));
                const first = buttons[0];
                const last = buttons[buttons.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
                else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', onKey, true);
        overlay.addEventListener('click', (e) => {
            const target = e.target;
            if (target === overlay)
                return finish('cancel');
            const choice = target.closest('[data-choice]')?.dataset.choice;
            if (choice === 'replace' || choice === 'append' || choice === 'cancel')
                finish(choice);
        });
        overlay.querySelector('[data-choice="replace"]')?.focus();
    });
}
let errorTimer = null;
/** Show a message in the status line for five seconds. */
export function showError(element, message) {
    element.textContent = message;
    if (errorTimer !== null)
        clearTimeout(errorTimer);
    errorTimer = window.setTimeout(() => {
        element.textContent = '';
        errorTimer = null;
    }, 5000);
}
export async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    }
    catch {
        return false;
    }
}
