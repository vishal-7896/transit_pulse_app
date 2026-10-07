/**
 * TRANSITPULSE - MOBILE-FIRST CROWDSOURCED BUS ETA FRONTEND
 * Built with Vanilla JavaScript (ES6+ async/await fetch API)
 */

(function () {
  'use strict';

  // ==========================================
  // 1. STATE MANAGEMENT (Session Memory Only)
  // ==========================================
  const state = {
    // API Configuration
    apiBaseUrl: 'http://127.0.0.1:5000',
    useSimulatorMode: false,
    
    // User Session (In-memory, session-based only per spec)
    userSession: {
      userId: null,
      username: null
    },

    // Selected Domain Data
    routes: [],
    stops: [],
    selectedRoute: null, // { id, name, code, description, color }
    selectedStop: null,  // { id, name, sequence }
    currentEta: null,    // { eta_minutes, status, last_sighting_mins_ago, last_stop_name }

    // Timers & Cooldowns
    autoRefreshTimer: null,
    refreshProgressTimer: null,
    refreshSecondsLeft: 30,
    sightingCooldownUntil: 0, // Timestamp when cooldown ends
    cooldownTimer: null
  };

  // ==========================================
  // 2. DOM ELEMENTS REGISTRY
  // ==========================================
  const DOM = {
    // Header & Mode Switcher
    apiModeBtn: document.getElementById('apiModeBtn'),
    apiModeLabel: document.getElementById('apiModeLabel'),
    connectionBanner: document.getElementById('connectionBanner'),
    connectionBannerText: document.getElementById('connectionBannerText'),
    switchSimulatorBtn: document.getElementById('switchSimulatorBtn'),
    userProfileBtn: document.getElementById('userProfileBtn'),
    userStatusLabel: document.getElementById('userStatusLabel'),

    // Sections
    routeSelectionSection: document.getElementById('routeSelectionSection'),
    stopsAndEtaSection: document.getElementById('stopsAndEtaSection'),

    // Route Selection
    routesLoading: document.getElementById('routesLoading'),
    routesError: document.getElementById('routesError'),
    routesErrorMessage: document.getElementById('routesErrorMessage'),
    retryRoutesBtn: document.getElementById('retryRoutesBtn'),
    refreshRoutesBtn: document.getElementById('refreshRoutesBtn'),
    routesContainer: document.getElementById('routesContainer'),

    // Stop Timeline & Banner
    selectedRouteBadge: document.getElementById('selectedRouteBadge'),
    selectedRouteTitle: document.getElementById('selectedRouteTitle'),
    selectedRouteSub: document.getElementById('selectedRouteSub'),
    changeRouteBtn: document.getElementById('changeRouteBtn'),
    stopsLoading: document.getElementById('stopsLoading'),
    stopsContainer: document.getElementById('stopsContainer'),
    stopsCountLabel: document.getElementById('stopsCountLabel'),

    // Live ETA Card
    etaDisplayCard: document.getElementById('etaDisplayCard'),
    activeStopName: document.getElementById('activeStopName'),
    activeStopId: document.getElementById('activeStopId'),
    etaLoading: document.getElementById('etaLoading'),
    etaContent: document.getElementById('etaContent'),
    etaMinutesValue: document.getElementById('etaMinutesValue'),
    etaUnitLabel: document.getElementById('etaUnitLabel'),
    etaStatusPill: document.getElementById('etaStatusPill'),
    lastSightingTime: document.getElementById('lastSightingTime'),
    lastSightingLocation: document.getElementById('lastSightingLocation'),
    etaTargetTime: document.getElementById('etaTargetTime'),
    refreshProgressRing: document.getElementById('refreshProgressRing'),

    // Sighting Actions
    reportSightingBtn: document.getElementById('reportSightingBtn'),
    sightingBtnText: document.getElementById('sightingBtnText'),
    cooldownHint: document.getElementById('cooldownHint'),
    cooldownTimer: document.getElementById('cooldownTimer'),

    // Registration Modal
    userModal: document.getElementById('userModal'),
    closeUserModalBtn: document.getElementById('closeUserModalBtn'),
    registerForm: document.getElementById('registerForm'),
    usernameInput: document.getElementById('usernameInput'),
    submitRegisterBtn: document.getElementById('submitRegisterBtn'),
    registerSuccessMsg: document.getElementById('registerSuccessMsg'),
    registeredName: document.getElementById('registeredName'),
    registerErrorMsg: document.getElementById('registerErrorMsg'),

    // Sighting Modal
    sightingConfirmModal: document.getElementById('sightingConfirmModal'),
    closeSightingModalBtn: document.getElementById('closeSightingModalBtn'),
    confirmRouteName: document.getElementById('confirmRouteName'),
    confirmStopName: document.getElementById('confirmStopName'),
    confirmSightingSubmitBtn: document.getElementById('confirmSightingSubmitBtn'),
    cancelSightingBtn: document.getElementById('cancelSightingBtn'),
    sightingErrorMsg: document.getElementById('sightingErrorMsg'),

    // Toasts
    toastContainer: document.getElementById('toastContainer')
  };

  // ==========================================
  // 3. MOCK BACKEND SIMULATOR DATA
  // (Fallback if backend API is offline or toggled)
  // ==========================================
  const SIMULATOR_DATA = {
    routes: [
      { id: 1, code: 'R-101', name: 'Downtown Crosstown Express', description: 'Central Station ↔ Metro University', color: '#00f2fe' },
      { id: 2, code: 'R-204', name: 'Westside Loop', description: 'Tech Park ↔ Bayfront Terminal', color: '#00f5a0' },
      { id: 3, code: 'R-309', name: 'Airport Flyer Express', description: 'Terminal 1 ↔ Financial Center', color: '#ff4757', express: true }
    ],
    stops: {
      1: [
        { id: 101, name: 'Central Station Plaza', sequence: 1 },
        { id: 102, name: '5th Avenue & Market St', sequence: 2 },
        { id: 103, name: 'City Hospital South', sequence: 3 },
        { id: 104, name: 'Arts District Gateway', sequence: 4 },
        { id: 105, name: 'Metro University North', sequence: 5 }
      ],
      2: [
        { id: 201, name: 'Tech Park Hub', sequence: 1 },
        { id: 202, name: 'Innovation Plaza', sequence: 2 },
        { id: 203, name: 'Harbor Heights', sequence: 3 },
        { id: 204, name: 'Bayfront Terminal', sequence: 4 }
      ],
      3: [
        { id: 301, name: 'Airport Terminal 1', sequence: 1 },
        { id: 302, name: 'Express Highway Junction', sequence: 2 },
        { id: 303, name: 'Financial Center Station', sequence: 3 }
      ]
    },
    // Dynamic ETA calculations per stop
    sightings: {
      101: { eta_minutes: 3, status: 'on_time', last_sighting_mins_ago: 2, last_stop_name: 'Depot' },
      102: { eta_minutes: 7, status: 'on_time', last_sighting_mins_ago: 1, last_stop_name: 'Central Station Plaza' },
      103: { eta_minutes: 12, status: 'delayed', last_sighting_mins_ago: 5, last_stop_name: 'Central Station Plaza' },
      104: { eta_minutes: 18, status: 'on_time', last_sighting_mins_ago: 4, last_stop_name: '5th Avenue' },
      105: { eta_minutes: 25, status: 'no_recent_data', last_sighting_mins_ago: 19, last_stop_name: 'Depot' }
    }
  };

  // ==========================================
  // 4. API CLIENT METHOD WRAPPERS (fetch & simulator)
  // ==========================================

  /**
   * Universal fetch helper with timeout and simulator fallback
   */
  async function apiFetch(endpoint, options = {}) {
    if (state.useSimulatorMode) {
      return handleSimulatorRequest(endpoint, options);
    }

    const url = `${state.apiBaseUrl}${endpoint}`;
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

      const response = await fetch(url, {
        ...options,
        headers: { ...defaultHeaders, ...(options.headers || {}) },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Handle HTTP status codes
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(errorData.error || errorData.message || `API Error: ${response.status}`);
        error.status = response.status;
        error.data = errorData;
        throw error;
      }

      return await response.json();
    } catch (err) {
      console.warn(`[TransitPulse API Fetch Error] ${endpoint}:`, err.message);
      
      // Auto-fallback to simulator if real API server fails on initial load
      if (!state.useSimulatorMode && (err.name === 'AbortError' || err.message.includes('Failed to fetch'))) {
        showConnectionBanner('Backend server unreachable at 127.0.0.1:5000. Switched to Interactive Demo Simulator mode.');
        state.useSimulatorMode = true;
        updateApiModeBadge();
        return handleSimulatorRequest(endpoint, options);
      }
      throw err;
    }
  }

  /**
   * Mock Simulator Backend Handler
   */
  async function handleSimulatorRequest(endpoint, options) {
    // Artificial 250ms network delay for realistic visual loading feedback
    await new Promise(res => setTimeout(res, 250));

    const method = (options.method || 'GET').toUpperCase();

    // GET /routes
    if (endpoint === '/routes' && method === 'GET') {
      return SIMULATOR_DATA.routes;
    }

    // GET /stops or /stops?route_id=X
    if (endpoint.startsWith('/stops') && method === 'GET') {
      const urlParams = new URLSearchParams(endpoint.split('?')[1] || '');
      const routeId = urlParams.get('route_id') || state.selectedRoute?.id || 1;
      return SIMULATOR_DATA.stops[routeId] || SIMULATOR_DATA.stops[1];
    }

    // GET /eta/<stop_id>
    if (endpoint.startsWith('/eta/') && method === 'GET') {
      const stopId = parseInt(endpoint.replace('/eta/', ''), 10);
      const mockEta = SIMULATOR_DATA.sightings[stopId] || {
        eta_minutes: Math.floor(Math.random() * 15) + 2,
        status: 'on_time',
        last_sighting_mins_ago: Math.floor(Math.random() * 5) + 1,
        last_stop_name: 'Previous Terminal'
      };
      return mockEta;
    }

    // POST /sighting
    if (endpoint === '/sighting' && method === 'POST') {
      const body = JSON.parse(options.body || '{}');

      // Check client-side simulator cooldown
      const now = Date.now();
      if (state.sightingCooldownUntil > now) {
        const remainingSecs = Math.ceil((state.sightingCooldownUntil - now) / 1000);
        const err = new Error(`Rate limited. Please wait ${remainingSecs}s before submitting another sighting.`);
        err.status = 429;
        throw err;
      }

      // Update mock ETA for the stop (simulating live crowdsourced update!)
      if (body.stop_id) {
        SIMULATOR_DATA.sightings[body.stop_id] = {
          eta_minutes: 1, // Bus seen right here!
          status: 'on_time',
          last_sighting_mins_ago: 0,
          last_stop_name: state.selectedStop?.name || 'Current Stop'
        };
      }

      return {
        success: true,
        message: 'Sighting report recorded! ETAs recalculated.',
        timestamp: new Date().toISOString()
      };
    }

    // POST /register
    if (endpoint === '/register' && method === 'POST') {
      const body = JSON.parse(options.body || '{}');
      const userId = 'usr_' + Math.random().toString(36).substring(2, 9);
      return {
        user_id: userId,
        username: body.username || 'Rider',
        message: 'User session registered successfully'
      };
    }

    throw new Error('Endpoint not found');
  }

  // ==========================================
  // 5. CORE CONTROLLERS & DATA FLOW
  // ==========================================

  /**
   * Load Routes List (GET /routes)
   */
  async function loadRoutes() {
    DOM.routesLoading.classList.remove('hidden');
    DOM.routesError.classList.add('hidden');
    DOM.routesContainer.innerHTML = '';

    try {
      const data = await apiFetch('/routes');
      state.routes = Array.isArray(data) ? data : (data.routes || []);

      if (state.routes.length === 0) {
        showError(DOM.routesErrorMessage, 'No active routes found in backend database.');
        DOM.routesError.classList.remove('hidden');
        return;
      }

      renderRoutesList(state.routes);
    } catch (err) {
      showError(DOM.routesErrorMessage, err.message || 'Failed to fetch bus routes.');
      DOM.routesError.classList.remove('hidden');
    } finally {
      DOM.routesLoading.classList.add('hidden');
    }
  }

  /**
   * Load Stops for a Route (GET /stops?route_id=X)
   */
  async function loadStops(route) {
    state.selectedRoute = route;
    
    // UI update
    DOM.selectedRouteBadge.textContent = route.code || `R-${route.id}`;
    DOM.selectedRouteTitle.textContent = route.name;
    DOM.selectedRouteSub.textContent = route.description || 'Select a stop to view ETA';

    DOM.routeSelectionSection.classList.add('hidden');
    DOM.stopsAndEtaSection.classList.remove('hidden');
    DOM.stopsLoading.classList.remove('hidden');
    DOM.stopsContainer.innerHTML = '';
    DOM.etaDisplayCard.classList.add('hidden');

    try {
      const endpoint = `/stops?route_id=${route.id}`;
      const data = await apiFetch(endpoint);
      state.stops = Array.isArray(data) ? data : (data.stops || []);

      DOM.stopsCountLabel.textContent = `${state.stops.length} stops`;
      renderStopsTimeline(state.stops);

      // Auto-select first stop
      if (state.stops.length > 0) {
        selectStop(state.stops[0]);
      }
    } catch (err) {
      showToast(`Failed to load stops for ${route.name}`, 'error');
    } finally {
      DOM.stopsLoading.classList.add('hidden');
    }
  }

  /**
   * Select a Stop and Fetch Live ETA (GET /eta/<stop_id>)
   */
  async function selectStop(stop) {
    state.selectedStop = stop;

    // Highlight timeline selection
    document.querySelectorAll('.stop-pill-card').forEach(card => {
      card.classList.toggle('selected', parseInt(card.dataset.stopId, 10) === stop.id);
    });

    DOM.activeStopName.textContent = stop.name;
    DOM.activeStopId.textContent = `STOP #${stop.id}`;
    DOM.etaDisplayCard.classList.remove('hidden');

    // Trigger ETA load
    await loadLiveEta(stop.id);

    // Reset 30s auto-refresh timer loop
    startAutoRefreshLoop();
  }

  /**
   * Fetch Live ETA (GET /eta/<stop_id>)
   */
  async function loadLiveEta(stopId) {
    DOM.etaLoading.classList.remove('hidden');
    DOM.etaContent.classList.add('hidden');

    try {
      const data = await apiFetch(`/eta/${stopId}`);
      state.currentEta = data;

      renderEtaData(data);
    } catch (err) {
      console.error('ETA Fetch Error:', err);
      DOM.etaMinutesValue.textContent = '--';
      DOM.etaUnitLabel.textContent = '';
      renderStatusPill('no_data', 'SERVICE UNKNOWN');
      DOM.lastSightingTime.textContent = 'Error';
      DOM.lastSightingLocation.textContent = 'Failed to load';
    } finally {
      DOM.etaLoading.classList.add('hidden');
      DOM.etaContent.classList.remove('hidden');
    }
  }

  /**
   * Submit Bus Sighting (POST /sighting)
   */
  async function submitSighting() {
    if (!state.selectedRoute || !state.selectedStop) {
      showToast('Please select a route and stop first', 'error');
      return;
    }

    DOM.confirmSightingSubmitBtn.disabled = true;
    DOM.confirmSightingSubmitBtn.textContent = 'Submitting report...';
    DOM.sightingErrorMsg.classList.add('hidden');

    const payload = {
      route_id: state.selectedRoute.id,
      stop_id: state.selectedStop.id,
      user_id: state.userSession.userId || 'guest_session'
    };

    try {
      const res = await apiFetch('/sighting', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      hideModal(DOM.sightingConfirmModal);
      showToast('🚌 Sighting reported! Recalculating ETAs...', 'success');

      // Trigger 3-minute rate limit cooldown
      triggerCooldown(180);

      // Immediately refresh ETA
      await loadLiveEta(state.selectedStop.id);
    } catch (err) {
      if (err.status === 429) {
        DOM.sightingErrorMsg.textContent = err.message || 'Rate limit active: 3-minute cooldown between sightings.';
        DOM.sightingErrorMsg.classList.remove('hidden');
        triggerCooldown(180);
      } else {
        DOM.sightingErrorMsg.textContent = err.message || 'Failed to report sighting.';
        DOM.sightingErrorMsg.classList.remove('hidden');
      }
    } finally {
      DOM.confirmSightingSubmitBtn.disabled = false;
      DOM.confirmSightingSubmitBtn.textContent = 'Submit Live Bus Sighting (POST /sighting)';
    }
  }

  /**
   * User Registration (POST /register)
   */
  async function registerUser(username) {
    DOM.submitRegisterBtn.disabled = true;
    DOM.submitRegisterBtn.textContent = 'Registering session...';
    DOM.registerErrorMsg.classList.add('hidden');
    DOM.registerSuccessMsg.classList.add('hidden');

    try {
      const res = await apiFetch('/register', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim() })
      });

      // Save in JS state memory
      state.userSession.userId = res.user_id;
      state.userSession.username = res.username;

      DOM.registeredName.textContent = res.username;
      DOM.registerSuccessMsg.classList.remove('hidden');
      updateUserSessionUI();

      showToast(`Welcome @${res.username}! Session registered.`, 'success');
      setTimeout(() => hideModal(DOM.userModal), 1200);
    } catch (err) {
      DOM.registerErrorMsg.textContent = err.message || 'Registration failed.';
      DOM.registerErrorMsg.classList.remove('hidden');
    } finally {
      DOM.submitRegisterBtn.disabled = false;
      DOM.submitRegisterBtn.textContent = 'Create Session & Register (POST /register)';
    }
  }

  // ==========================================
  // 6. UI RENDERERS & TIMERS
  // ==========================================

  function renderRoutesList(routes) {
    DOM.routesContainer.innerHTML = routes.map(r => `
      <div class="route-card" data-route-id="${r.id}">
        <div class="route-card-header">
          <span class="route-badge ${r.express ? 'express' : ''}">${r.code || 'R-' + r.id}</span>
          <span class="route-desc">🚌 Active Route</span>
        </div>
        <div class="route-title">${escapeHtml(r.name)}</div>
        <div class="route-desc">${escapeHtml(r.description || 'City Bus Line')}</div>
      </div>
    `).join('');

    // Attach click listeners
    DOM.routesContainer.querySelectorAll('.route-card').forEach(card => {
      card.addEventListener('click', () => {
        const routeId = parseInt(card.dataset.routeId, 10);
        const route = state.routes.find(r => r.id === routeId);
        if (route) loadStops(route);
      });
    });
  }

  function renderStopsTimeline(stops) {
    DOM.stopsContainer.innerHTML = stops.map(s => `
      <div class="stop-pill-card" data-stop-id="${s.id}">
        <span class="stop-num-tag">STOP #${s.sequence || s.id}</span>
        <div class="stop-name">${escapeHtml(s.name)}</div>
      </div>
    `).join('');

    DOM.stopsContainer.querySelectorAll('.stop-pill-card').forEach(card => {
      card.addEventListener('click', () => {
        const stopId = parseInt(card.dataset.stopId, 10);
        const stop = state.stops.find(s => s.id === stopId);
        if (stop) selectStop(stop);
      });
    });
  }

  function renderEtaData(data) {
    const mins = data.eta_minutes;

    if (mins === undefined || mins === null || mins < 0) {
      DOM.etaMinutesValue.textContent = '--';
      DOM.etaUnitLabel.textContent = 'MINS';
      renderStatusPill('no_data', 'NO RECENT DATA');
    } else if (mins === 0) {
      DOM.etaMinutesValue.textContent = 'NOW';
      DOM.etaUnitLabel.textContent = '';
      renderStatusPill('on_time', 'ARRIVING NOW');
    } else {
      DOM.etaMinutesValue.textContent = mins;
      DOM.etaUnitLabel.textContent = mins === 1 ? 'MIN' : 'MINS';

      // Status pill mapping
      const status = (data.status || 'on_time').toLowerCase();
      if (status.includes('delay')) {
        renderStatusPill('delayed', 'DELAYED');
      } else if (status.includes('no_recent') || status.includes('stale')) {
        renderStatusPill('no_data', 'NO RECENT SIGHTINGS');
      } else {
        renderStatusPill('on_time', 'ON TIME');
      }
    }

    // Metadata rendering
    DOM.lastSightingTime.textContent = data.last_sighting_mins_ago !== undefined
      ? `${data.last_sighting_mins_ago} mins ago`
      : 'Recently';

    DOM.lastSightingLocation.textContent = data.last_stop_name || 'Upstream Stop';

    // Target Time Calculation
    const target = new Date(Date.now() + (mins || 0) * 60000);
    DOM.etaTargetTime.textContent = target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function renderStatusPill(type, text) {
    DOM.etaStatusPill.className = 'status-pill';
    if (type === 'on_time') DOM.etaStatusPill.classList.add('status-on-time');
    else if (type === 'delayed') DOM.etaStatusPill.classList.add('status-delayed');
    else DOM.etaStatusPill.classList.add('status-no-data');

    DOM.etaStatusPill.textContent = text;
  }

  /**
   * 3-Minute Rate Limit Cooldown Countdown Timer
   */
  function triggerCooldown(seconds = 180) {
    state.sightingCooldownUntil = Date.now() + seconds * 1000;
    
    if (state.cooldownTimer) clearInterval(state.cooldownTimer);

    DOM.reportSightingBtn.disabled = true;
    DOM.reportSightingBtn.classList.add('cooldown-active');
    DOM.cooldownHint.classList.remove('hidden');

    function updateTimer() {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((state.sightingCooldownUntil - now) / 1000));

      if (remaining <= 0) {
        clearInterval(state.cooldownTimer);
        DOM.reportSightingBtn.disabled = false;
        DOM.reportSightingBtn.classList.remove('cooldown-active');
        DOM.sightingBtnText.textContent = 'I SEE THE BUS AT THIS STOP!';
        DOM.cooldownHint.classList.add('hidden');
      } else {
        const m = String(Math.floor(remaining / 60)).padStart(2, '0');
        const s = String(remaining % 60).padStart(2, '0');
        DOM.sightingBtnText.textContent = `⏱️ COOLDOWN (${m}:${s})`;
        DOM.cooldownTimer.textContent = `${m}:${s}`;
      }
    }

    updateTimer();
    state.cooldownTimer = setInterval(updateTimer, 1000);
  }

  /**
   * Auto-refresh ETA every 30 seconds with SVG Progress Ring
   */
  function startAutoRefreshLoop() {
    if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
    if (state.refreshProgressTimer) clearInterval(state.refreshProgressTimer);

    state.refreshSecondsLeft = 30;
    const fullDash = 56.5; // 2 * PI * r (r=9)

    function tick() {
      state.refreshSecondsLeft -= 1;
      
      // Update SVG ring
      const progressFraction = state.refreshSecondsLeft / 30;
      const offset = fullDash * (1 - progressFraction);
      DOM.refreshProgressRing.style.strokeDasharray = `${fullDash}`;
      DOM.refreshProgressRing.style.strokeDashoffset = `${offset}`;

      if (state.refreshSecondsLeft <= 0) {
        state.refreshSecondsLeft = 30;
        if (state.selectedStop) {
          loadLiveEta(state.selectedStop.id);
        }
      }
    }

    tick();
    state.refreshProgressTimer = setInterval(tick, 1000);
  }

  function updateUserSessionUI() {
    if (state.userSession.username) {
      DOM.userStatusLabel.textContent = `@${state.userSession.username}`;
      DOM.userProfileBtn.classList.add('active');
    } else {
      DOM.userStatusLabel.textContent = 'Guest';
      DOM.userProfileBtn.classList.remove('active');
    }
  }

  function updateApiModeBadge() {
    if (state.useSimulatorMode) {
      DOM.apiModeLabel.textContent = 'Demo Mode';
      DOM.apiModeBtn.querySelector('.status-dot').className = 'status-dot offline';
    } else {
      DOM.apiModeLabel.textContent = 'Live API';
      DOM.apiModeBtn.querySelector('.status-dot').className = 'status-dot online';
    }
  }

  function showConnectionBanner(msg) {
    DOM.connectionBannerText.textContent = msg;
    DOM.connectionBanner.classList.remove('hidden');
  }

  // ==========================================
  // 7. MODALS & TOAST UTILITIES
  // ==========================================

  function showModal(modal) { modal.classList.remove('hidden'); }
  function hideModal(modal) { modal.classList.add('hidden'); }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    
    DOM.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function showError(el, msg) {
    el.textContent = msg;
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ==========================================
  // 8. EVENT LISTENERS SETUP
  // ==========================================
  function setupEventListeners() {
    // Refresh Routes Button
    DOM.refreshRoutesBtn.addEventListener('click', loadRoutes);
    DOM.retryRoutesBtn.addEventListener('click', loadRoutes);

    // Change Route Button
    DOM.changeRouteBtn.addEventListener('click', () => {
      DOM.stopsAndEtaSection.classList.add('hidden');
      DOM.routeSelectionSection.classList.remove('hidden');
      if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
    });

    // Report Sighting Button -> open confirm modal
    DOM.reportSightingBtn.addEventListener('click', () => {
      if (state.sightingCooldownUntil > Date.now()) return;

      DOM.confirmRouteName.textContent = state.selectedRoute?.name || 'Bus Route';
      DOM.confirmStopName.textContent = state.selectedStop?.name || 'Current Stop';
      DOM.sightingErrorMsg.classList.add('hidden');
      showModal(DOM.sightingConfirmModal);
    });

    DOM.closeSightingModalBtn.addEventListener('click', () => hideModal(DOM.sightingConfirmModal));
    DOM.cancelSightingBtn.addEventListener('click', () => hideModal(DOM.sightingConfirmModal));
    DOM.confirmSightingSubmitBtn.addEventListener('click', submitSighting);

    // Profile & Registration Modal
    DOM.userProfileBtn.addEventListener('click', () => showModal(DOM.userModal));
    DOM.closeUserModalBtn.addEventListener('click', () => hideModal(DOM.userModal));

    DOM.registerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = DOM.usernameInput.value;
      if (name) registerUser(name);
    });

    // API Mode Toggle
    DOM.apiModeBtn.addEventListener('click', () => {
      state.useSimulatorMode = !state.useSimulatorMode;
      updateApiModeBadge();
      const modeStr = state.useSimulatorMode ? 'Demo Simulator Mode' : 'Live API (http://127.0.0.1:5000)';
      showToast(`Switched backend target to: ${modeStr}`, 'info');
      if (!state.useSimulatorMode) DOM.connectionBanner.classList.add('hidden');
      loadRoutes();
    });

    DOM.switchSimulatorBtn.addEventListener('click', () => {
      state.useSimulatorMode = true;
      updateApiModeBadge();
      DOM.connectionBanner.classList.add('hidden');
      showToast('Switched to Demo Simulator Mode', 'info');
      loadRoutes();
    });
  }

  // ==========================================
  // 9. INITIALIZATION
  // ==========================================
  function init() {
    setupEventListeners();
    updateApiModeBadge();
    updateUserSessionUI();
    loadRoutes();
  }

  // Run on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
