/* Rally — Travel Profile Prototype
   Pure frontend. No fetches, no persistence beyond sessionStorage.
   This file is the spec for the eventual real flow. */

(() => {
  'use strict';

  // ─── Step order ────────────────────────────────────────────
  const STEPS = [
    'intro',
    'vibe-1', 'vibe-2', 'vibe-3', 'vibe-4', 'vibe-5',
    'airport',
    'dietary',
    'budget',
    'done',
  ];
  // Steps that count toward the pager (skip intro + done).
  const PAGER_STEPS = STEPS.slice(1, -1);

  // ─── State ─────────────────────────────────────────────────
  const state = {
    step: 'intro',
    answers: {
      vibe_beach_or_mountain:    null,
      vibe_spa_or_hike:          null,
      vibe_foodie_or_casual:     null,
      vibe_social_or_chill:      null,
      vibe_culture_or_relaxation:null,
      home_airport:              null,
      dietary_restrictions:      [],
      budget_comfort:            null,
    },
    startedAt: null,
    finishedAt: null,
  };

  // ─── DOM refs ──────────────────────────────────────────────
  const $stage          = document.getElementById('stage');
  const $cards          = Array.from(document.querySelectorAll('.card'));
  const $timerValue     = document.getElementById('timer-value');
  const $pager          = document.getElementById('pager');
  const $airportInput   = document.getElementById('airport-input');
  const $airportSugList = document.getElementById('airport-suggestions');
  const $continueDiet   = document.getElementById('continue-diet');
  const $finalTime      = document.getElementById('final-time');
  const $summary        = document.getElementById('summary');

  // ─── Pager dots ────────────────────────────────────────────
  PAGER_STEPS.forEach(() => {
    const dot = document.createElement('span');
    dot.className = 'dot';
    $pager.appendChild(dot);
  });
  function paintPager() {
    const dots = Array.from($pager.children);
    const idx = PAGER_STEPS.indexOf(state.step);
    dots.forEach((d, i) => {
      d.dataset.done   = i < idx ? 'true' : 'false';
      d.dataset.active = i === idx ? 'true' : 'false';
    });
    $pager.setAttribute('aria-hidden', idx < 0 ? 'true' : 'false');
  }

  // ─── Card transitions ──────────────────────────────────────
  function showStep(next) {
    if (!STEPS.includes(next)) return;
    const prev = state.step;
    state.step = next;

    $cards.forEach((c) => {
      const key = c.dataset.step;
      if (key === prev && prev !== next) {
        c.dataset.leaving = 'true';
        delete c.dataset.active;
        setTimeout(() => { delete c.dataset.leaving; }, 360);
      }
      if (key === next) {
        c.dataset.active = '';
        delete c.dataset.leaving;
      }
    });
    paintPager();
  }

  function nextStep() {
    const i = STEPS.indexOf(state.step);
    if (i >= 0 && i < STEPS.length - 1) showStep(STEPS[i + 1]);
  }

  // ─── Timer ─────────────────────────────────────────────────
  function startTimer() {
    if (state.startedAt) return;
    state.startedAt = Date.now();
    requestAnimationFrame(tick);
  }
  function tick() {
    if (state.finishedAt) {
      paintTimer(state.finishedAt - state.startedAt);
      return;
    }
    paintTimer(Date.now() - state.startedAt);
    requestAnimationFrame(tick);
  }
  function paintTimer(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    $timerValue.textContent = `${m}:${String(r).padStart(2, '0')}`;
  }

  // ─── Vibe + tier + chip handlers (event delegation) ────────
  $stage.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action], .option, .tier, .chip, .airport-suggestion');
    if (!t) return;

    // Action buttons
    const action = t.dataset.action;
    if (action === 'start')          { startTimer(); nextStep(); return; }
    if (action === 'skip-airport')   { state.answers.home_airport = null; nextStep(); return; }
    if (action === 'skip-diet')      { state.answers.dietary_restrictions = []; nextStep(); return; }
    if (action === 'continue-diet')  { nextStep(); return; }
    if (action === 'rsvp')           { /* prototype: bounce back to top */ alert('Prototype only — this would now post the RSVP.'); return; }
    if (action === 'restart')        { resetProto(); return; }

    // Single-pick options (vibe + budget tier)
    if (t.classList.contains('option') || t.classList.contains('tier')) {
      const card = t.closest('.card');
      const key  = card?.dataset.key;
      if (!key) return;
      card.querySelectorAll('[data-picked="true"]').forEach((el) => {
        delete el.dataset.picked;
      });
      t.dataset.picked = 'true';
      state.answers[key] = t.dataset.value;
      setTimeout(() => {
        if (state.step === 'budget') finishFlow();
        else nextStep();
      }, 200);
      return;
    }

    // Multi-pick chips (dietary)
    if (t.classList.contains('chip')) {
      const val = t.dataset.value;
      const picked = t.dataset.picked === 'true';
      if (picked) {
        delete t.dataset.picked;
        state.answers.dietary_restrictions =
          state.answers.dietary_restrictions.filter((v) => v !== val);
      } else {
        t.dataset.picked = 'true';
        state.answers.dietary_restrictions.push(val);
      }
      // Update the continue button to feel more present once any are picked
      $continueDiet.textContent =
        state.answers.dietary_restrictions.length > 0
          ? `Continue (${state.answers.dietary_restrictions.length}) →`
          : 'Continue →';
      return;
    }

    // Airport suggestion pick
    if (t.classList.contains('airport-suggestion')) {
      const code = t.dataset.code;
      const a = window.RALLY_AIRPORTS.find((x) => x.code === code);
      if (!a) return;
      state.answers.home_airport = a.code;
      $airportInput.value = `${a.code} — ${a.city}`;
      closeAirportSuggestions();
      setTimeout(nextStep, 180);
      return;
    }
  });

  // ─── Airport typeahead ─────────────────────────────────────
  let airportFocusedIndex = -1;

  function renderAirportSuggestions(query) {
    const q = query.trim().toUpperCase();
    if (q.length === 0) {
      $airportSugList.innerHTML = '';
      $airportSugList.removeAttribute('data-open');
      airportFocusedIndex = -1;
      return;
    }

    const matches = window.RALLY_AIRPORTS.filter((a) => {
      return (
        a.code.startsWith(q) ||
        a.city.toUpperCase().includes(q) ||
        a.name.toUpperCase().includes(q)
      );
    }).slice(0, 6);

    if (matches.length === 0) {
      $airportSugList.innerHTML =
        '<li class="airport-suggestion" data-disabled="true">' +
          '<span class="airport-suggestion-name">No match — tap "Skip for now" if your airport isn\'t listed.</span>' +
        '</li>';
      $airportSugList.dataset.open = 'true';
      return;
    }

    $airportSugList.innerHTML = matches.map((a, i) => `
      <li>
        <button type="button" class="airport-suggestion" data-code="${a.code}"
                ${i === 0 ? 'data-focused="true"' : ''}>
          <span class="airport-suggestion-code">${a.code}</span>
          <span class="airport-suggestion-name">${a.name}</span>
          <span class="airport-suggestion-city">${a.city}</span>
        </button>
      </li>
    `).join('');
    airportFocusedIndex = 0;
    $airportSugList.dataset.open = 'true';
  }

  function closeAirportSuggestions() {
    $airportSugList.innerHTML = '';
    $airportSugList.removeAttribute('data-open');
    airportFocusedIndex = -1;
  }

  $airportInput.addEventListener('input', (e) => {
    renderAirportSuggestions(e.target.value);
  });
  $airportInput.addEventListener('keydown', (e) => {
    const items = Array.from($airportSugList.querySelectorAll('.airport-suggestion:not([data-disabled])'));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      airportFocusedIndex = Math.min(items.length - 1, airportFocusedIndex + 1);
      items.forEach((el, i) => {
        if (i === airportFocusedIndex) el.dataset.focused = 'true';
        else delete el.dataset.focused;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      airportFocusedIndex = Math.max(0, airportFocusedIndex - 1);
      items.forEach((el, i) => {
        if (i === airportFocusedIndex) el.dataset.focused = 'true';
        else delete el.dataset.focused;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = items[airportFocusedIndex];
      if (sel) sel.click();
    } else if (e.key === 'Escape') {
      closeAirportSuggestions();
    }
  });

  // ─── Finish flow ───────────────────────────────────────────
  function finishFlow() {
    state.finishedAt = Date.now();
    const elapsed = state.finishedAt - state.startedAt;
    paintTimer(elapsed);
    const s = (elapsed / 1000).toFixed(1);
    $finalTime.textContent = `${s}s`;
    renderSummary();
    showStep('done');
  }

  function renderSummary() {
    const LABELS = {
      vibe_beach_or_mountain:    'Vibe',
      vibe_spa_or_hike:          'Off-day',
      vibe_foodie_or_casual:     'Dinner',
      vibe_social_or_chill:      'Nights',
      vibe_culture_or_relaxation:'Energy',
      home_airport:              'Home airport',
      dietary_restrictions:      'Dietary',
      budget_comfort:            'Budget',
    };
    const PRETTY = {
      beach: 'Beach', mountain: 'Mountain', both: 'Either',
      spa: 'Spa', hike: 'Hike',
      foodie: 'Foodie', casual: 'Casual',
      social: 'Out', chill: 'In',
      culture: 'Sees it all', relaxation: 'Does nothing',
      budget: 'Budget',  mid: 'Mid', premium: 'Premium', luxury: 'No ceiling',
    };
    const rows = Object.keys(LABELS).map((k) => {
      const v = state.answers[k];
      let pretty;
      if (k === 'dietary_restrictions') {
        pretty = v.length ? v.map((x) => x.replace(/_/g, ' ')).join(', ') : null;
      } else if (k === 'home_airport') {
        pretty = v || null;
      } else {
        pretty = v ? (PRETTY[v] || v) : null;
      }
      const valueHtml = pretty
        ? pretty.charAt(0).toUpperCase() + pretty.slice(1)
        : '<span class="empty">—</span>';
      return `
        <div class="summary-row">
          <dt>${LABELS[k]}</dt>
          <dd>${valueHtml}</dd>
        </div>
      `;
    }).join('');
    $summary.innerHTML = rows;
  }

  // ─── Reset ─────────────────────────────────────────────────
  function resetProto() {
    state.answers = {
      vibe_beach_or_mountain:    null,
      vibe_spa_or_hike:          null,
      vibe_foodie_or_casual:     null,
      vibe_social_or_chill:      null,
      vibe_culture_or_relaxation:null,
      home_airport:              null,
      dietary_restrictions:      [],
      budget_comfort:            null,
    };
    state.startedAt = null;
    state.finishedAt = null;
    $airportInput.value = '';
    closeAirportSuggestions();
    document.querySelectorAll('[data-picked="true"]').forEach((el) => delete el.dataset.picked);
    document.querySelectorAll('.card[data-active]').forEach((el) => delete el.dataset.active);
    document.querySelectorAll('.card[data-leaving]').forEach((el) => delete el.dataset.leaving);
    $continueDiet.textContent = 'Continue →';
    $timerValue.textContent = '0:00';
    // showStep needs prev !== next to do its transition work, but
    // we've already wiped all card state — so just bypass the
    // transition path and snap the intro card on.
    state.step = 'intro';
    document.querySelector('.card[data-step="intro"]').dataset.active = '';
    paintPager();
  }

  // ─── Initial paint ─────────────────────────────────────────
  paintPager();
})();
