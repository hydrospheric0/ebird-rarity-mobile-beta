import './styles.css'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { API_BASE_URL, fetchWorkerHealth } from './config/api.js'
import { getYoloSpeciesInfo, getSpeciesMapLabel, getAbaCodeOverride } from './data/species-reference.js'
import LOCAL_SPECIES_NAMES from './data/species-local-names.json'
import NL_SPECIES_REFERENCE_DATA from './data/nl-species-reference.json'
import NL_CDNA_REVIEW_SCIENTIFIC from './data/nl-cdna-review-scientific.json'
import AVIBASE_NL_CHECKLIST_DATA from './data/avibase-nl-checklist.json'
import {
  distanceKm, pointInRing, pointInPolygon, featureContainsPoint,
  normalizeRingCoordinates, buildInverseMaskFeaturesFromActiveFeatures, getFeatureVisualCenter,
} from './modules/geo.js'
import {
  US_REGION_CODE, LOWER_48_STATES, ALL_REGIONS, STATE_CENTERS, LEAF_SUBNATIONAL1_COUNTRIES,
  isCountyRegionCode, isStateRegionCode, stateRegionFromCountyRegion, stateRegionFromAnyRegion,
  getStateNameByRegion, getStateAbbrevByRegion, normalizeCountyName, shortCountyName, escapeHtml,
} from './modules/region-utils.js'
import {
  cutoffDateForDaysBack, getAbaCodeNumber, matchesAbaSelection,
  filterObservationsToCountyRegion, filterObservationsToStateRegion,
  summarizeCountyObservations, formatCountySummary, formatCountySummaryPills,
  parseObsDate, formatShortDate, formatObservationDate,
  parseFirstAvailableObsDate, getObservationGroupKey, getItemStateAbbrev, getItemCountyName,
  getLocationKeyForItem, buildLocationIndexForPopup, isConfirmedObservation, dayOffsetFromToday,
} from './modules/observations.js'
import {
  buildNotablesCacheKey, saveNotablesCache, loadNotablesCache, getCacheDaysBack,
  countyContextCacheKey, saveCountyContextCache, loadCountyContextCache,
} from './modules/cache.js'

const BUILD_TAG = typeof __BUILD_TAG__ !== 'undefined' ? __BUILD_TAG__ : 'dev'
const BUILD_VERSION = typeof window !== 'undefined' && window.__TWITCHER_BUILD_VER__
  ? String(window.__TWITCHER_BUILD_VER__)
  : String(BUILD_TAG)

const YOLO_COUNTY_REGION = 'US-CA-113'
const DEFAULT_NO_LOCATION_REGION = 'US-CA'

const EBIRD_API_KEY_STORAGE_KEY = 'mrm_ebird_api_key'

const app = document.querySelector('#app')

app.innerHTML = `
  <div id="appShell" class="app-shell">
    <div id="locPermGate" class="api-key-gate" hidden>
      <div class="api-key-card" role="dialog" aria-modal="true" aria-labelledby="locPermTitle">
        <h2 id="locPermTitle">Location needed</h2>
        <p class="loc-perm-intro">This app works best when you allow it to see your location, so it can load nearby county rarities automatically.</p>
        <p class="loc-perm-step-title">To enable on iOS Safari:</p>
        <ol class="api-key-notes">
          <li><strong>Settings &rsaquo; Privacy &amp; Security &rsaquo; Location Services</strong> &mdash; set to <strong>On</strong></li>
          <li>Scroll down to <strong>Safari</strong> (or your Home Screen app icon) &rarr; select <strong>While Using the App</strong></li>
          <li>Enable <strong>Precise Location</strong></li>
        </ol>
        <div class="api-key-actions">
          <button id="locPermRetryBtn" class="primary" type="button">Retry location</button>
          <button id="locPermDeclineBtn" class="menu-btn loc-perm-decline-btn" type="button">Decline &mdash; show California</button>
        </div>
      </div>
    </div>
    <div id="apiKeyGate" class="api-key-gate" hidden>
      <div class="api-key-card" role="dialog" aria-modal="true" aria-labelledby="apiKeyTitle">
        <button id="apiKeyCloseBtn" class="api-key-close-btn" type="button" aria-label="Close" title="Close">×</button>
        <h2 id="apiKeyTitle">eBird API key required</h2>
        <label class="api-key-field" for="apiKeyInput">
          <span>API key:</span>
          <div class="api-key-input-row">
            <input id="apiKeyInput" class="api-key-input" type="password" inputmode="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Paste eBird API key">
            <button id="apiKeyToggleBtn" class="menu-btn api-key-visibility-btn" type="button" aria-label="Show API key" aria-pressed="false" title="Show API key">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>
        </label>
        <div class="api-key-actions">
          <button id="apiKeySaveBtn" class="primary" type="button">Save key</button>
          <button id="apiKeyOpenBtn" class="menu-btn" type="button">eBird API keygen</button>
        </div>
        <ul class="api-key-notes" aria-label="API key notes">
          <li>If you’re already signed in on eBird in this browser, that page should show your key. Paste it here to continue.</li>
          <li>This key is only stored locally on your device and cannot be seen or read by others.</li>
          <li>It persists between sessions &mdash; you only need to enter it once per device.</li>
        </ul>
        <p id="apiKeyError" class="api-key-error" aria-live="polite"></p>
      </div>
    </div>
    <header class="app-header">
      <h1 class="app-title"><span class="brandName">Twitcher</span><span class="brandTagline"> - find eBird Rarities</span><span class="build-badge-inline" title="Build ${BUILD_VERSION}">v${BUILD_VERSION}</span></h1>
      <button id="menuPin" class="header-toggle" type="button" aria-label="Zoom to my location" title="Zoom to my location">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><polygon points="12,3 19,20 12,16 5,20"/></svg>
      </button>
      <button id="menuSearch" class="header-toggle" type="button" aria-label="Search region" title="Search / filter region">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/></svg>
      </button>
      <button id="speciesLangToggle" class="header-toggle header-toggle-lang" type="button" aria-label="Toggle species language" title="Species labels: English">EN</button>
      <button id="menuInfo" class="header-toggle" type="button" aria-label="About this page" title="About this page">i</button>

      <section id="statusPopover" class="status-popover status-hidden" aria-hidden="true">
        <div class="row">
          <span>API Connectivity</span>
          <span id="apiStatus" class="badge warn">Checking...</span>
        </div>
        <p id="apiDetail" class="detail"></p>
        <p id="buildInfo" class="detail">Build: pending</p>

        <div class="row">
          <span>Perf</span>
          <span id="perfBadge" class="badge badge--perf">—</span>
        </div>
        <p id="perfDetail" class="detail detail--perf"></p>

        <div class="row">
          <span>Poly Block</span>
          <span id="polygonBlockBadge" class="badge warn">Off</span>
        </div>

        <div class="row">
          <span>My Location</span>
          <span id="locationStatus" class="badge warn">Waiting...</span>
        </div>
        <p id="locationDetail" class="detail">iOS tip: choose "Allow While Using App" and keep "Precise Location" enabled for fine-grained positioning.</p>
        <button id="retryLocation" class="primary" type="button">Use My Location</button>

        <div class="filter-group">
          <label for="filterDaysBack" class="filter-label">Days Back: <span id="filterDaysBackValue">14</span></label>
          <input id="filterDaysBack" class="filter-slider" type="range" min="1" max="14" value="14" step="1">
        </div>
        <div class="filter-group">
          <div class="filter-group-header">Filter</div>
          <label for="filterAbaMin" class="filter-label">ABA Code ≥ <span id="filterAbaMinValue">1</span></label>
          <input id="filterAbaMin" class="filter-slider" type="range" min="1" max="5" value="1" step="1">
        </div>
      </section>
    </header>

    <section class="map-strip">
      <div id="map" class="map"></div>
      <div class="map-top-right">
        <button id="mapFullscreenToggle" class="map-ctrl-btn" type="button" aria-pressed="false" aria-label="Toggle fullscreen map" title="Fullscreen">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
        </button>
        <button id="mapBasemapToggle" class="map-ctrl-btn" type="button" aria-label="Toggle basemap" title="Toggle satellite/street">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
        </button>
        <button id="mapLocateBtn" class="map-ctrl-btn" type="button" aria-label="Zoom to my location" title="My location">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><polygon points="12,3 19,20 12,16 5,20"/></svg>
        </button>
        <button id="mapMeasureBtn" class="map-ctrl-btn" type="button" aria-pressed="false" aria-label="Measure distance" title="Measure distance">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l12-6 6 12-12 6z"/><path d="M8 6l2 4"/><path d="M12 4l2 4"/><path d="M7 12l2 4"/><path d="M11 10l2 4"/></svg>
        </button>
        <button id="mapNearbyRadiusBtn" class="map-ctrl-btn map-radius-btn" type="button" aria-label="Nearby observations radius" title="Nearby radius">
          1km
        </button>
        <button id="mapLabelToggle" class="map-ctrl-btn" type="button" aria-pressed="true" aria-label="Toggle point labels" title="Toggle labels">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><text x="12" y="17" text-anchor="middle" font-size="9" font-weight="700" font-family="sans-serif" fill="currentColor" stroke="none">B</text></svg>
        </button>
      </div>
      <div id="mapLoading" class="map-loading" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <span id="mapLoadingText">Loading map…</span>
      </div>
    </section>

    <div id="mapTableSplitter" class="map-table-splitter" role="separator" aria-label="Resize map and list" aria-orientation="horizontal"></div>

    <main class="app-main">
      <section id="panelMap" class="panel active">
        <section class="card table-card">
          <div id="countyPicker" class="county-picker" hidden>
            <div class="county-picker-title">Counties</div>
            <div id="countyPickerList" class="county-picker-list" role="listbox" aria-label="County list"></div>
            <div id="pickerAbaPills" class="top-aba-pills picker-aba-pills" aria-label="ABA counts"></div>
          </div>
          <div id="speciesPicker" class="county-picker" hidden>
            <div class="county-picker-title">Species</div>
            <div id="speciesPickerList" class="county-picker-list" role="listbox" aria-label="Species list"></div>
          </div>
          <div id="statePicker" class="county-picker" hidden>
            <div class="county-picker-title">States</div>
            <div id="statePickerList" class="county-picker-list" role="listbox" aria-label="State list"></div>
            <div id="statePickerAbaPills" class="top-aba-pills picker-aba-pills" aria-label="ABA counts"></div>
          </div>
          <div id="abaCodePicker" class="county-picker" hidden>
            <div class="county-picker-title">ABA Codes</div>
            <div id="abaCodePickerList" class="county-picker-list" role="listbox" aria-label="ABA code list"></div>
          </div>
          <span id="notableCount" hidden>—</span>
          <p id="notableMeta" hidden></p>
          <div class="table-wrap">
            <table class="notable-table">
              <thead>
                <tr>
                  <th class="col-code sortable" id="thCode" data-sort="code">Code<span class="sort-icon" aria-hidden="true"></span></th>
                  <th class="col-species sortable" id="thSpecies" data-sort="species">Species<span class="sort-icon" aria-hidden="true"></span></th>
                  <th class="col-state sortable" id="thState" data-sort="state">State<span class="sort-icon" aria-hidden="true"></span></th>
                  <th class="col-county sortable" id="thCounty" data-sort="county">County<span class="sort-icon" aria-hidden="true"></span></th>
                  <th class="col-date sortable" id="thLast" data-sort="last"><span class="th-two-line">Last<br>Seen</span><span class="sort-icon" aria-hidden="true"></span></th>
                  <th class="col-reports" id="thReports">
                    <button id="reportsHelpBtn" class="col-reports-btn" type="button" aria-label="About report counts" aria-expanded="false">#</button>
                    <div id="reportsHelpPopover" class="reports-help-popover" hidden>
                      <p class="reports-help-title">Number of reports</p>
                      <div class="reports-help-row"><span class="count-pill count-pill-confirmed">3</span><span>Confirmed</span></div>
                      <div class="reports-help-row"><span class="count-pill count-pill-pending">2</span><span>Unconfirmed</span></div>
                    </div>
                  </th>
                  <th class="col-vis"><input type="checkbox" id="toggleAllVis" title="Show / hide all" checked></th>
                  <th class="col-pin"></th>
                </tr>
              </thead>
              <tbody id="notableRows"></tbody>
            </table>
          </div>
          <p id="tableRenderStatus" class="detail" hidden>render: init</p>
        </section>
      </section>

      <section id="panelTable" class="panel"></section>
    </main>

    <!-- ABA filter bar — shows interactive ABA code filter pills -->
    <div class="bottom-aba-filter-bar" aria-label="ABA code filter" aria-hidden="false">
      <div id="topAbaPills" class="top-aba-pills" aria-label="ABA counts"></div>
    </div>

    <!-- Location bar — country + province/state + county selectors + days back + reload -->
    <div class="bottom-location-bar" aria-label="Location">
      <button id="headerCountryBtn" class="loc-btn bottom-select" type="button" aria-label="Country" title="Country">NL</button>
      <button id="headerStateBtn" class="loc-btn-state top-menu-select top-menu-btn bottom-select" type="button" aria-label="State" title="Choose state" hidden>-</button>
      <select id="headerStateSelect" class="top-menu-select" aria-label="Province/State" hidden aria-hidden="true" tabindex="-1">
        <option value="NL">Netherlands</option>
      </select>

      <button id="headerCountyBtn" class="top-menu-select top-menu-btn bottom-select" type="button" aria-label="County" title="Choose county">Loading…</button>
      <select id="headerCountySelect" class="top-menu-select" aria-label="County" hidden aria-hidden="true" tabindex="-1">
        <option value="">Loading…</option>
      </select>

      <button id="headerSpeciesBtn" class="top-menu-select top-menu-btn bottom-select" type="button" aria-label="Species" title="Choose species" hidden>Species</button>

      <select id="headerDaysBackSelect" class="top-menu-select bottom-select" aria-label="Days back">
        <option value="1">1d</option>
        <option value="3">3d</option>
        <option value="7" selected>7d</option>
        <option value="14">14d</option>
      </select>

      <button id="bottomReloadBtn" class="menu-btn bottom-reload-btn" type="button" aria-label="Reload" title="Reload">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1 2.13-9" />
        </svg>
      </button>
    </div>

    <!-- Mode tab bar — 4 view modes at the very bottom -->
    <nav id="modeTabBar" class="bottom-mode-tab-bar" aria-label="View mode">
      <button class="mode-tab mode-tab--active" data-mode="hybrid" type="button" aria-pressed="true">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="9" rx="1"/><rect x="3" y="14" width="18" height="7" rx="1"/></svg>
        <span>Hybrid</span>
      </button>
      <button class="mode-tab" data-mode="list" type="button" aria-pressed="false">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1" fill="currentColor" stroke="none"/></svg>
        <span>List</span>
      </button>
      <button class="mode-tab" data-mode="map" type="button" aria-pressed="false">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
        <span>Map</span>
      </button>
      <button class="mode-tab" data-mode="species" type="button" aria-pressed="false">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/></svg>
        <span>Species</span>
      </button>
    </nav>

    <div id="infoModal" class="app-modal" hidden>
      <div class="app-modal-backdrop" data-close="info"></div>
      <section class="app-modal-panel" role="dialog" aria-modal="true" aria-labelledby="infoTitle">
        <h2 id="infoTitle">About this page</h2>
        <p>This mobile view shows nearby eBird county rarities with map + table syncing.</p>
        <p>Use the top menu to switch county and days back, and use search to switch region/county quickly.</p>
        <p>© Bart Wickel, 2026</p>
        <section class="info-tech" aria-label="Technical metrics">
          <h3>Technical metrics</h3>
          <pre id="infoTechMetrics">Loading…</pre>
        </section>
        <section class="info-tech" aria-label="Tap debug">
          <h3>Tap debug (temporary)</h3>
          <label class="debug-toggle-row" for="tapDebugToggle">
            <input id="tapDebugToggle" type="checkbox">
            <span>Enable map tap resolution logs</span>
          </label>
          <pre id="tapDebugLog" class="tap-debug-log">Debug disabled</pre>
        </section>
        <button id="infoCloseBtn" class="primary" type="button">Close</button>
      </section>
    </div>

    <div id="speciesDetailPanel" class="species-detail-panel" hidden aria-modal="true" role="dialog" aria-labelledby="speciesDetailTitle">
      <div class="species-detail-header">
        <button id="speciesDetailBackBtn" class="species-detail-back" type="button" aria-label="Back">&#x2190; Back</button>
        <span id="speciesDetailTitle" class="species-detail-title"></span>
        <span id="speciesDetailStatus" class="species-detail-status" hidden></span>
      </div>
      <div id="speciesDetailBody" class="species-detail-body obs-popup"></div>
    </div>

    <div id="searchPopover" class="menu-popover" hidden>
      <div class="menu-popover-card menu-popover-card--search" role="dialog" aria-modal="true" aria-labelledby="searchMenuTitle">
        <div id="searchMenuTitle" class="menu-popover-title">Search</div>
        <label class="menu-popover-field" for="searchRegionSelect">
          <span>Region:</span>
          <select id="searchRegionSelect" class="top-menu-select" aria-label="Search state"></select>
        </label>
        <label class="menu-popover-field" for="searchCountySelect">
          <span id="searchCountyLabel">County:</span>
          <select id="searchCountySelect" class="top-menu-select" aria-label="Search county"></select>
        </label>
        <label class="menu-popover-field" for="searchSpeciesSelect">
          <span>Species:</span>
          <select id="searchSpeciesSelect" class="top-menu-select" aria-label="Search species"></select>
        </label>
        <label class="menu-popover-field" for="searchAbaMinInput">
          <span>ABA Code ≥ <span id="searchAbaMinValue">1</span></span>
          <input id="searchAbaMinInput" class="filter-slider" type="range" min="1" max="5" value="1" step="1" aria-label="Search ABA minimum">
        </label>
        <label class="menu-popover-field" for="searchDaysBackInput">
          <span>Days Back: <span id="searchDaysBackValue">7</span></span>
          <input id="searchDaysBackInput" class="filter-slider" type="range" min="1" max="14" value="7" step="1" aria-label="Search days back">
        </label>
        <div class="menu-popover-actions">
          <button id="searchApplyBtn" class="primary" type="button">Apply</button>
          <button id="searchCloseBtn" class="menu-btn" type="button">Close</button>
        </div>
      </div>
    </div>
  </div>
`

const apiStatus = document.querySelector('#apiStatus')
const apiDetail = document.querySelector('#apiDetail')
const buildInfo = document.querySelector('#buildInfo')
const locationStatus = document.querySelector('#locationStatus')
const locationDetail = document.querySelector('#locationDetail')
const retryLocationBtn = document.querySelector('#retryLocation')
const filterDaysBackInput = document.querySelector('#filterDaysBack')
const filterDaysBackValue = document.querySelector('#filterDaysBackValue')
const headerDaysBackSelect = document.querySelector('#headerDaysBackSelect')
const headerCountySelect = document.querySelector('#headerCountySelect')
const headerCountyBtn = document.querySelector('#headerCountyBtn')
const headerSpeciesBtn = document.querySelector('#headerSpeciesBtn')
const headerStateSelect = document.querySelector('#headerStateSelect')
const headerStateBtn = document.querySelector('#headerStateBtn')
const headerCountryBtn = document.querySelector('#headerCountryBtn')
const headerCountrySelect = null // element removed
const modeTabBar = document.querySelector('#modeTabBar')
const modeToggleBtn = null // removed in UI revamp — kept as null for safe compat
const filterAbaMinInput = document.querySelector('#filterAbaMin')
const filterAbaMinValue = document.querySelector('#filterAbaMinValue')
const statusPopover = document.querySelector('#statusPopover')
const menuInfoBtn = document.querySelector('#menuInfo')
const menuSearchBtn = document.querySelector('#menuSearch')
const menuPinBtn = document.querySelector('#menuPin')
const speciesLangToggleBtn = document.querySelector('#speciesLangToggle')
const bottomReloadBtn = document.querySelector('#bottomReloadBtn')
const infoModal = document.querySelector('#infoModal')
const infoCloseBtn = document.querySelector('#infoCloseBtn')
const infoTechMetrics = document.querySelector('#infoTechMetrics')
const tapDebugToggle = document.querySelector('#tapDebugToggle')
const tapDebugLog = document.querySelector('#tapDebugLog')
const searchPopover = document.querySelector('#searchPopover')
const searchRegionSelect = document.querySelector('#searchRegionSelect')
const searchCountySelect = document.querySelector('#searchCountySelect')
const searchCountyLabel = document.querySelector('#searchCountyLabel')
const searchSpeciesSelect = document.querySelector('#searchSpeciesSelect')
const searchAbaMinInput = document.querySelector('#searchAbaMinInput')
const searchAbaMinValue = document.querySelector('#searchAbaMinValue')
const searchDaysBackInput = document.querySelector('#searchDaysBackInput')
const searchDaysBackValue = document.querySelector('#searchDaysBackValue')
const searchApplyBtn = document.querySelector('#searchApplyBtn')
const searchCloseBtn = document.querySelector('#searchCloseBtn')
const panelMap = document.querySelector('#panelMap')
const panelTable = document.querySelector('#panelTable')
const mapLoading = document.querySelector('#mapLoading')
const mapLoadingText = document.querySelector('#mapLoadingText')
const mapFullscreenToggleBtn = document.querySelector('#mapFullscreenToggle')
const mapBasemapToggleBtn = document.querySelector('#mapBasemapToggle')
const mapLocateBtn = document.querySelector('#mapLocateBtn')
const mapMeasureBtn = document.querySelector('#mapMeasureBtn')
const mapNearbyRadiusBtn = document.querySelector('#mapNearbyRadiusBtn')
const mapLabelToggleBtn = document.querySelector('#mapLabelToggle')
const mapTableSplitter = document.querySelector('#mapTableSplitter')
const appShell = document.querySelector('#appShell')
const apiKeyGate = document.querySelector('#apiKeyGate')
const apiKeyInput = document.querySelector('#apiKeyInput')
const apiKeyToggleBtn = document.querySelector('#apiKeyToggleBtn')
const apiKeySaveBtn = document.querySelector('#apiKeySaveBtn')
const apiKeyOpenBtn = document.querySelector('#apiKeyOpenBtn')
const apiKeyCloseBtn = document.querySelector('#apiKeyCloseBtn')
const apiKeyError = document.querySelector('#apiKeyError')
const locPermGate = document.querySelector('#locPermGate')
const locPermRetryBtn = document.querySelector('#locPermRetryBtn')
const locPermDeclineBtn = document.querySelector('#locPermDeclineBtn')
const notableCount = document.querySelector('#notableCount')
const notableMeta = document.querySelector('#notableMeta')
const topAbaPills = document.querySelector('#topAbaPills')
const bottomAbaBar = document.querySelector('.bottom-aba-filter-bar')
const bottomLocationBar = document.querySelector('.bottom-location-bar')
const countyPicker = document.querySelector('#countyPicker')
const countyPickerList = document.querySelector('#countyPickerList')
const countyPickerTitle = countyPicker?.querySelector('.county-picker-title')
const pickerAbaPills = document.querySelector('#pickerAbaPills')
const speciesPicker = document.querySelector('#speciesPicker')
const speciesPickerList = document.querySelector('#speciesPickerList')
const statePicker = document.querySelector('#statePicker')
const statePickerList = document.querySelector('#statePickerList')
const statePickerAbaPills = document.querySelector('#statePickerAbaPills')
const abaCodePicker = document.querySelector('#abaCodePicker')
const abaCodePickerList = document.querySelector('#abaCodePickerList')
const notableRows = document.querySelector('#notableRows')
const speciesDetailPanel = document.querySelector('#speciesDetailPanel')
const speciesDetailBody = document.querySelector('#speciesDetailBody')
const speciesDetailTitle = document.querySelector('#speciesDetailTitle')
const speciesDetailDebug = document.querySelector('#speciesDetailDebug')
const speciesDetailStatus = document.querySelector('#speciesDetailStatus')
const speciesDetailBackBtn = document.querySelector('#speciesDetailBackBtn')
const tableRenderStatus = document.querySelector('#tableRenderStatus')
const perfBadge = document.querySelector('#perfBadge')
const perfDetail = document.querySelector('#perfDetail')
const polygonBlockBadge = document.querySelector('#polygonBlockBadge')

function syncPickerInsets() {
  const headerEl = document.querySelector('.app-header')
  if (!headerEl) return
  const rect = headerEl.getBoundingClientRect()
  const topPx = Math.max(0, Math.round(rect.bottom))
  document.documentElement.style.setProperty('--picker-top', `${topPx}px`)
}

function bindMapTableSplitter() {
  if (!mapTableSplitter) return
  const mapStripEl = document.querySelector('.map-strip')
  const headerEl = document.querySelector('.app-header')
  if (!mapStripEl || !headerEl) return

  let dragState = null
  let rafId = null

  const endDrag = () => {
    dragState = null
    document.body.classList.remove('is-resizing')
    if (rafId) {
      window.cancelAnimationFrame(rafId)
      rafId = null
    }
    if (map) {
      try { map.invalidateSize() } catch (_) {}
    }
  }

  mapTableSplitter.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    mapTableSplitter.setPointerCapture?.(e.pointerId)
    document.body.classList.add('is-resizing')
    dragState = {
      startY: e.clientY,
      startHeight: mapStripEl.getBoundingClientRect().height,
    }
  })

  mapTableSplitter.addEventListener('pointermove', (e) => {
    if (!dragState) return
    e.preventDefault()
    const dy = e.clientY - dragState.startY
    let nextHeight = dragState.startHeight + dy

    const headerH = headerEl.getBoundingClientRect().height
    const splitterH = mapTableSplitter.getBoundingClientRect().height || 10
    const minMapH = 160
    const minMainH = 220
    const maxMapH = Math.max(minMapH, window.innerHeight - headerH - splitterH - minMainH)
    nextHeight = Math.max(minMapH, Math.min(maxMapH, nextHeight))

    document.documentElement.style.setProperty('--map-strip-height', `${Math.round(nextHeight)}px`)

    if (map && !rafId) {
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        try { map.invalidateSize() } catch (_) {}
      })
    }
  })

  mapTableSplitter.addEventListener('pointerup', endDrag)
  mapTableSplitter.addEventListener('pointercancel', endDrag)
}

window.addEventListener('resize', () => {
  syncPickerInsets()
})

// Initial layout sync (after first paint)
window.setTimeout(() => syncPickerInsets(), 0)
window.setTimeout(() => bindMapTableSplitter(), 0)
const API_TIMEOUT_MS = 8000
const COUNTY_NOTABLES_TIMEOUT_MS = 5500
const MAP_LABEL_MAX_POINTS = 80
const USER_LOCATION_ZOOM = 11
const MAP_POINTS_FIT_MAX_ZOOM = 11
// When entering a county from a map click, zoom in enough that county-level
// clustering is disabled (“explode” view).
const COUNTY_EXPLODE_ZOOM = 13
const MAP_RENDER_BATCH_SIZE = 260
const BASE_TILE_OPTIONS = {
  updateWhenIdle: false,
  updateWhenZooming: false,
  keepBuffer: 8,
}

let map = null
let osmLayer = null
let satelliteLayer = null
let placeNameLayer = null
let mapPointRenderer = null
let currentBasemap = 'satellite'
let userDot = null
let accuracyCircle = null
let countyOverlay = null
let notableLayer = null
let speciesMarkers = new Map()
let neighborLayerRef = null
let activeOutlineLayerRef = null
let countyNameLayerRef = null
let countyDotLayerRef = null
let stateMarkerLayerRef = null

// Anchor used to sort county lists by distance from the user's current/last county.
let lastCountyAnchorLat = null
let lastCountyAnchorLng = null
let lastCountyAnchorRegion = null

function setCountyDistanceAnchor(lat, lng, countyRegion = null) {
  const nLat = Number(lat)
  const nLng = Number(lng)
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return
  lastCountyAnchorLat = nLat
  lastCountyAnchorLng = nLng
  lastCountyAnchorRegion = countyRegion ? String(countyRegion).toUpperCase() : null
}
let hiddenSpecies = new Set()
let isMapFullscreen = false
let labelMode = 'abbr' // 'abbr', 'full', 'off'
let lastUserLat = null
let lastUserLng = null
let currentTableData = [] // all rows for re-sorting
let lastTableObservationSource = []
let sortState = { col: 'code', dir: 'desc' } // col: 'code'|'species'|'county'|'last'|'distance', dir: 'asc'|'desc'
let activeSortCountyRegion = YOLO_COUNTY_REGION
let pinnedSpecies = null
let preservePinnedSpeciesOnce = false
let latestLocationRequestId = 0
let latestNotablesLoadId = 0
let latestCountySwitchRequestId = 0
let currentRawObservations = []
let currentCountyName = null
let currentCountyRegion = null
const hiResCache = new Map() // countyRegion -> GeoJSON FeatureCollection
let hiResSwapInProgress = false
let currentActiveCountyCode = ''
let latestCountyContextGeojson = null
let filterDaysBack = 7
let filterAbaMin = 1
let selectedReviewFilters = new Set()
let selectedSpecies = null
let mapPointSpeciesFilter = new Set()
let lastSpeciesDetailStateRegion = null
let currentPhysicalCountryCode = null
let latestSpeciesFrequencyRequestId = 0
const speciesFrequencyRegionCache = new Map()
const FREQUENCY_MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const FREQUENCY_WEEKLY_Y_MAX = 50
const FREQUENCY_WEEKLY_AXIS_BINS = [
  { threshold: 2, axisMax: 5 },
  { threshold: 10, axisMax: 10 },
  { threshold: 30, axisMax: 25 },
  { threshold: Infinity, axisMax: 50 },
]
const FREQUENCY_WEEKLY_BAR_HEADROOM_PCT = 46
const FREQUENCY_WEEKLY_STRETCH_MULTIPLIER = 2.6
let frequencyWeeklyScaleMode = 'stretched'
let _frequencyScaleToggleHandlerInstalled = false
let countyPickerOptions = []
let selectedAbaCodes = new Set()
let abaCodePickerOptions = []
let latestSearchCountyOptionsRequestId = 0
let searchApplyInProgress = false
const LAST_ACTIVE_CONTEXT_STORAGE_KEY = 'mrm_last_active_context_v1'
const TAP_DEBUG_STORAGE_KEY = 'mrm_tap_debug_enabled'
const LOCATION_BOOT_PREF_STORAGE_KEY = 'mrm_location_boot_pref_v1'
const TAP_DEBUG_MAX_ENTRIES = 40
let tapDebugEnabled = false
let tapDebugEvents = []
let lastMapRenderSignature = ''
let latestMapRenderId = 0
let lastFilteredObservations = []
let lastFilteredObservationsNoSpecies = []
let lastFilteredRegion = null
let currentMode = 'hybrid' // 'hybrid' | 'list' | 'map' | 'species'
let speciesNameLanguage = 'en' // 'en' | 'nl'
let mapMeasureMode = false
let mapMeasurePoints = []
let mapMeasureLineLayer = null
let mapMeasureLabelMarker = null
let nearbyObservationRadiusKm = 1
const nearbyObservationRadiusOptionsKm = [0.5, 1, 2]
// Pending location selections — set by pickers, applied only when Reload is pressed.
let pendingRegionCode = null   // e.g. 'NL', 'US', 'US-CA' — not yet loaded
let pendingCountyOption = null // countyPickerOption — not yet loaded
const PENDING_LOCATION_STORAGE_KEY = 'mrm_pending_location_v1'
let speciesPickerOptions = []
let explodeClustersOnNextCountySwitch = false
let mapFitMaxZoomOnce = null
let lastMapLocationIndex = new Map() // locKey -> [{ species, abaCode, obsDt, subId }]
let lastPopupLocationIndexAllSpecies = new Map() // locKey -> [{ species, abaCode, obsDt, subId }], ignores selectedSpecies
const countySummaryByRegion = new Map()
const stateSummaryByRegion = new Map()
const stateCountyOptionsCache = new Map()
const lastGoodObservationsByRegion = new Map()
let lastGoodObservationSnapshot = null

function normalizeSpeciesLookupKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeScientificName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const LOCAL_SPECIES_NAME_LOOKUP = (() => {
  const map = new Map()
  const source = (LOCAL_SPECIES_NAMES && typeof LOCAL_SPECIES_NAMES === 'object') ? LOCAL_SPECIES_NAMES : {}
  Object.entries(source).forEach(([englishName, payload]) => {
    const key = normalizeSpeciesLookupKey(englishName)
    if (!key) return
    const addPayload = (entryKey, entryPayload) => {
      if (!entryKey) return
      map.set(entryKey, entryPayload)
    }
    if (typeof payload === 'string') {
      const packed = { nl: payload }
      addPayload(key, packed)
      return
    }
    if (payload && typeof payload === 'object') {
      const normalized = {}
      Object.entries(payload).forEach(([cc, value]) => {
        const country = String(cc || '').trim().toLowerCase()
        const name = String(value || '').trim()
        if (!country || !name) return
        normalized[country] = name
      })
      if (Object.keys(normalized).length > 0) addPayload(key, normalized)
    }
  })
  return map
})()

const NL_SPECIES_REFERENCE_LOOKUP = (() => {
  const map = new Map()
  const source = (NL_SPECIES_REFERENCE_DATA && typeof NL_SPECIES_REFERENCE_DATA === 'object')
    ? (NL_SPECIES_REFERENCE_DATA.species || {})
    : {}
  Object.entries(source).forEach(([englishName, payload]) => {
    const key = normalizeSpeciesLookupKey(englishName)
    if (!key || !payload || typeof payload !== 'object') return
    map.set(key, payload)
  })
  return map
})()

const AVIBASE_NL_ENGLISH_LOOKUP = (() => {
  const map = new Map()
  const source = (AVIBASE_NL_CHECKLIST_DATA && typeof AVIBASE_NL_CHECKLIST_DATA === 'object')
    ? (AVIBASE_NL_CHECKLIST_DATA.entries || [])
    : []
  source.forEach((row) => {
    if (!row || typeof row !== 'object') return
    const englishKey = normalizeSpeciesLookupKey(row.englishName)
    if (!englishKey) return
    const current = Array.isArray(map.get(englishKey)) ? map.get(englishKey) : []
    current.push(row)
    map.set(englishKey, current)
  })
  return map
})()

const AVIBASE_NL_SCIENTIFIC_LOOKUP = (() => {
  const map = new Map()
  const source = (AVIBASE_NL_CHECKLIST_DATA && typeof AVIBASE_NL_CHECKLIST_DATA === 'object')
    ? (AVIBASE_NL_CHECKLIST_DATA.entries || [])
    : []
  source.forEach((row) => {
    if (!row || typeof row !== 'object') return
    const sciKey = normalizeScientificName(row.scientificName)
    if (!sciKey) return
    if (!map.has(sciKey)) map.set(sciKey, row)
  })
  return map
})()

const NL_CDNA_REVIEW_SCIENTIFIC_SET = (() => {
  const set = new Set()
  const source = Array.isArray(NL_CDNA_REVIEW_SCIENTIFIC) ? NL_CDNA_REVIEW_SCIENTIFIC : []
  source.forEach((name) => {
    const normalized = normalizeScientificName(name)
    if (normalized) set.add(normalized)
  })
  return set
})()

const NL_RARITY_RANK = new Map([
  ['R', 6],
  ['A', 5], ['B', 4], ['C', 3], ['D', 2], ['E', 1],
  ['1', 5], ['2', 4], ['3', 3], ['4', 2], ['5', 1],
])

function getNlSpeciesReference(speciesName) {
  const key = normalizeSpeciesLookupKey(speciesName)
  if (!key) return null
  return NL_SPECIES_REFERENCE_LOOKUP.get(key) || null
}

function getAvibaseNlChecklistInfo(speciesName, scientificName = '') {
  const sciKey = normalizeScientificName(scientificName)
  if (sciKey && AVIBASE_NL_SCIENTIFIC_LOOKUP.has(sciKey)) {
    return AVIBASE_NL_SCIENTIFIC_LOOKUP.get(sciKey) || null
  }

  const englishKey = normalizeSpeciesLookupKey(speciesName)
  if (!englishKey) return null
  const rows = Array.isArray(AVIBASE_NL_ENGLISH_LOOKUP.get(englishKey))
    ? AVIBASE_NL_ENGLISH_LOOKUP.get(englishKey)
    : []
  if (!rows.length) return null

  if (sciKey) {
    const exactScientific = rows.find((row) => normalizeScientificName(row?.scientificName) === sciKey)
    if (exactScientific) return exactScientific
  }
  return rows[0] || null
}

function isNlCdnaReviewScientificName(scientificName) {
  const normalized = normalizeScientificName(scientificName)
  if (!normalized) return false
  if (NL_CDNA_REVIEW_SCIENTIFIC_SET.has(normalized)) return true
  const parts = normalized.split(' ')
  if (parts.length >= 2) {
    const binomial = `${parts[0]} ${parts[1]}`
    if (NL_CDNA_REVIEW_SCIENTIFIC_SET.has(binomial)) return true
  }
  return false
}

function getNlRarityCodeForSpecies(speciesName, scientificName = '') {
  const info = getNlSpeciesReference(speciesName)
  const code = String(info?.nlRarityCode || '').trim().toUpperCase()
  const sci = String(scientificName || info?.scientificName || '').trim()
  if (code === 'R') {
    return isNlCdnaReviewScientificName(sci) ? 'R' : null
  }
  if (code) return code
  if (isNlCdnaReviewScientificName(sci)) return 'R'
  return null
}

function validateNlReviewLabelConsistency() {
  const mismatches = []
  NL_SPECIES_REFERENCE_LOOKUP.forEach((payload, key) => {
    const rarityCode = String(payload?.nlRarityCode || '').trim().toUpperCase()
    if (rarityCode !== 'R') return
    const sci = String(payload?.scientificName || '').trim()
    if (!isNlCdnaReviewScientificName(sci)) {
      mismatches.push({ key, scientificName: sci || 'missing scientific name' })
    }
  })
  if (mismatches.length > 0) {
    console.warn('NL review-label mismatch: species marked R but not in CDNA review scientific list', mismatches.slice(0, 25))
  }
}

function isNlRarityPillMode(regionCode = currentCountyRegion) {
  const state = stateRegionFromAnyRegion(regionCode) || String(regionCode || '').toUpperCase()
  return LEAF_SUBNATIONAL1_COUNTRIES.has(String(state || '').toUpperCase())
}

function getReviewPillCodeForObservation(item) {
  const species = String(item?.comName || '').trim()
  const scientific = String(item?.sciName || item?.scientificName || '').trim()
  const code = String(getNlRarityCodeForSpecies(species, scientific) || '').toUpperCase()
  return code === 'R' ? 'R' : 'N'
}

function getNlRarityRank(code) {
  if (code === null || code === undefined) return -1
  const normalized = String(code).trim().toUpperCase()
  if (!normalized) return -1
  if (NL_RARITY_RANK.has(normalized)) return NL_RARITY_RANK.get(normalized)
  return -1
}

const DEFAULT_STATE_PREFETCH_DAYS_BACK = 14
let statePrefetchDaysBack = DEFAULT_STATE_PREFETCH_DAYS_BACK
const statePrefetchInFlight = new Set() // stateRegion -> true

// ---------------------------------------------------------------------------
// Lightweight render-pipeline profiling
// ---------------------------------------------------------------------------
const PERF_STAGES = ['location', 'county', 'fetch', 'table', 'map']
const _perfStart = {}
const _perfResult = {}
const apiSessionStats = {
  calls: 0,
  totalMs: 0,
  last: '',
}
let lastStatePrefetchStats = null // { state, daysBack, obsCount, ms }

function perfStart(stage) {
  _perfStart[stage] = performance.now()
}

function perfEnd(stage) {
  if (_perfStart[stage] == null) return
  _perfResult[stage] = Math.round(performance.now() - _perfStart[stage])
  delete _perfStart[stage]
  _updatePerfBadge()
}

function _updatePerfBadge() {
  if (!perfBadge) return
  const done = PERF_STAGES.filter((s) => _perfResult[s] != null)
  if (done.length === 0) return
  const total = done.reduce((sum, s) => sum + _perfResult[s], 0)
  const worst = done.reduce((m, s) => (_perfResult[s] > _perfResult[m] ? s : m), done[0])
  perfBadge.textContent = `${total} ms`
  perfBadge.className = `badge ${total < 1500 ? 'ok' : 'warn'}`
  if (perfDetail) {
    perfDetail.textContent = PERF_STAGES
      .filter((s) => _perfResult[s] != null)
      .map((s) => `${s.padEnd(9)}${String(_perfResult[s]).padStart(5)} ms${s === worst && done.length > 1 ? ' ◀' : ''}`)
      .join('\n')
  }
  updateRuntimeLog()
}

function perfReset() {
  PERF_STAGES.forEach((s) => { delete _perfResult[s]; delete _perfStart[s] })
  if (perfBadge) { perfBadge.textContent = '—'; perfBadge.className = 'badge' }
  if (perfDetail) perfDetail.textContent = ''
  updateRuntimeLog()
}
// ---------------------------------------------------------------------------
const countySummaryInFlight = new Set()
let countySummaryPrefetchToken = 0
let countyPickerRenderTimer = null
const UI_FAILSAFE_TIMEOUT_MS = 22000
let uiFailsafeTimer = null
let lastMapLoadingMessage = 'Loading map…'
const mapLoadState = {
  location: false,
  activeCounty: false,
  stateMask: false,
  observations: false,
}

function clearUiFailsafeTimer() {
  if (uiFailsafeTimer) {
    window.clearTimeout(uiFailsafeTimer)
    uiFailsafeTimer = null
  }
}

function restoreFromRecoverySnapshot(reason = 'failsafe') {
  const recovery = getRecoverySnapshot(currentCountyRegion || currentActiveCountyCode || null)
  if (!recovery || !Array.isArray(recovery.observations) || recovery.observations.length === 0) return false
  currentRawObservations = recovery.observations.slice()
  currentCountyName = recovery.countyName || currentCountyName || null
  currentCountyRegion = recovery.countyRegion || currentCountyRegion || null
  currentActiveCountyCode = String(recovery.activeCountyCode || currentActiveCountyCode || '').toUpperCase()
  const filtered = applyActiveFiltersAndRender({ renderMap: true, fitToObservations: false })
  if (notableMeta) notableMeta.textContent = `${notableMeta.textContent || ''} · ${reason}-recovered`
  setTableRenderStatus(`recovery-${reason} rows=${filtered.length}`)
  return true
}

function armUiFailsafeTimer() {
  clearUiFailsafeTimer()
  uiFailsafeTimer = window.setTimeout(() => {
    uiFailsafeTimer = null
    const loadingCount = notableCount?.textContent || ''
    const appearsStuck = mapLoading?.classList?.contains('visible') || loadingCount === 'Loading…' || loadingCount === 'Refreshing…'
    if (!appearsStuck) return

    console.warn('[failsafe] UI loading watchdog fired:', lastMapLoadingMessage)
    mapLoadState.location = true
    mapLoadState.activeCounty = true
    mapLoadState.stateMask = true
    mapLoadState.observations = true
    setMapLoading(false)

    if (!restoreFromRecoverySnapshot('watchdog')) {
      if (notableCount) {
        notableCount.className = 'badge warn'
        notableCount.textContent = '0'
      }
      if (notableMeta) notableMeta.textContent = 'Recovered from a stuck loading state'
      if (notableRows) notableRows.innerHTML = '<tr><td colspan="8">A stuck loading operation was reset. Try your action again.</td></tr>'
      updateStatPills('0', '0', '0')
      setTableRenderStatus('failsafe-watchdog-reset')
    }
    updateRuntimeLog()
  }, UI_FAILSAFE_TIMEOUT_MS)
}

function setMapLoading(visible, text = 'Loading map…') {
  if (visible) {
    lastMapLoadingMessage = text || 'Loading map…'
    mapLoading.classList.add('visible')
    mapLoadingText.textContent = text
    armUiFailsafeTimer()
  } else {
    mapLoading.classList.remove('visible')
    clearUiFailsafeTimer()
  }
}

function resetMapLoadState() {
  mapLoadState.location = false
  mapLoadState.activeCounty = false
  mapLoadState.stateMask = false
  mapLoadState.observations = false
  perfReset()
  setMapLoading(true, 'Loading map…')
}

function markMapPartReady(part) {
  mapLoadState[part] = true
  if (mapLoadState.location && mapLoadState.activeCounty && mapLoadState.stateMask && mapLoadState.observations) {
    setMapLoading(false)
  }
}

function handleUnhandledUiFault(source, error) {
  console.error(`[ui-failsafe] ${source}:`, error)
  mapLoadState.location = true
  mapLoadState.activeCounty = true
  mapLoadState.stateMask = true
  mapLoadState.observations = true
  setMapLoading(false)
  restoreFromRecoverySnapshot(source)
  updateRuntimeLog()
}

function rememberLastGoodObservations(observations, countyName, countyRegion, activeCountyCode) {
  if (!Array.isArray(observations) || observations.length === 0) return
  const payload = {
    observations: observations.slice(),
    countyName: countyName || null,
    countyRegion: countyRegion || null,
    activeCountyCode: String(activeCountyCode || countyRegion || '').toUpperCase(),
    timestamp: Date.now(),
  }
  lastGoodObservationSnapshot = payload
  const regionKey = String(payload.countyRegion || payload.activeCountyCode || '').toUpperCase()
  if (regionKey) lastGoodObservationsByRegion.set(regionKey, payload)
  persistLastActiveContext({
    regionCode: payload.countyRegion,
    countyName: payload.countyName,
    activeCountyCode: payload.activeCountyCode,
    lat: Number.isFinite(lastCountyAnchorLat) ? lastCountyAnchorLat : null,
    lng: Number.isFinite(lastCountyAnchorLng) ? lastCountyAnchorLng : null,
  })
}

function getRecoverySnapshot(targetCountyRegion = null) {
  const regionKey = String(targetCountyRegion || '').toUpperCase()
  if (regionKey && lastGoodObservationsByRegion.has(regionKey)) {
    return lastGoodObservationsByRegion.get(regionKey)
  }
  return lastGoodObservationSnapshot
}

function nextAnimationFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

function persistLastActiveContext({ regionCode = null, countyName = null, activeCountyCode = null, lat = null, lng = null } = {}) {
  const normalizedRegion = String(regionCode || '').toUpperCase()
  if (!normalizedRegion) return
  try {
    localStorage.setItem(LAST_ACTIVE_CONTEXT_STORAGE_KEY, JSON.stringify({
      regionCode: normalizedRegion,
      countyName: countyName ? String(countyName).trim() : null,
      activeCountyCode: activeCountyCode ? String(activeCountyCode).toUpperCase() : null,
      lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
      lng: Number.isFinite(Number(lng)) ? Number(lng) : null,
      ts: Date.now(),
    }))
  } catch (_) {}
}

function loadLastActiveContext() {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_ACTIVE_CONTEXT_STORAGE_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return null
    const regionCode = String(raw.regionCode || '').toUpperCase()
    if (!regionCode) return null
    return {
      regionCode,
      countyName: raw.countyName ? String(raw.countyName) : null,
      activeCountyCode: raw.activeCountyCode ? String(raw.activeCountyCode).toUpperCase() : null,
      lat: Number.isFinite(Number(raw.lat)) ? Number(raw.lat) : null,
      lng: Number.isFinite(Number(raw.lng)) ? Number(raw.lng) : null,
      ts: Number(raw.ts) || 0,
    }
  } catch {
    return null
  }
}

async function restoreLastActiveContextOnBoot() {
  const saved = loadLastActiveContext()
  if (!saved) return false

  const normalizedRegion = String(saved.regionCode || '').toUpperCase()
  if (!normalizedRegion) return false

  if (normalizedRegion === US_REGION_CODE || isStateRegionCode(normalizedRegion)) {
    await activateStateByRegion(normalizedRegion)
    return true
  }

  if (isCountyRegionCode(normalizedRegion)) {
    const parentState = stateRegionFromCountyRegion(normalizedRegion)
    if (parentState && isStateRegionCode(parentState)) {
      await activateStateByRegion(parentState)
      const option = countyPickerOptions.find((opt) => String(opt.countyRegion || '').toUpperCase() === normalizedRegion)
      if (option) {
        await activateCountyFromOption(option)
        return true
      }
    }

    await activateCountyByRegion(
      normalizedRegion,
      Number.isFinite(saved.lat) ? saved.lat : null,
      Number.isFinite(saved.lng) ? saved.lng : null,
      saved.countyName || ''
    )
    return true
  }

  return false
}

async function cleanupLegacyServiceWorkersOnce() {
  const CLEANUP_KEY = 'mrm_legacy_sw_cleanup_v1'
  try {
    if (localStorage.getItem(CLEANUP_KEY) === '1') return
  } catch (_) {}

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)))
    }

    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => /^rarity-mobile-|^workbox-|^vite-/.test(String(key || '')))
          .map((key) => caches.delete(key))
      )
    }

    try { localStorage.setItem(CLEANUP_KEY, '1') } catch (_) {}
  } catch (error) {
    console.warn('legacy service worker cleanup skipped:', error)
  }
}

function isStaleLocationRequest(requestId) {
  return requestId !== latestLocationRequestId
}

function isStaleCountySwitchRequest(requestId) {
  return requestId !== latestCountySwitchRequestId
}

function isStaleNotablesLoad(loadId, requestId, countySwitchRequestId = null) {
  if (loadId !== latestNotablesLoadId) return true
  if (requestId !== null && isStaleLocationRequest(requestId)) return true
  if (countySwitchRequestId !== null && isStaleCountySwitchRequest(countySwitchRequestId)) return true
  return false
}

function applyActiveFiltersAndRender(options = {}) {
  const { renderMap = true, fitToObservations = false, allowAutoRecovery = true } = options
  const source = Array.isArray(currentRawObservations) ? currentRawObservations : []
  const cutoff = cutoffDateForDaysBack(filterDaysBack)
  const activeRegion = String(currentCountyRegion || '').toUpperCase()
  const abaFloor = activeRegion === US_REGION_CODE ? 3 : 1
  const abaMin = Math.min(5, Math.max(abaFloor, Number(filterAbaMin) || abaFloor))
  if (filterAbaMin !== abaMin) {
    filterAbaMin = abaMin
    if (filterAbaMinInput) filterAbaMinInput.value = String(filterAbaMin)
  }
  const filteredByDays = source.filter((item) => {
    const obsDate = parseObsDate(item?.obsDt)
    if (!obsDate || obsDate < cutoff) return false
    return true
  })
  updateAbaCodePickerOptions(filteredByDays)
  const isNlMode = isNlRarityPillMode(activeRegion)
  const hasReviewFilter = selectedReviewFilters instanceof Set && selectedReviewFilters.size > 0
  const filteredByStatus = filteredByDays.filter((item) => {
    if (isNlMode) {
      if (!hasReviewFilter) return true
      const reviewCode = getReviewPillCodeForObservation(item)
      return selectedReviewFilters.has(reviewCode)
    }
    if (!hasReviewFilter) {
      return true
    }
    const confirmedOnly = selectedReviewFilters.has('confirmed') && !selectedReviewFilters.has('pending')
    const pendingOnly = selectedReviewFilters.has('pending') && !selectedReviewFilters.has('confirmed')
    if (confirmedOnly) return isConfirmedObservation(item)
    if (pendingOnly) return !isConfirmedObservation(item)
    return true
  })

  // Popups should be able to show other notable species at the same location
  // even when the map is filtered down to a single species.
  const filteredNoSpecies = filteredByStatus.filter((item) => matchesAbaSelection(item, abaMin, selectedAbaCodes))
  lastFilteredObservationsNoSpecies = filteredNoSpecies
  lastPopupLocationIndexAllSpecies = buildLocationIndexForPopup(filteredNoSpecies)

  updateSpeciesPickerOptions(filteredByStatus)
  const hasMapPointFilter = mapPointSpeciesFilter instanceof Set && mapPointSpeciesFilter.size > 0
  const filteredByPointSpecies = hasMapPointFilter
    ? filteredByStatus.filter((item) => mapPointSpeciesFilter.has(String(item?.comName || '')))
    : filteredByStatus
  const filteredBySpecies = selectedSpecies
    ? filteredByStatus.filter((item) => String(item?.comName || '') === selectedSpecies)
    : filteredByPointSpecies

  const activeCountyCode = String(currentActiveCountyCode || '').toUpperCase()
  const isStateMode = isStateRegionCode(activeRegion) && !isCountyRegionCode(activeCountyCode)
  const isNationalSummaryMode = activeRegion === US_REGION_CODE

  // State mode shows the full state's dataset; distance is used for sorting
  // (in the table renderer), not for filtering.
  const pillObservationSource = filteredBySpecies

  const filtered = pillObservationSource.filter((item) => matchesAbaSelection(item, abaMin, selectedAbaCodes))

  if (allowAutoRecovery && filtered.length === 0 && filteredByDays.length > 0) {
    let recovered = false
    if (selectedSpecies && filteredByStatus.length > 0) {
      selectedSpecies = null
      recovered = true
    } else if (hasMapPointFilter && filteredByStatus.length > 0) {
      mapPointSpeciesFilter = new Set()
      recovered = true
    } else if (selectedReviewFilters instanceof Set && selectedReviewFilters.size > 0) {
      selectedReviewFilters = new Set()
      recovered = true
    }

    if (recovered) {
      updateFilterUi()
      return applyActiveFiltersAndRender({ renderMap, fitToObservations, allowAutoRecovery: false })
    }
  }

  // ABA pills should reflect the current view's dataset before ABA filtering.
  const abaPillSource = pillObservationSource
  refreshSearchSpeciesOptions(filteredByDays)
  renderNotableTable(filtered, currentCountyName, currentCountyRegion, abaPillSource)
  lastFilteredObservations = filtered
  lastFilteredRegion = activeRegion
  syncSpeciesModeUi()
  updateSpeciesButtonLabel()
  if (renderMap) {
    renderNotablesOnMap(
      isNationalSummaryMode ? [] : filtered,
      (currentActiveCountyCode || currentCountyRegion || '').toUpperCase(),
      fitToObservations
    )
    if (isNationalSummaryMode) {
      renderStateMarkersOnMap(filtered)
    } else {
      clearStateMarkers()
    }
  }
  syncFilterPillUi()
  updateCountyDots()
  return filtered
}

function updateSpeciesPickerOptions(source) {
  const input = Array.isArray(source) ? source : []
  const maxAbaBySpecies = new Map()
  for (const item of input) {
    const name = String(item?.comName || '').trim()
    if (!name) continue
    const code = getAbaCodeNumber(item)
    const prev = maxAbaBySpecies.get(name)
    if (!maxAbaBySpecies.has(name)) {
      maxAbaBySpecies.set(name, Number.isFinite(code) ? code : null)
      continue
    }
    if (Number.isFinite(code) && (!Number.isFinite(prev) || code > prev)) {
      maxAbaBySpecies.set(name, code)
    }
  }

  speciesPickerOptions = Array.from(maxAbaBySpecies.entries())
    .map(([name, maxAba]) => ({ name, maxAba }))
    .sort((a, b) => a.name.localeCompare(b.name))

  renderSpeciesPickerOptions()
}

function renderSpeciesPickerOptions() {
  if (!speciesPickerList) return
  const allActive = !selectedSpecies
  const rows = []
  rows.push(
    `<button type="button" class="county-option${allActive ? ' is-active' : ''}" data-species="" role="option" aria-selected="${allActive ? 'true' : 'false'}"><span class="county-option-name">All species</span><span class="county-option-meta county-option-meta-pills"></span></button>`
  )
  for (const opt of speciesPickerOptions) {
    const isActive = selectedSpecies === opt.name
    const badge = renderAbaCodeBadge(opt.maxAba)
    const displayName = getDisplaySpeciesLabel(opt.name)
    rows.push(
      `<button type="button" class="county-option${isActive ? ' is-active' : ''}" data-species="${escapeHtml(opt.name)}" role="option" aria-selected="${isActive ? 'true' : 'false'}"><span class="county-option-name">${escapeHtml(displayName || opt.name)}</span><span class="county-option-meta county-option-meta-pills">${badge}</span></button>`
    )
  }
  speciesPickerList.innerHTML = rows.join('')
}

function updateSpeciesButtonLabel() {
  if (!headerSpeciesBtn) return
  headerSpeciesBtn.textContent = selectedSpecies ? getDisplaySpeciesLabel(String(selectedSpecies)) : 'Species'
}

function syncSpeciesModeUi() {
  const isSpeciesMode = currentMode === 'species'
  if (headerCountyBtn) headerCountyBtn.toggleAttribute('hidden', isSpeciesMode)
  if (headerSpeciesBtn) headerSpeciesBtn.toggleAttribute('hidden', !isSpeciesMode)
  // sync mode tab bar active state
  if (modeTabBar) {
    modeTabBar.querySelectorAll('.mode-tab').forEach((btn) => {
      const active = btn.dataset.mode === currentMode
      btn.classList.toggle('mode-tab--active', active)
      btn.setAttribute('aria-pressed', String(active))
    })
  }
}

function refreshLocationBar() {
  syncLocationBarState()
}

function clonePendingCountyOption(option) {
  if (!option) return null
  const countyRegion = String(option.countyRegion || '').toUpperCase()
  return {
    countyRegion: countyRegion || null,
    countyName: String(option.countyName || '').trim() || 'County',
    lat: Number.isFinite(Number(option.lat)) ? Number(option.lat) : null,
    lng: Number.isFinite(Number(option.lng)) ? Number(option.lng) : null,
  }
}

function hasPendingLocationSelection() {
  return Boolean(pendingRegionCode || pendingCountyOption)
}

function savePendingLocationSelection() {
  try {
    if (!hasPendingLocationSelection()) {
      localStorage.removeItem(PENDING_LOCATION_STORAGE_KEY)
      return
    }
    localStorage.setItem(PENDING_LOCATION_STORAGE_KEY, JSON.stringify({
      regionCode: pendingRegionCode ? String(pendingRegionCode).toUpperCase() : null,
      countyOption: clonePendingCountyOption(pendingCountyOption),
      ts: Date.now(),
    }))
  } catch (_) {}
}

function syncLocationBarState() {
  const activeRegion = String(currentCountyRegion || '').toUpperCase()
  const pendingCountyRegion = String(pendingCountyOption?.countyRegion || '').toUpperCase()
  const pendingRegion = String(pendingRegionCode || '').toUpperCase()
  const displayRegion = pendingCountyRegion || pendingRegion || activeRegion || 'NL'
  const stateRegion = stateRegionFromAnyRegion(displayRegion) || stateRegionFromAnyRegion(activeRegion) || 'NL'
  const isNl = LEAF_SUBNATIONAL1_COUNTRIES.has(stateRegion)
  const isUs = stateRegion.startsWith('US')
  const hasPending = hasPendingLocationSelection()

  let countyLabel = String(currentCountyName || '').trim()
  if (headerCountySelect?.selectedOptions?.[0]?.textContent) {
    countyLabel = String(headerCountySelect.selectedOptions[0].textContent || '').trim() || countyLabel
  }
  if (pendingCountyOption) {
    countyLabel = String(pendingCountyOption.countyName || 'County')
  } else if (pendingRegion) {
    countyLabel = pendingRegion === 'NL'
      ? 'Select Province'
      : pendingRegion === US_REGION_CODE
        ? 'Select County'
        : 'Select County'
  } else if (!countyLabel) {
    countyLabel = activeRegion === 'NL'
      ? 'Select Province'
      : activeRegion === US_REGION_CODE
        ? 'Select County'
        : isStateRegionCode(activeRegion)
          ? 'Select County'
          : 'County'
  }

  if (headerCountryBtn) {
    headerCountryBtn.textContent = isNl ? 'NL' : isUs ? 'US' : stateRegion.split('-')[0] || stateRegion
    headerCountryBtn.classList.toggle('is-pending', hasPending)
  }

  if (headerStateBtn) {
    headerStateBtn.toggleAttribute('hidden', isNl)
    if (!isNl) {
      headerStateBtn.textContent = stateRegion === US_REGION_CODE ? 'State' : (getStateAbbrevByRegion(stateRegion) || stateRegion)
      headerStateBtn.title = stateRegion === US_REGION_CODE ? 'Choose state' : (getStateNameByRegion(stateRegion) || 'Choose state')
    }
    headerStateBtn.classList.toggle('is-pending', hasPending)
  }

  if (headerCountyBtn) {
    headerCountyBtn.textContent = countyLabel
    headerCountyBtn.title = hasPending ? `Pending: ${countyLabel}` : countyLabel
    headerCountyBtn.classList.toggle('is-pending', hasPending)
  }

  if (countyPickerTitle) {
    countyPickerTitle.textContent = isNl ? 'Provinces' : 'Counties'
  }

  if (searchCountyLabel) {
    searchCountyLabel.textContent = isNl ? 'Province:' : 'County:'
  }
  if (searchCountySelect) {
    searchCountySelect.setAttribute('aria-label', isNl ? 'Search province' : 'Search county')
  }

  if (bottomLocationBar) {
    bottomLocationBar.classList.toggle('has-pending', hasPending)
    bottomLocationBar.dataset.pending = hasPending ? 'true' : 'false'
  }

  if (bottomReloadBtn) {
    bottomReloadBtn.classList.toggle('has-pending', hasPending)
    bottomReloadBtn.classList.toggle('active', hasPending)
    const label = hasPending ? 'Apply pending location' : 'Reload current location'
    bottomReloadBtn.title = label
    bottomReloadBtn.setAttribute('aria-label', label)
  }
}

function setPendingLocationSelection({ regionCode = null, countyOption = null, persist = true } = {}) {
  pendingCountyOption = clonePendingCountyOption(countyOption)
  const normalizedRegion = String(regionCode || pendingCountyOption?.countyRegion || '').toUpperCase()
  pendingRegionCode = normalizedRegion || null
  if (persist) savePendingLocationSelection()
  syncLocationBarState()
}

function clearPendingLocationSelection({ persist = true } = {}) {
  pendingRegionCode = null
  pendingCountyOption = null
  if (persist) savePendingLocationSelection()
  syncLocationBarState()
}

function restorePendingLocationSelection() {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_LOCATION_STORAGE_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return false
    const countyOption = clonePendingCountyOption(raw.countyOption)
    const regionCode = String(raw.regionCode || countyOption?.countyRegion || '').toUpperCase()
    if (!countyOption && !regionCode) return false
    pendingCountyOption = countyOption
    pendingRegionCode = regionCode || null
    syncLocationBarState()
    return true
  } catch {
    return false
  }
}

function closeSpeciesPicker() {
  if (!speciesPicker) return
  speciesPicker.setAttribute('hidden', 'hidden')
}

function toggleSpeciesPicker() {
  if (!speciesPicker || !speciesPickerList) return
  closeCountyPicker()
  closeStatePicker()
  closeAbaCodePicker()
  if (speciesPicker.hasAttribute('hidden')) speciesPicker.removeAttribute('hidden')
  else speciesPicker.setAttribute('hidden', 'hidden')
}

function setPillExpandedLabel(pill, prefix) {
  if (!pill) return
  if (!pill.dataset.short || pill.textContent.includes(':')) {
    pill.dataset.short = pill.textContent.replace(/^.*?:\s*/, '').trim()
  }
  pill.textContent = `${prefix}: ${pill.dataset.short}`
  pill.classList.add('obs-stat-expanded')
}

function syncFilterPillUi() {
  const abaPills = document.querySelectorAll('#topAbaPills .stat-aba-pill, .picker-aba-pills .stat-aba-pill')
  const isNlMode = isNlRarityPillMode()
  abaPills.forEach((pill) => {
    const rawCode = String(pill.dataset.code || '').toUpperCase()
    const code = Number(rawCode)
    const isActive = isNlMode
      ? (rawCode === 'R' || rawCode === 'N') && selectedReviewFilters instanceof Set && selectedReviewFilters.has(rawCode)
      : (Number.isFinite(code) && selectedAbaCodes instanceof Set && selectedAbaCodes.has(code))
    pill.classList.toggle('is-active', isActive)
    pill.setAttribute('aria-pressed', String(isActive))
  })
}

function updateFilterUi() {
  if (filterDaysBackValue) filterDaysBackValue.textContent = String(filterDaysBack)
  if (filterAbaMinValue) filterAbaMinValue.textContent = String(filterAbaMin)
  if (headerDaysBackSelect && headerDaysBackSelect.value !== String(filterDaysBack)) headerDaysBackSelect.value = String(filterDaysBack)
  if (searchDaysBackInput) searchDaysBackInput.value = String(filterDaysBack)
  if (searchDaysBackValue) searchDaysBackValue.textContent = String(filterDaysBack)
  if (searchAbaMinInput) searchAbaMinInput.value = String(filterAbaMin)
  if (searchAbaMinValue) searchAbaMinValue.textContent = String(filterAbaMin)
}

function getEffectiveSearchAbaMin(regionCode, requestedAbaMin) {
  const normalizedRegion = String(regionCode || '').toUpperCase()
  const requested = Math.max(1, Math.min(5, Number(requestedAbaMin) || 1))
  if (normalizedRegion === US_REGION_CODE) return Math.max(3, requested)
  return requested
}

function syncSearchSlidersForRegion(regionCode) {
  if (!searchAbaMinInput || !searchAbaMinValue || !searchDaysBackInput || !searchDaysBackValue) return
  const normalizedRegion = String(regionCode || '').toUpperCase()
  const isUsRegion = normalizedRegion === US_REGION_CODE

  searchAbaMinInput.min = isUsRegion ? '3' : '1'
  searchAbaMinInput.max = '5'
  const currentAba = Number(searchAbaMinInput.value || filterAbaMin || 1)
  const effectiveAba = getEffectiveSearchAbaMin(normalizedRegion, currentAba)
  searchAbaMinInput.value = String(effectiveAba)
  searchAbaMinValue.textContent = String(effectiveAba)

  const days = Math.max(1, Math.min(14, Number(searchDaysBackInput.value || filterDaysBack || 7)))
  searchDaysBackInput.value = String(days)
  searchDaysBackValue.textContent = String(days)
}

function closeCountyPicker() {
  if (!countyPicker) return
  countyPicker.setAttribute('hidden', 'hidden')
}

function closeAbaCodePicker() {
  if (!abaCodePicker) return
  abaCodePicker.setAttribute('hidden', 'hidden')
}

function toggleCountyPicker() {
  if (!countyPicker || !countyPickerList) return
  closeStatePicker()
  closeAbaCodePicker()
  closeSpeciesPicker()
  if (countyPicker.hasAttribute('hidden')) countyPicker.removeAttribute('hidden')
  else countyPicker.setAttribute('hidden', 'hidden')
}

function toggleAbaCodePicker() {
  if (!abaCodePicker || !abaCodePickerList) return
  closeCountyPicker()
  closeSpeciesPicker()
  if (abaCodePicker.hasAttribute('hidden')) abaCodePicker.removeAttribute('hidden')
  else abaCodePicker.setAttribute('hidden', 'hidden')
}

function updateAbaCodePickerOptions(source) {
  if (!abaCodePickerList) return
  const counts = new Map([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]])
  ;(Array.isArray(source) ? source : []).forEach((item) => {
    const code = getAbaCodeNumber(item)
    if (Number.isFinite(code) && code >= 1 && code <= 5) counts.set(code, (counts.get(code) || 0) + 1)
    else counts.set(0, (counts.get(0) || 0) + 1)
  })
  const allCount = Array.from(counts.values()).reduce((sum, val) => sum + val, 0)
  abaCodePickerOptions = [{ value: 'all', label: `Show all codes · ${allCount}` }]
  for (let code = 1; code <= 5; code += 1) {
    abaCodePickerOptions.push({ value: String(code), label: `ABA ${code} · ${counts.get(code) || 0}` })
  }
  abaCodePickerOptions.push({ value: '0', label: `ABA 0 (none) · ${counts.get(0) || 0}` })
  abaCodePickerList.innerHTML = abaCodePickerOptions
    .map((opt, index) => {
      const parsed = Number(opt.value)
      const isAll = opt.value === 'all'
      const isActive = isAll
        ? (selectedAbaCodes.size === 0)
        : (Number.isFinite(parsed) && selectedAbaCodes.has(Math.round(parsed)))
      return `<button type="button" class="county-option${isActive ? ' is-active' : ''}" data-index="${index}" role="option" aria-selected="${isActive ? 'true' : 'false'}">${escapeHtml(opt.label)}</button>`
    })
    .join('')
}

function buildCountyGeojsonWithActiveRegion(sourceGeojson, countyRegion) {
  if (!sourceGeojson || !Array.isArray(sourceGeojson.features) || !countyRegion) return null
  const targetRegion = String(countyRegion).toUpperCase()
  let found = false
  const features = sourceGeojson.features.map((feature) => {
    const regionRaw = feature?.properties?.countyRegion || feature?.properties?.subnational2Code || feature?.properties?.subnational1Code || null
    const region = regionRaw ? String(regionRaw).toUpperCase() : null
    const isActive = region === targetRegion
    if (isActive) found = true
    return {
      ...feature,
      properties: {
        ...(feature?.properties || {}),
        countyRegion: region || null,
        isActiveCounty: isActive,
      },
    }
  })
  if (!found) return null
  return {
    ...sourceGeojson,
    inverseMaskFeatures: undefined,
    activeLabel: undefined,
    activeCountyRegion: targetRegion,
    features,
  }
}

function getFeatureCountyRegionCode(feature) {
  return String(
    feature?.properties?.countyRegion
    || feature?.properties?.subnational2Code
    || feature?.properties?.subnational1Code
    || ''
  ).toUpperCase().trim()
}

function getFeatureCenter(feature) {
  try {
    const center = getFeatureVisualCenter(feature)
    if (!center) return null
    return { lat: center.lat, lng: center.lng }
  } catch {
    return null
  }
}

function findNeighborCountyFeatureAtLatLng(lat, lng) {
  const features = Array.isArray(latestCountyContextGeojson?.features) ? latestCountyContextGeojson.features : []
  const activeRegion = String(currentCountyRegion || latestCountyContextGeojson?.activeCountyRegion || '').toUpperCase().trim()
  for (const feature of features) {
    const featureRegion = getFeatureCountyRegionCode(feature)
    if (feature?.properties?.isActiveCounty) continue
    if (activeRegion && featureRegion && featureRegion === activeRegion) continue
    if (featureContainsPoint(feature, lng, lat)) return feature
  }
  return null
}

function hasRenderedMapPoints() {
  const source = Array.isArray(fastCanvasData) && fastCanvasData.length > 0
    ? fastCanvasData
    : (Array.isArray(fastCanvasBaseData) ? fastCanvasBaseData : [])
  return source.some((pt) => pt && !pt.hidden)
}

function countyRegionHasRenderedSpeciesPoints(countyRegion) {
  const region = String(countyRegion || '').toUpperCase()
  if (!isCountyRegionCode(region)) return false
  const source = Array.isArray(fastCanvasData) && fastCanvasData.length > 0
    ? fastCanvasData
    : (Array.isArray(fastCanvasBaseData) ? fastCanvasBaseData : [])
  return source.some((pt) => {
    if (!pt || pt.hidden) return false
    const pointRegion = String(pt?.item?.subnational2Code || pt?.item?.subnational1Code || '').toUpperCase()
    return pointRegion === region
  })
}

function shouldBlockPolygonSwitch(targetCountyRegion = '') {
  const activeRegion = String(currentCountyRegion || '').toUpperCase().trim()
  const targetRegion = String(targetCountyRegion || '').toUpperCase()
  return Boolean(activeRegion && targetRegion && targetRegion === activeRegion)
}

function syncPolygonBlockDebugBadge() {
  if (!polygonBlockBadge) return
  polygonBlockBadge.textContent = 'Off'
  polygonBlockBadge.className = 'badge warn'
}

function isTapInsideActiveCounty(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return false
  const features = Array.isArray(latestCountyContextGeojson?.features) ? latestCountyContextGeojson.features : []
  for (const feature of features) {
    if (!feature?.properties?.isActiveCounty) continue
    if (featureContainsPoint(feature, Number(lng), Number(lat))) return true
  }
  return false
}

function zoomToActiveCounty(geojson, countyRegion = null, options = {}) {
  if (!map || !geojson || !Array.isArray(geojson.features)) return false
  const targetRegion = String(countyRegion || '').toUpperCase()
  const activeFeatures = geojson.features.filter((feature) => {
    if (feature?.properties?.isActiveCounty) return true
    if (!targetRegion) return false
    return String(feature?.properties?.countyRegion || '').toUpperCase() === targetRegion
  })
  if (!activeFeatures.length) return false
  try {
    const bounds = L.geoJSON({ type: 'FeatureCollection', features: activeFeatures }).getBounds()
    if (bounds.isValid()) {
      const maxZoom = Number.isFinite(Number(options?.maxZoom)) ? Number(options.maxZoom) : 11
      map.fitBounds(bounds, { padding: [22, 22], maxZoom, animate: true })
      return true
    }
  } catch {
    // ignore zoom errors
  }
  return false
}

function zoomToStateBounds(geojson, stateRegion) {
  if (!map || !geojson || !Array.isArray(geojson.features)) return false
  const normalizedState = String(stateRegion || '').toUpperCase()
  if (!isStateRegionCode(normalizedState)) return false
  const prefix = `${normalizedState}-`
  const stateFeatures = geojson.features.filter((feature) => {
    const countyRegion = String(feature?.properties?.countyRegion || feature?.properties?.subnational2Code || feature?.properties?.subnational1Code || '').toUpperCase()
    // Match exact (for a LEAF province feature: NL-GR === NL-GR) or prefix (US-CA counties start NL-GR-...)
    return countyRegion === normalizedState || countyRegion.startsWith(prefix)
  })
  if (!stateFeatures.length) return false
  try {
    const bounds = L.geoJSON({ type: 'FeatureCollection', features: stateFeatures }).getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 7, animate: true })
      return true
    }
  } catch {
    // ignore zoom errors
  }
  return false
}

function scheduleCountyPickerRender() {
  if (countyPickerRenderTimer) return
  countyPickerRenderTimer = window.setTimeout(() => {
    countyPickerRenderTimer = null
    renderCountyPickerOptions()
    updateCountyDots()
  }, 50)
}

function getCountySummary(region, isActive) {
  if (isActive) {
    const activeSummary = summarizeCountyObservations(currentRawObservations)
    if (region) countySummaryByRegion.set(region, activeSummary)
    return activeSummary
  }
  if (region && countySummaryByRegion.has(region)) {
    return countySummaryByRegion.get(region) || null
  }
  const cached = loadNotablesCache(region)
  if (!cached || !Array.isArray(cached.observations) || cached.observations.length === 0) return null
  const summary = summarizeCountyObservations(filterObservationsToCountyRegion(cached.observations, region))
  if (region) countySummaryByRegion.set(region, summary)
  return summary
}

function getStateSummary(stateRegion, isActive) {
  const region = String(stateRegion || '').toUpperCase()
  if (!isStateRegionCode(region)) return null

  const activeRegion = String(currentCountyRegion || '').toUpperCase()
  const canDeriveFromCurrent = activeRegion === region || activeRegion === US_REGION_CODE

  if (canDeriveFromCurrent && Array.isArray(currentRawObservations) && currentRawObservations.length) {
    const scoped = activeRegion === US_REGION_CODE
      ? filterObservationsToStateRegion(currentRawObservations, region)
      : currentRawObservations
    const summary = summarizeCountyObservations(scoped)
    stateSummaryByRegion.set(region, summary)
    return summary
  }

  if (region && stateSummaryByRegion.has(region)) {
    return stateSummaryByRegion.get(region) || null
  }

  const cached = loadNotablesCache(region)
  if (!cached || !Array.isArray(cached.observations) || cached.observations.length === 0) return null
  const summary = summarizeCountyObservations(cached.observations)
  stateSummaryByRegion.set(region, summary)
  return summary
}

function renderCountyPickerOptions() {
  if (!countyPickerList) return
  countyPickerList.innerHTML = countyPickerOptions
    .map((opt, index) => {
      const activeClass = opt.isActive ? ' is-active' : ''
      const summary = getCountySummary(opt.countyRegion, opt.isActive)
      const pillsHtml = formatCountySummaryPills(summary, { includeTotal: false })
      return `<button type="button" class="county-option${activeClass}" data-index="${index}" role="option" aria-selected="${opt.isActive ? 'true' : 'false'}"><span class="county-option-name">${escapeHtml(opt.countyName)}</span><span class="county-option-meta county-option-meta-pills">${pillsHtml}</span></button>`
    })
    .join('')
}

// ABA code →0 default; used as data-aba attribute on dot elements (CSS handles colours)
const DOT_ABA_VALID = new Set([1, 2, 3, 4, 5])

function clearStateMarkers() {
  if (stateMarkerLayerRef) stateMarkerLayerRef.clearLayers()
}

function renderStateMarkersOnMap(observations) {
  if (!map) return
  initializeMap()
  if (!stateMarkerLayerRef) {
    stateMarkerLayerRef = L.layerGroup({ pane: 'countyDotPane' }).addTo(map)
  }
  stateMarkerLayerRef.clearLayers()
  if (!Array.isArray(observations) || observations.length === 0) return

  // Count unique species×county per state, ABA≥3 only
  const stateBuckets = new Map() // stateCode → { count, maxAba }
  const seen = new Map()         // stateCode → Set(key)
  for (const item of observations) {
    const stateCode = String(item?.subnational1Code || '').toUpperCase()
    if (!stateCode) continue
    const code = getAbaCodeNumber(item)
    if (!Number.isFinite(code) || code < 3) continue
    const species = String(item?.comName || '')
    const countyRegion = String(item?.subnational2Code || '').toUpperCase()
    const key = `${species}\u001f${countyRegion}`
    if (!seen.has(stateCode)) seen.set(stateCode, new Set())
    if (seen.get(stateCode).has(key)) continue
    seen.get(stateCode).add(key)
    const b = stateBuckets.get(stateCode) || { count: 0, maxAba: 0 }
    b.count += 1
    if (code > b.maxAba) b.maxAba = code
    stateBuckets.set(stateCode, b)
  }

  for (const [stateCode, { count, maxAba }] of stateBuckets.entries()) {
    let center = null

    // Prefer geometry-derived centres from currently loaded features.
    const geoFeatures = Array.isArray(latestCountyContextGeojson?.features) ? latestCountyContextGeojson.features : []
    const stateFeatures = geoFeatures.filter((f) => {
      const featureState = String(f?.properties?.subnational1Code || '').toUpperCase()
      const featureCounty = String(f?.properties?.countyRegion || f?.properties?.subnational2Code || '').toUpperCase()
      return featureState === stateCode || featureCounty.startsWith(`${stateCode}-`)
    })
    if (stateFeatures.length > 0) {
      let latSum = 0
      let lngSum = 0
      let n = 0
      for (const feature of stateFeatures) {
        const c = getFeatureCenter(feature)
        if (!c) continue
        latSum += c.lat
        lngSum += c.lng
        n += 1
      }
      if (n > 0) center = { lat: latSum / n, lng: lngSum / n }
    }

    // Fallback to data-driven center from loaded observations.
    if (!center) {
      let latSum = 0
      let lngSum = 0
      let n = 0
      for (const item of observations) {
        const itemState = String(item?.subnational1Code || '').toUpperCase()
        if (itemState !== stateCode) continue
        const lat = Number(item?.lat)
        const lng = Number(item?.lng)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
        latSum += lat
        lngSum += lng
        n += 1
      }
      if (n > 0) center = { lat: latSum / n, lng: lngSum / n }
    }

    // Final fallback: static precomputed centers.
    if (!center) center = STATE_CENTERS.get(stateCode)
    if (!center) continue
    const abbrev = getStateAbbrevByRegion(stateCode)
    const dotAba = DOT_ABA_VALID.has(maxAba) ? maxAba : 0
    const html = `<div class="state-cluster-marker"><span class="scm-abbrev">${abbrev}</span><span class="scm-count" data-aba="${dotAba}">${count}</span></div>`
    const marker = L.marker([center.lat, center.lng], {
      pane: 'countyDotPane',
      icon: L.divIcon({ className: 'state-cluster-icon', html, iconSize: [52, 36], iconAnchor: [26, 18] }),
      interactive: true,
    })
    marker.on('click', (e) => {
      if (e?.originalEvent) { L.DomEvent.stopPropagation(e.originalEvent); L.DomEvent.preventDefault(e.originalEvent) }
      void activateStateByRegion(stateCode)
    })
    stateMarkerLayerRef.addLayer(marker)
  }
}

function updateCountyDots() {
  if (!map || !countyPickerOptions.length) return
  const showCountyNames = map.getZoom() > 10

  // Build a polygon-centroid lookup from the current county GeoJSON so dots are
  // placed at the geographic centre of each county rather than at a random
  // observation location inside it.
  const polygonCentroidByRegion = new Map()
  const geoFeatures = Array.isArray(latestCountyContextGeojson?.features) ? latestCountyContextGeojson.features : []
  for (const feat of geoFeatures) {
    const region = String(feat?.properties?.countyRegion || feat?.properties?.subnational2Code || feat?.properties?.subnational1Code || '').toUpperCase()
    if (!region) continue
    if (polygonCentroidByRegion.has(region)) continue
    const center = getFeatureCenter(feat)
    if (center) polygonCentroidByRegion.set(region, center)
  }

  const activeRegion = String(currentCountyRegion || '').toUpperCase()
  const activeCountyCode = String(currentActiveCountyCode || '').toUpperCase()
  const isStateMode = isStateRegionCode(activeRegion) && !isCountyRegionCode(activeCountyCode)
  const stateFiltered = (isStateMode && lastFilteredRegion === activeRegion && Array.isArray(lastFilteredObservations)) ? lastFilteredObservations : null

  const countsByCountyRegion = stateFiltered ? new Map() : null
  const maxAbaByCountyRegion = stateFiltered ? new Map() : null
  if (stateFiltered) {
    // In state mode, county dots should reflect unique species×location combinations
    // (not raw observations and not just species×county grouped rows).
    const seenKeysByCounty = new Map() // countyRegion -> Set(key)
    for (const item of stateFiltered) {
      const countyRegion = String(item?.subnational2Code || '').toUpperCase()
      if (!isCountyRegionCode(countyRegion)) continue

      const lat = Number(item?.lat)
      const lng = Number(item?.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

      const species = String(item?.comName || 'Unknown species')
      const locId = item?.locId ? String(item.locId) : ''
      const locKey = locId || `${lat.toFixed(4)}|${lng.toFixed(4)}`
      const key = `${species}|${locKey}`

      if (!seenKeysByCounty.has(countyRegion)) seenKeysByCounty.set(countyRegion, new Set())
      seenKeysByCounty.get(countyRegion).add(key)

      const code = getAbaCodeNumber(item)
      if (Number.isFinite(code)) {
        const existing = maxAbaByCountyRegion.get(countyRegion) || 0
        if (code > existing) maxAbaByCountyRegion.set(countyRegion, code)
      }
    }

    for (const [countyRegion, keySet] of seenKeysByCounty.entries()) {
      countsByCountyRegion.set(countyRegion, keySet.size)
    }
  }

  const selected = selectedAbaCodes instanceof Set ? selectedAbaCodes : new Set()
  const hasAbaSelection = selected.size > 0
  const selectedCodes = hasAbaSelection
    ? Array.from(selected).map((v) => Math.round(Number(v))).filter((c) => Number.isFinite(c) && c >= 1 && c <= 5)
    : []
  const highestSelectedCode = selectedCodes.length ? Math.max(...selectedCodes) : null

  if (!countyDotLayerRef) {
    countyDotLayerRef = L.layerGroup({ pane: 'countyDotPane' }).addTo(map)
  }
  countyDotLayerRef.clearLayers()

  for (const opt of countyPickerOptions) {
    if (opt.isActive) continue
    if (!opt.countyRegion || !Number.isFinite(opt.lat) || !Number.isFinite(opt.lng)) continue

    const countyRegion = String(opt.countyRegion || '').toUpperCase()
    const summary = stateFiltered ? null : getCountySummary(countyRegion, false)
    const rarityCount = (() => {
      if (stateFiltered) {
        return countsByCountyRegion.get(countyRegion) || 0
      }
      if (!summary) return 0
      if (!hasAbaSelection || selectedCodes.length === 0) return summary?.rarityCount || 0
      return selectedCodes.reduce((sum, code) => sum + (summary.abaCounts.get(code) || 0), 0)
    })()

    // When ABA selection is active, only show counties that have matches.
    let dotAba = 0
    if (hasAbaSelection && selectedCodes.length > 0) {
      if (rarityCount <= 0) continue
      dotAba = DOT_ABA_VALID.has(highestSelectedCode) ? highestSelectedCode : 0
    } else if (stateFiltered) {
      if (rarityCount <= 0) continue
      const maxCode = maxAbaByCountyRegion.get(countyRegion) || null
      dotAba = DOT_ABA_VALID.has(maxCode) ? maxCode : 0
    } else if (summary) {
      // Pick highest ABA code present
      for (let code = 5; code >= 1; code--) {
        if ((summary.abaCounts.get(code) || 0) > 0) { dotAba = code; break }
      }
    }

    const countText = rarityCount > 0 ? String(rarityCount) : ''
    const markerHtml = `
      <div class="county-dot-marker">
        ${showCountyNames ? `<span class="cdot-name">${escapeHtml(opt.countyName)}</span>` : ''}
        <span class="cdot-circle" data-aba="${dotAba}">${countText}</span>
      </div>
    `

    const iconSize = showCountyNames ? [88, 38] : [28, 28]
    const iconAnchor = showCountyNames ? [44, 22] : [14, 14]

    // Prefer polygon centroid for dot placement; fall back to observation lat/lng.
    const centroid = polygonCentroidByRegion.get(countyRegion)
    const dotLat = centroid ? centroid.lat : opt.lat
    const dotLng = centroid ? centroid.lng : opt.lng

    const dot = L.marker([dotLat, dotLng], {
      pane: 'countyDotPane',
      icon: L.divIcon({
        className: 'county-dot-icon',
        html: markerHtml,
        iconSize,
        iconAnchor,
      }),
      interactive: true,
    })

    dot.on('click', (e) => {
      if (e?.originalEvent) {
        L.DomEvent.stopPropagation(e.originalEvent)
        L.DomEvent.preventDefault(e.originalEvent)
      }
      switchCountyFromMapTap(opt.countyRegion, opt.lat, opt.lng, opt.countyName, 'county-dot')
    })

    countyDotLayerRef.addLayer(dot)
  }
}

async function prefetchCountySummariesForPicker(options) {
  if (!Array.isArray(options) || options.length === 0) return
  if (!Number.isFinite(lastUserLat) || !Number.isFinite(lastUserLng)) return

  const token = ++countySummaryPrefetchToken
  const effectiveDaysBack = Math.max(1, Math.min(14, Number(filterDaysBack) || 7))
  const targets = options.filter((opt) => opt?.countyRegion && !opt.isActive)
  let pointer = 0
  const workers = Math.min(3, targets.length)

  const runWorker = async () => {
    while (pointer < targets.length) {
      if (token !== countySummaryPrefetchToken) return
      const currentIndex = pointer
      pointer += 1
      const region = targets[currentIndex]?.countyRegion
      if (!region || countySummaryByRegion.has(region) || countySummaryInFlight.has(region)) continue

      countySummaryInFlight.add(region)
      try {
        const cached = loadNotablesCache(region)
        if (Array.isArray(cached?.observations) && cached.observations.length > 0) {
          const scoped = filterObservationsToCountyRegion(cached.observations, region)
          countySummaryByRegion.set(region, summarizeCountyObservations(scoped))
          scheduleCountyPickerRender()
          // Also pre-warm hi-res boundary for this neighbor
          void fetchCountyHiRes(region).catch(() => {})
          continue
        }

        const result = await fetchCountyNotablesWithRetry(lastUserLat, lastUserLng, effectiveDaysBack, region, 1)
        if (!Array.isArray(result?.observations) || result.observations.length === 0) continue
        saveNotablesCache(region, result, { daysBack: effectiveDaysBack })
        const scoped = filterObservationsToCountyRegion(result.observations, region)
        countySummaryByRegion.set(region, summarizeCountyObservations(scoped))
        scheduleCountyPickerRender()
        // Pre-warm hi-res boundary for this neighbor
        void fetchCountyHiRes(region).catch(() => {})
      } catch {
        // ignore county summary prefetch failures
      } finally {
        countySummaryInFlight.delete(region)
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => runWorker()))
}

function refreshCountyPickerSummaries() {
  if (!latestCountyContextGeojson) return
  updateCountyPickerFromGeojson(latestCountyContextGeojson)
}

function renderInfoTechMetrics() {
  if (!infoTechMetrics) return
  const activeRegion = String(currentActiveCountyCode || currentCountyRegion || '').toUpperCase() || '—'
  const abaSel = (selectedAbaCodes instanceof Set && selectedAbaCodes.size > 0)
    ? Array.from(selectedAbaCodes).sort((a, b) => a - b).join(',')
    : 'all'
  const reviewSel = (selectedReviewFilters instanceof Set && selectedReviewFilters.size > 0)
    ? Array.from(selectedReviewFilters).sort().join(',')
    : 'all'
  const activeFiltersSummary = `days=${filterDaysBack} species=${selectedSpecies || 'all'} abaMin=${filterAbaMin} aba=${abaSel} review=${reviewSel}`
  const lines = [
    `Build: ${BUILD_TAG}`,
    `API: ${apiStatus?.textContent || '—'}`,
    `API Detail: ${apiDetail?.textContent || '—'}`,
    `Location: ${locationStatus?.textContent || '—'}`,
    `Location Detail: ${locationDetail?.textContent || '—'}`,
    `County: ${currentCountyName || '—'}${currentCountyRegion ? ` (${currentCountyRegion})` : ''}`,
    `Active County + Filters: ${activeRegion} | ${activeFiltersSummary}`,
    'Load Times:',
    perfDetail?.textContent ? perfDetail.textContent : '—',
  ]
  infoTechMetrics.textContent = lines.join('\n')
}

function saveTapDebugEnabled(value) {
  try {
    localStorage.setItem(TAP_DEBUG_STORAGE_KEY, value ? '1' : '0')
  } catch {
    // ignore storage failures
  }
}

function loadTapDebugEnabled() {
  try {
    return localStorage.getItem(TAP_DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function saveLocationBootPreference(value) {
  const normalized = value === 'granted' || value === 'declined' ? value : 'unknown'
  try {
    localStorage.setItem(LOCATION_BOOT_PREF_STORAGE_KEY, normalized)
  } catch {
    // ignore storage failures
  }
}

function loadLocationBootPreference() {
  try {
    const raw = String(localStorage.getItem(LOCATION_BOOT_PREF_STORAGE_KEY) || '').trim().toLowerCase()
    return raw === 'granted' || raw === 'declined' ? raw : 'unknown'
  } catch {
    return 'unknown'
  }
}

function clearLocationBootPreference() {
  try {
    localStorage.removeItem(LOCATION_BOOT_PREF_STORAGE_KEY)
  } catch {
    // ignore storage failures
  }
}

function renderTapDebugLog() {
  if (!tapDebugLog) return
  if (!tapDebugEnabled) {
    tapDebugLog.textContent = 'Debug disabled'
    return
  }
  tapDebugLog.textContent = tapDebugEvents.length ? tapDebugEvents.join('\n') : 'No tap events yet'
}

function formatTapDebugCoord(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(5) : '—'
}

function logTapResolution(stage, payload = {}) {
  if (!tapDebugEnabled) return
  const source = String(payload.source || 'map')
  const region = String(payload.region || '').toUpperCase() || '—'
  const name = String(payload.name || '') || '—'
  const lat = formatTapDebugCoord(payload.lat)
  const lng = formatTapDebugCoord(payload.lng)
  const detail = String(payload.detail || '')
  const stamp = new Date().toISOString().slice(11, 19)
  const line = `[${stamp}] ${stage} src=${source} region=${region} name=${name} lat=${lat} lng=${lng}${detail ? ` detail=${detail}` : ''}`
  tapDebugEvents.unshift(line)
  if (tapDebugEvents.length > TAP_DEBUG_MAX_ENTRIES) {
    tapDebugEvents.length = TAP_DEBUG_MAX_ENTRIES
  }
  renderTapDebugLog()
}

function updateRuntimeLog() {
  renderInfoTechMetrics()
  try {
    localStorage.setItem('mrm_runtime_log', JSON.stringify({
      timestamp: new Date().toISOString(),
      buildTag: BUILD_TAG,
      apiStatus: apiStatus?.textContent || '',
      apiDetail: apiDetail?.textContent || '',
      locationStatus: locationStatus?.textContent || '',
      locationDetail: locationDetail?.textContent || '',
      county: currentCountyName || '',
      countyRegion: currentCountyRegion || '',
      filters: {
        daysBack: filterDaysBack,
        abaMin: filterAbaMin,
        species: selectedSpecies,
      },
      perf: perfDetail?.textContent || '',
    }))
  } catch {
    // ignore storage failures
  }
}

function refreshHeaderCountyOptions() {
  if (!headerCountySelect) return
  const options = countyPickerOptions
  const activeRegion = String(currentCountyRegion || '').toUpperCase()
  const isStateOrUsContext = activeRegion === US_REGION_CODE || isStateRegionCode(activeRegion)
  const activeState = stateRegionFromAnyRegion(activeRegion) || activeRegion
  const isNlContext = LEAF_SUBNATIONAL1_COUNTRIES.has(String(activeState || '').split('-')[0])
  const selectPrompt = isNlContext ? 'Select Province' : 'Select County'
  if (!Array.isArray(options) || options.length === 0) {
    headerCountySelect.innerHTML = ''
    const placeholderOption = document.createElement('option')
    placeholderOption.value = ''
    placeholderOption.textContent = isStateOrUsContext ? selectPrompt : 'Loading…'
    headerCountySelect.appendChild(placeholderOption)
    syncLocationBarState()
    return
  }
  headerCountySelect.innerHTML = ''

  // In state/US context there is no active county; keep header as "Select County".
  if (isStateOrUsContext) {
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = selectPrompt
    headerCountySelect.appendChild(placeholder)
  }

  options.forEach((opt, index) => {
    const optionEl = document.createElement('option')
    optionEl.value = String(opt.countyRegion || '')
    const name = String(opt.countyName || 'Unknown county')
    const region = String(opt.countyRegion || '').toUpperCase()
    const isActive = region === activeRegion || Boolean(opt.isActive)
    if (isActive) {
      // Keep the header "pill" clean: no ABA counts on the selected value.
      optionEl.textContent = name
    } else {
      const summary = getCountySummary(region, false)
      const parts = []
      if (summary && summary.abaCounts instanceof Map) {
        for (let code = 5; code >= 1; code -= 1) {
          const count = summary.abaCounts.get(code) || 0
          if (count > 0) parts.push(`${code}:${count}`)
        }
      }
      const meta = summary ? ` · ${summary.rarityCount}${parts.length ? ` · ${parts.join(' ')}` : ''}` : ''
      optionEl.textContent = `${name}${meta}`
    }
    optionEl.dataset.index = String(index)
    headerCountySelect.appendChild(optionEl)
  })
  const selectedIndex = options.findIndex((opt) => String(opt.countyRegion || '').toUpperCase() === activeRegion)
  if (selectedIndex >= 0) {
    headerCountySelect.selectedIndex = isStateOrUsContext ? (1 + selectedIndex) : selectedIndex
  } else {
    headerCountySelect.selectedIndex = 0
  }

  syncLocationBarState()
}

function refreshHeaderStateOptions() {
  if (!headerStateSelect || !headerStateBtn) return
  const activeState = stateRegionFromAnyRegion(currentCountyRegion) || 'NL'
  const usEntry = { code: US_REGION_CODE, name: 'United States \u2014 All' }
  const options = [usEntry, ...ALL_REGIONS]

  headerStateSelect.innerHTML = options
    .map((state) => {
      const selected = String(state.code).toUpperCase() === String(activeState).toUpperCase()
      return `<option value="${escapeHtml(state.code)}" ${selected ? 'selected' : ''}>${escapeHtml(state.name)}</option>`
    })
    .join('')
  const stateObj = options.find((s) => s.code === activeState)
  headerStateBtn.title = stateObj ? stateObj.name : 'Choose state'
  refreshLocationBar()
}

function closeStatePicker() {
  if (!statePicker) return
  statePicker.setAttribute('hidden', 'hidden')
}

function toggleStatePicker() {
  if (!statePicker || !statePickerList) return
  closeCountyPicker()
  closeAbaCodePicker()
  if (statePicker.hasAttribute('hidden')) statePicker.removeAttribute('hidden')
  else statePicker.setAttribute('hidden', 'hidden')
}

function renderStatePickerOptions() {
  if (!statePickerList) return
  const activeState = stateRegionFromAnyRegion(currentCountyRegion) || 'NL'

  const makeBtn = (state) => {
    const abbrev = getStateAbbrevByRegion(state.code)
    const isActive = String(state.code).toUpperCase() === String(activeState).toUpperCase()
    const summary = state.code === US_REGION_CODE ? null : getStateSummary(state.code, isActive)
    const pillsHtml = formatCountySummaryPills(summary, { includeTotal: false, includeNoCode: true })
    const label = state.code === US_REGION_CODE ? state.name : `${abbrev} · ${state.name}`
    return `<button type="button" class="county-option${isActive ? ' is-active' : ''}" data-code="${escapeHtml(state.code)}" role="option" aria-selected="${isActive ? 'true' : 'false'}"><span class="county-option-name">${escapeHtml(label)}</span><span class="county-option-meta county-option-meta-pills">${pillsHtml}</span></button>`
  }

  const nlRegions = ALL_REGIONS.filter((s) => LEAF_SUBNATIONAL1_COUNTRIES.has(s.code.split('-')[0]))
  const usRegions = ALL_REGIONS.filter((s) => s.code.startsWith('US-'))
  const usEntry = { code: US_REGION_CODE, name: 'United States — All' }

  statePickerList.innerHTML =
    '<div class="state-picker-section-header">&#x1F1F3;&#x1F1F1; Netherlands</div>' +
    nlRegions.map(makeBtn).join('') +
    '<div class="state-picker-section-header">&#x1F1FA;&#x1F1F8; United States</div>' +
    [usEntry, ...usRegions].map(makeBtn).join('')
}

async function activateStateByRegion(stateRegion, { preservePending = false } = {}) {
  if (!preservePending) clearPendingLocationSelection()
  const normalized = String(stateRegion || '').toUpperCase()
  if (normalized === US_REGION_CODE) {
    // US-wide mode: default to ABA 3/4/5 only
    resetFiltersForCountySwitch()
    filterAbaMin = 3
    selectedAbaCodes = new Set([3, 4, 5])
    updateFilterUi()
    refreshHeaderStateOptions()
    renderStatePickerOptions()
    await loadNationalNotables(US_REGION_CODE, 3)
    refreshHeaderStateOptions()
    renderStatePickerOptions()
    syncLocationBarState()
    return
  }
  if (!isStateRegionCode(normalized)) return
  resetFiltersForCountySwitch()
  if (normalized.startsWith('US-')) {
    filterAbaMin = 1
    selectedAbaCodes = new Set([3, 4, 5])
    updateFilterUi()
  }
  refreshHeaderStateOptions()
  renderStatePickerOptions()
  await loadStateNotables(normalized)
  refreshHeaderStateOptions()
  renderStatePickerOptions()
  refreshHeaderCountyOptions()
  syncLocationBarState()
}

async function switchToCountyOption(option) {
  if (!option) return
  const optionRegion = String(option.countyRegion || '').toUpperCase()
  const activeRegion = String(currentCountyRegion || '').toUpperCase()
  if (optionRegion && optionRegion === activeRegion) return
  return loadNeighborCounty(option.lat, option.lng, option.countyRegion, option.countyName)
}

function resetFiltersForCountySwitch() {
  selectedSpecies = null
  mapPointSpeciesFilter = new Set()
  selectedReviewFilters = new Set()
  selectedAbaCodes = new Set()
  filterAbaMin = 1
  if (!preservePinnedSpeciesOnce) {
    pinnedSpecies = null
  }
  preservePinnedSpeciesOnce = false
  updateFilterUi()
  syncFilterPillUi()
}

function switchCountyFromMapTap(countyRegion, lat = null, lng = null, countyName = '', source = 'map') {
  logTapResolution('tap-enter', {
    source,
    region: countyRegion,
    name: countyName,
    lat,
    lng,
  })

  let region = String(countyRegion || '').toUpperCase() || null
  const tapLat = Number(lat)
  const tapLng = Number(lng)

  if (!region && countyName) {
    const nameNeedle = normalizeCountyName(countyName)
    const namedOption = countyPickerOptions.find((opt) => normalizeCountyName(opt.countyName) === nameNeedle)
      || countyPickerOptions.find((opt) => {
        const optionName = normalizeCountyName(opt.countyName)
        return optionName.includes(nameNeedle) || nameNeedle.includes(optionName)
      })
      || null
    region = String(namedOption?.countyRegion || '').toUpperCase() || null
    logTapResolution('tap-name-match', {
      source,
      region,
      name: countyName,
      lat: tapLat,
      lng: tapLng,
      detail: namedOption ? 'matched picker option' : 'no picker name match',
    })
  }

  if (!region && Number.isFinite(tapLat) && Number.isFinite(tapLng)) {
    const neighborAtPoint = findNeighborCountyFeatureAtLatLng(tapLat, tapLng)
    region = String(
      neighborAtPoint?.properties?.countyRegion
      || neighborAtPoint?.properties?.subnational2Code
      || neighborAtPoint?.properties?.subnational1Code
      || ''
    ).toUpperCase() || null
    if (!countyName) {
      countyName = neighborAtPoint?.properties?.countyName || neighborAtPoint?.properties?.NAME || neighborAtPoint?.properties?.name || ''
    }
    logTapResolution('tap-point-match', {
      source,
      region,
      name: countyName,
      lat: tapLat,
      lng: tapLng,
      detail: neighborAtPoint ? 'matched neighbor geometry' : 'no neighbor geometry match',
    })
  }

  if (!region) {
    logTapResolution('tap-unresolved', {
      source,
      name: countyName,
      lat: tapLat,
      lng: tapLng,
      detail: 'activating by null region fallback',
    })
    activateCountyByRegion(null, lat, lng, countyName)
    return
  }

  const activeRegion = String(currentCountyRegion || '').toUpperCase()
  if (region === activeRegion) return

  const option = countyPickerOptions.find((opt) => String(opt.countyRegion || '').toUpperCase() === region) || null
  const optionLat = Number(option?.lat)
  const optionLng = Number(option?.lng)
  const resolvedLat = Number.isFinite(optionLat) ? optionLat : (Number.isFinite(tapLat) ? tapLat : null)
  const resolvedLng = Number.isFinite(optionLng) ? optionLng : (Number.isFinite(tapLng) ? tapLng : null)
  const resolvedName = countyName || option?.countyName || ''
  logTapResolution('tap-resolved', {
    source,
    region,
    name: resolvedName,
    lat: resolvedLat,
    lng: resolvedLng,
    detail: option ? 'using picker option center' : 'using tap coordinates',
  })
  // Route through the same activation path as the dropdown so the header county
  // UI stays in sync.
  explodeClustersOnNextCountySwitch = true
  activateCountyByRegion(region, resolvedLat, resolvedLng, resolvedName)
}

function activateCountyByRegion(countyRegion, lat = null, lng = null, countyName = '') {
  const region = String(countyRegion || '').toUpperCase()
  let option = null

  if (region) {
    option = countyPickerOptions.find((opt) => String(opt.countyRegion || '').toUpperCase() === region) || null
  }

  if (!option && countyName) {
    const nameNeedle = normalizeCountyName(countyName)
    option = countyPickerOptions.find((opt) => normalizeCountyName(opt.countyName) === nameNeedle) || null
    if (!option && nameNeedle) {
      option = countyPickerOptions.find((opt) => normalizeCountyName(opt.countyName).includes(nameNeedle) || nameNeedle.includes(normalizeCountyName(opt.countyName))) || null
    }
  }

  if (!option) {
    option = {
      countyRegion: region || null,
      countyName: countyName || '',
      lat,
      lng,
      isActive: false,
    }
  }

  return activateCountyFromOption(option)
}

async function activateCountyFromOption(option, { preservePending = false } = {}) {
  if (!option) return
  if (!preservePending) clearPendingLocationSelection()
  const region = String(option.countyRegion || '').toUpperCase()
  if (!region) {
    if (Number.isFinite(Number(option.lat)) && Number.isFinite(Number(option.lng))) {
      resetFiltersForCountySwitch()
      return loadNeighborCounty(Number(option.lat), Number(option.lng), null, option.countyName || '')
    }
    return
  }

  if (headerCountySelect) {
    const headerIndex = countyPickerOptions.findIndex((opt) => String(opt.countyRegion || '').toUpperCase() === region)
    if (headerIndex >= 0) {
      const activeRegion = String(currentCountyRegion || '').toUpperCase()
      const hasPlaceholder = activeRegion === US_REGION_CODE || isStateRegionCode(activeRegion)
      headerCountySelect.selectedIndex = hasPlaceholder ? (1 + headerIndex) : headerIndex
    }
  }

  if (isCountyRegionCode(region)) {
    activeSortCountyRegion = region
  }

  // Keep state pill in sync when drilling into a county.
  refreshHeaderStateOptions()
  renderStatePickerOptions()

  const resolvedOption = countyPickerOptions.find((opt) => String(opt.countyRegion || '').toUpperCase() === region) || option

  resetFiltersForCountySwitch()
  syncLocationBarState()
  return switchToCountyOption(resolvedOption)
}

function refreshSearchRegionOptions() {
  if (!searchRegionSelect) return
  const currentRegion = String(currentCountyRegion || '').toUpperCase()
  const currentIsUs = currentRegion === US_REGION_CODE
  const stateFromCurrent = /^US-[A-Z]{2}$/.test(currentRegion)
    ? currentRegion
    : stateRegionFromCountyRegion(currentRegion)
  const existing = String(searchRegionSelect.value || '').toUpperCase()
  let selectedState = ''
  if (currentIsUs) {
    selectedState = US_REGION_CODE
  } else if (ALL_REGIONS.some((s) => s.code === stateFromCurrent)) {
    selectedState = stateFromCurrent
  } else if (existing === US_REGION_CODE || ALL_REGIONS.some((s) => s.code === existing)) {
    selectedState = existing
  }

  searchRegionSelect.innerHTML = [
    '<option value="">Select region…</option>',
    `<option value="${US_REGION_CODE}" ${selectedState === US_REGION_CODE ? 'selected' : ''}>United States</option>`,
    ...ALL_REGIONS.map((state) => {
      const selected = selectedState && selectedState === state.code
      return `<option value="${escapeHtml(state.code)}" ${selected ? 'selected' : ''}>${escapeHtml(state.name)}</option>`
    }),
  ].join('')
}

function refreshSearchSpeciesOptions(source) {
  if (!searchSpeciesSelect) return
  const speciesSet = new Set()
  ;(Array.isArray(source) ? source : []).forEach((item) => {
    const name = String(item?.comName || '').trim()
    if (name) speciesSet.add(name)
  })
  const species = Array.from(speciesSet).sort((a, b) => a.localeCompare(b))
  const optionsHtml = ['<option value="">All species</option>']
  species.forEach((name) => {
    const isSelected = selectedSpecies === name
    optionsHtml.push(`<option value="${escapeHtml(name)}" ${isSelected ? 'selected' : ''}>${escapeHtml(name)}</option>`)
  })
  searchSpeciesSelect.innerHTML = optionsHtml.join('')
}

function buildStateCountyEntries(source, stateRegion = '') {
  const normalizedState = isStateRegionCode(String(stateRegion || '').toUpperCase())
    ? String(stateRegion || '').toUpperCase()
    : ''
  const buckets = new Map()

  const isLeaf = LEAF_SUBNATIONAL1_COUNTRIES.has(normalizedState)

  ;(Array.isArray(source) ? source : []).forEach((item) => {
    const itemState = String(item?.subnational1Code || '').toUpperCase()
    // For LEAF countries (NL), province IS the county — match on subnational1Code
    if (isLeaf) {
      if (normalizedState && !itemState.startsWith(normalizedState + '-') && itemState !== normalizedState) return
      const countyRegion = itemState
      if (!countyRegion) return
      if (!buckets.has(countyRegion)) buckets.set(countyRegion, [])
      buckets.get(countyRegion).push(item)
    } else {
      if (normalizedState && itemState !== normalizedState) return
      const countyRegion = String(item?.subnational2Code || '').toUpperCase()
      if (!/^US-[A-Z]{2}-\d{3}$/.test(countyRegion)) return
      if (!buckets.has(countyRegion)) buckets.set(countyRegion, [])
      buckets.get(countyRegion).push(item)
    }
  })

  const entries = Array.from(buckets.entries()).map(([countyRegion, items]) => {
    const first = items[0] || {}
    // For LEAF countries, province name lives in subnational1Name or the region code
    const countyName = isLeaf
      ? String(first?.subnational1Name || first?.countyName || countyRegion)
      : String(first?.subnational2Name || countyRegion)
    const latItem = items.find((entry) => Number.isFinite(Number(entry?.lat)) && Number.isFinite(Number(entry?.lng))) || first
    const lat = Number(latItem?.lat)
    const lng = Number(latItem?.lng)
    const summary = summarizeCountyObservations(items)
    return {
      countyRegion,
      countyName,
      count: summary.rarityCount,
      summary,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    }
  })

  if (isLeaf && normalizedState) {
    const existing = new Set(entries.map((entry) => String(entry.countyRegion || '').toUpperCase()))
    const featureCenterByRegion = new Map()
    const features = Array.isArray(latestCountyContextGeojson?.features) ? latestCountyContextGeojson.features : []
    for (const feature of features) {
      const region = String(feature?.properties?.countyRegion || feature?.properties?.subnational1Code || feature?.properties?.subnational2Code || '').toUpperCase()
      if (!region || featureCenterByRegion.has(region)) continue
      const center = getFeatureCenter(feature)
      if (center) featureCenterByRegion.set(region, center)
    }

    const allLeafRegions = ALL_REGIONS
      .filter((region) => String(region?.code || '').toUpperCase().startsWith(`${normalizedState}-`))

    for (const region of allLeafRegions) {
      const provinceCode = String(region?.code || '').toUpperCase()
      if (!provinceCode || existing.has(provinceCode)) continue
      const center = featureCenterByRegion.get(provinceCode) || null
      entries.push({
        countyRegion: provinceCode,
        countyName: String(region?.name || provinceCode),
        count: 0,
        summary: summarizeCountyObservations([]),
        lat: center?.lat ?? null,
        lng: center?.lng ?? null,
      })
    }
  }

  entries.sort((a, b) => a.countyName.localeCompare(b.countyName))
  return entries
}

function applySearchCountyEntries(entries) {
  if (!searchCountySelect) return
  const list = Array.isArray(entries) ? entries : []
  const activeRegion = String(currentCountyRegion || '').toUpperCase()
  const activeState = stateRegionFromAnyRegion(activeRegion) || activeRegion
  const isNlContext = LEAF_SUBNATIONAL1_COUNTRIES.has(String(activeState || '').split('-')[0])
  const allLabel = isNlContext ? 'All provinces' : 'All counties'
  const existing = String(searchCountySelect.value || '').toUpperCase()
  const currentCounty = /^US-[A-Z]{2}-\d{3}$/.test(String(currentCountyRegion || '').toUpperCase())
    ? String(currentCountyRegion || '').toUpperCase()
    : ''
  const selectedCounty = list.some((entry) => entry.countyRegion === existing)
    ? existing
    : (list.some((entry) => entry.countyRegion === currentCounty) ? currentCounty : '')

  searchCountySelect.innerHTML = [
    `<option value="">${escapeHtml(allLabel)}</option>`,
    ...list.map((entry) => {
      const selected = selectedCounty && selectedCounty === entry.countyRegion
      const label = entry.countyRegion
        ? `${entry.countyName} (${String(entry.countyRegion).toUpperCase()})`
        : entry.countyName
      return `<option value="${escapeHtml(entry.countyRegion)}" ${selected ? 'selected' : ''}>${escapeHtml(label)}</option>`
    }),
  ].join('')
  searchCountySelect.disabled = false
}

function setSearchCountyLoading(message = 'Loading counties…') {
  if (!searchCountySelect) return
  searchCountySelect.disabled = true
  searchCountySelect.innerHTML = `<option value="">${escapeHtml(message)}</option>`
}

function setSearchCountyIdleMessage(message = 'Select state first') {
  if (!searchCountySelect) return
  searchCountySelect.disabled = true
  searchCountySelect.innerHTML = `<option value="">${escapeHtml(message)}</option>`
}

function applyCountyPickerOptionsFromStateEntries(entries, activeCountyRegion = '', anchor = null) {
  const list = Array.isArray(entries) ? entries : []
  const activeRegion = String(activeCountyRegion || '').toUpperCase()
  if (!list.length) {
    countyPickerOptions = []
    renderCountyPickerOptions()
    refreshHeaderCountyOptions()
    if (countyDotLayerRef) countyDotLayerRef.clearLayers()
    return
  }

  const anchorLat = Number(anchor?.lat)
  const anchorLng = Number(anchor?.lng)
  const hasAnchorPoint = Number.isFinite(anchorLat) && Number.isFinite(anchorLng)

  const activeEntry = list.find((entry) => entry.countyRegion === activeRegion) || null
  countyPickerOptions = list
    .map((entry) => {
      if (entry?.summary) countySummaryByRegion.set(entry.countyRegion, entry.summary)
      const hasDistanceAnchor = activeEntry && Number.isFinite(activeEntry.lat) && Number.isFinite(activeEntry.lng) && Number.isFinite(entry.lat) && Number.isFinite(entry.lng)
      return {
        countyName: entry.countyName,
        countyRegion: entry.countyRegion,
        lat: entry.lat,
        lng: entry.lng,
        isActive: Boolean(activeRegion && entry.countyRegion === activeRegion),
        distanceKm: hasDistanceAnchor
          ? distanceKm(activeEntry.lat, activeEntry.lng, entry.lat, entry.lng)
          : (hasAnchorPoint && Number.isFinite(entry.lat) && Number.isFinite(entry.lng)
            ? distanceKm(anchorLat, anchorLng, entry.lat, entry.lng)
            : Infinity),
      }
    })
    .sort((a, b) => {
      if (a.isActive && !b.isActive) return -1
      if (!a.isActive && b.isActive) return 1
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm
      return a.countyName.localeCompare(b.countyName)
    })

  renderCountyPickerOptions()
  refreshHeaderCountyOptions()
}

async function ensureSearchCountyOptionsForState(stateRegion) {
  const requestId = ++latestSearchCountyOptionsRequestId
  const normalizedState = String(stateRegion || '').toUpperCase()
  if (normalizedState === US_REGION_CODE) {
    if (requestId !== latestSearchCountyOptionsRequestId) return
    setSearchCountyIdleMessage('County select disabled for US')
    return
  }
  if (!isStateRegionCode(normalizedState)) {
    if (requestId !== latestSearchCountyOptionsRequestId) return
    setSearchCountyIdleMessage('Select state first')
    return
  }

  const fromCurrent = buildStateCountyEntries(currentRawObservations, normalizedState)
  // If we're currently in a single-county view, currentRawObservations only contains one county,
  // so we still want a full county list for the search menu.
  if (fromCurrent.length > 1) {
    if (requestId !== latestSearchCountyOptionsRequestId) return
    stateCountyOptionsCache.set(normalizedState, fromCurrent)
    applySearchCountyEntries(fromCurrent)
    return
  }

  const cached = stateCountyOptionsCache.get(normalizedState)
  if (Array.isArray(cached) && cached.length > 0) {
    if (requestId !== latestSearchCountyOptionsRequestId) return
    applySearchCountyEntries(cached)
    return
  }

  const stateCached = loadNotablesCache(normalizedState)
  if (Array.isArray(stateCached?.observations) && stateCached.observations.length > 0) {
    if (requestId !== latestSearchCountyOptionsRequestId) return
    const entries = buildStateCountyEntries(stateCached.observations, normalizedState)
    stateCountyOptionsCache.set(normalizedState, entries)
    applySearchCountyEntries(entries)
    return
  }

  setSearchCountyLoading('Loading counties…')
  try {
    const effectiveDaysBack = Math.max(1, Math.min(14, Number(filterDaysBack) || 7))
    const observations = await fetchRegionRarities(normalizedState, effectiveDaysBack, 30000)
    if (requestId !== latestSearchCountyOptionsRequestId) return
    const entries = buildStateCountyEntries(observations, normalizedState)
    stateCountyOptionsCache.set(normalizedState, entries)
    if (entries.length > 0) {
      applySearchCountyEntries(entries)
    } else {
      setSearchCountyIdleMessage('No counties found')
    }
  } catch {
    if (requestId !== latestSearchCountyOptionsRequestId) return
    setSearchCountyIdleMessage('County load failed')
  }
}

function refreshSearchCountyOptions(source, stateRegion = '') {
  const normalizedState = isStateRegionCode(String(stateRegion || '').toUpperCase())
    ? String(stateRegion || '').toUpperCase()
    : (stateRegionFromAnyRegion(currentCountyRegion || '') || '')
  const entries = buildStateCountyEntries(source, normalizedState)
  if (isStateRegionCode(normalizedState) && entries.length) {
    stateCountyOptionsCache.set(normalizedState, entries)
  }
  applySearchCountyEntries(entries)
}

function activateCountyFromSearchSelection(countyRegion) {
  const targetRegion = String(countyRegion || '').toUpperCase()
  if (!/^US-[A-Z]{2}-\d{3}$/.test(targetRegion)) return
  const option = countyPickerOptions.find((opt) => String(opt.countyRegion || '').toUpperCase() === targetRegion)
  if (option) {
    activateCountyFromOption(option)
    return
  }

  const stateRegion = stateRegionFromCountyRegion(targetRegion)
  const cachedEntries = stateRegion ? stateCountyOptionsCache.get(stateRegion) : null
  if (Array.isArray(cachedEntries) && cachedEntries.length) {
    const cached = cachedEntries.find((entry) => String(entry?.countyRegion || '').toUpperCase() === targetRegion) || null
    if (cached) {
      activateCountyByRegion(
        targetRegion,
        Number.isFinite(cached.lat) ? cached.lat : null,
        Number.isFinite(cached.lng) ? cached.lng : null,
        cached.countyName || ''
      )
      return
    }
  }

  const sample = (Array.isArray(currentRawObservations) ? currentRawObservations : []).find(
    (item) => String(item?.subnational2Code || '').toUpperCase() === targetRegion
      && Number.isFinite(Number(item?.lat))
      && Number.isFinite(Number(item?.lng))
  )
  const countyName = sample?.subnational2Name || sample?.subnational2Code || ''
  const lat = Number(sample?.lat)
  const lng = Number(sample?.lng)
  activateCountyByRegion(
    targetRegion,
    Number.isFinite(lat) ? lat : null,
    Number.isFinite(lng) ? lng : null,
    countyName
  )
}

function updateCountyPickerFromGeojson(geojson) {
  if (!countyPickerList) return
  const features = Array.isArray(geojson?.features) ? geojson.features : []
  const options = features
    .map((feature) => {
      const center = getFeatureCenter(feature)
      const resolvedRegion = String(feature?.properties?.countyRegion || feature?.properties?.subnational2Code || feature?.properties?.subnational1Code || '').toUpperCase() || null
      return {
        countyName: feature?.properties?.countyName || feature?.properties?.NAME || feature?.properties?.name || 'Unknown county',
        countyRegion: resolvedRegion,
        isActive: Boolean(feature?.properties?.isActiveCounty),
        lat: center?.lat ?? null,
        lng: center?.lng ?? null,
        summary: getCountySummary(resolvedRegion, Boolean(feature?.properties?.isActiveCounty)),
      }
    })
    .filter((entry) => Boolean(entry && entry.countyRegion))

  const active = options.find((opt) => opt.isActive)
  countyPickerOptions = options
    .map((opt) => ({
      ...opt,
      distanceKm: (active
        && Number.isFinite(active.lat)
        && Number.isFinite(active.lng)
        && Number.isFinite(opt.lat)
        && Number.isFinite(opt.lng))
        ? distanceKm(active.lat, active.lng, opt.lat, opt.lng)
        : Infinity,
    }))
    .sort((a, b) => {
      if (a.isActive && !b.isActive) return -1
      if (!a.isActive && b.isActive) return 1
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm
      return a.countyName.localeCompare(b.countyName)
    })

  renderCountyPickerOptions()
  refreshHeaderCountyOptions()
  refreshHeaderStateOptions()
  renderStatePickerOptions()
  refreshSearchRegionOptions()
  prefetchCountySummariesForPicker(countyPickerOptions)
}

function setTableRenderStatus(message) {
  if (!tableRenderStatus) return
  tableRenderStatus.textContent = `render: ${message}`
}

function updateStatPills(total, confirmed, pending) {
  // Confirmed/pending pills removed; keep function as a harmless no-op.
}

function renderAbaStatPills(sorted) {
  if (!topAbaPills) return
  const isNlMode = isNlRarityPillMode()
  if (isNlMode) {
    let rCount = 0
    let nCount = 0
    sorted.forEach((item) => {
      const rarityCode = String(item?.nlRarityCode || '').trim().toUpperCase()
      if (rarityCode === 'R') rCount += 1
      else nCount += 1
    })

    const pillsHtml = [
      {
        code: 'R',
        count: rCount,
        badgeClass: 'aba-code-5',
        active: selectedReviewFilters instanceof Set && selectedReviewFilters.has('R'),
        title: 'Toggle NL review species filter',
      },
      {
        code: 'N',
        count: nCount,
        badgeClass: 'aba-code-unknown',
        active: selectedReviewFilters instanceof Set && selectedReviewFilters.has('N'),
        title: 'Toggle NL non-review species filter',
      },
    ]
      .map((pill) => `<button type="button" class="stat-aba-pill${pill.active ? ' is-active' : ''}" data-code="${pill.code}" aria-pressed="${pill.active ? 'true' : 'false'}" title="${pill.title}"><span class="stat-aba-pill-badge ${pill.badgeClass}"><span class="aba-pill-count">${pill.count}</span></span><span class="stat-aba-pill-code" aria-hidden="true">${pill.code}</span></button>`)
      .join('')

    const labelHtml = '<span class="aba-pill-label" aria-hidden="true">Review<br>code</span>'
    if (topAbaPills) topAbaPills.innerHTML = labelHtml + pillsHtml
    if (pickerAbaPills) pickerAbaPills.innerHTML = ''
    if (statePickerAbaPills) statePickerAbaPills.innerHTML = ''
    return
  }

  const counts = new Map()
  sorted.forEach((item) => {
    const code = Number.isFinite(item.abaCode) ? item.abaCode : 0
    counts.set(code, (counts.get(code) || 0) + 1)
  })

  const isUsMode = String(currentCountyRegion || '').toUpperCase() === US_REGION_CODE
  const lockedInUsMode = new Set([0, 1, 2])
  const orderedCodes = isUsMode ? [3, 4, 5] : [0, 1, 2, 3, 4, 5]
  const pillsHtml = orderedCodes
    .map((c) => {
      const count = counts.get(c) || 0
      const isActive = selectedAbaCodes instanceof Set && selectedAbaCodes.has(c)
      const isDisabled = isUsMode && lockedInUsMode.has(c)
      const label = c === 0 ? 'N' : String(c)
      const badgeClass = c === 0 ? 'aba-code-unknown' : `aba-code-${c}`
      return `<button type="button" class="stat-aba-pill${isActive ? ' is-active' : ''}${isDisabled ? ' is-locked' : ''}" data-code="${c}" ${isDisabled ? 'disabled aria-disabled="true"' : ''} aria-pressed="${isActive ? 'true' : 'false'}" title="Toggle ABA ${label} filter"><span class="stat-aba-pill-badge ${badgeClass}"><span class="aba-pill-count">${count}</span></span><span class="stat-aba-pill-code" aria-hidden="true">${label}</span></button>`
    })
    .join('')
  const labelHtml = '<span class="aba-pill-label" aria-hidden="true">ABA<br>code</span>'

  // Label only belongs in the bottom bar.
  if (topAbaPills) topAbaPills.innerHTML = labelHtml + pillsHtml
  if (pickerAbaPills) pickerAbaPills.innerHTML = ''
  if (statePickerAbaPills) statePickerAbaPills.innerHTML = ''
}

async function refreshCurrentRegionDataForDaysBack() {
  const activeRegion = String(currentCountyRegion || '').toUpperCase()
  if (!activeRegion) {
    applyActiveFiltersAndRender({ fitToObservations: true })
    return
  }

  if (activeRegion === US_REGION_CODE) {
    await loadNationalNotables(US_REGION_CODE, 3)
    return
  }

  if (isStateRegionCode(activeRegion)) {
    await loadStateNotables(activeRegion)
    return
  }

  if (isCountyRegionCode(activeRegion)) {
    const option = countyPickerOptions.find((opt) => String(opt?.countyRegion || '').toUpperCase() === activeRegion) || null
    const lat = Number(option?.lat)
    const lng = Number(option?.lng)
    const fallbackLat = Number.isFinite(lastCountyAnchorLat) ? lastCountyAnchorLat : (Number.isFinite(lastUserLat) ? lastUserLat : null)
    const fallbackLng = Number.isFinite(lastCountyAnchorLng) ? lastCountyAnchorLng : (Number.isFinite(lastUserLng) ? lastUserLng : null)
    await loadNeighborCounty(
      Number.isFinite(lat) ? lat : fallbackLat,
      Number.isFinite(lng) ? lng : fallbackLng,
      activeRegion,
      option?.countyName || currentCountyName || ''
    )
    return
  }

  applyActiveFiltersAndRender({ fitToObservations: true })
}

function setNotablesUnavailableState(metaMessage, rowMessage, statusMessage = 'notables-unavailable') {
  notableCount.className = 'badge warn'
  notableCount.textContent = '0'
  notableMeta.textContent = metaMessage
  updateStatPills('—', '—', '—')
  notableRows.innerHTML = `<tr><td colspan="8">${rowMessage}</td></tr>`
  setTableRenderStatus(statusMessage)
}

function supportsPermissionsApi() {
  return typeof navigator !== 'undefined' && 'permissions' in navigator && typeof navigator.permissions.query === 'function'
}

async function getGeolocationPermissionState() {
  if (!supportsPermissionsApi()) {
    return 'unknown'
  }

  try {
    const result = await navigator.permissions.query({ name: 'geolocation' })
    return result.state
  } catch {
    return 'unknown'
  }
}

function getCurrentPositionAsync(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options)
  })
}

function initializeMap() {
  if (map) {
    return
  }

  map = L.map('map', {
    preferCanvas: true,
    zoomControl: false,
    attributionControl: true,
    zoomSnap: 1,
    zoomDelta: 1,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    wheelDebounceTime: 45,
    wheelPxPerZoomLevel: 190,
  }).setView([52.3, 5.3], 7)
  mapPointRenderer = L.canvas({ padding: 0.5 })

  map.createPane('countyMaskPane')
  map.getPane('countyMaskPane').style.zIndex = '380'
  map.getPane('countyMaskPane').style.pointerEvents = 'none'
  map.createPane('countyNeighborPane')
  // Keep outlines above the mask (and above label tiles) for visibility.
  map.getPane('countyNeighborPane').style.zIndex = '417'
  map.getPane('countyNeighborPane').style.pointerEvents = 'auto'
  map.createPane('countyDotPane')
  map.getPane('countyDotPane').style.zIndex = '405'
  map.getPane('countyDotPane').style.pointerEvents = 'auto'
  map.createPane('activeCountyPane')
  map.getPane('activeCountyPane').style.zIndex = '418'
  map.createPane('countyNamePane')
  map.getPane('countyNamePane').style.zIndex = '416'
  map.getPane('countyNamePane').style.pointerEvents = 'none'
  map.createPane('labelsPane')
  map.getPane('labelsPane').style.zIndex = '415'
  map.getPane('labelsPane').style.pointerEvents = 'none'
  map.createPane('notablePane')
  map.getPane('notablePane').style.zIndex = '420'
  map.getPane('notablePane').style.pointerEvents = 'auto'
  map.createPane('userDotPane')
  map.getPane('userDotPane').style.zIndex = '430'

  osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    ...BASE_TILE_OPTIONS,
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  })

  placeNameLayer = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
    {
      ...BASE_TILE_OPTIONS,
      maxZoom: 19,
      subdomains: 'abcd',
      pane: 'labelsPane',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    }
  )

  satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      ...BASE_TILE_OPTIONS,
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DigitalGlobe, USDA FSA'
    }
  )

  satelliteLayer.addTo(map)
  placeNameLayer.addTo(map)
  // Warm street tiles once to reduce perceived loading on first toggle
  osmLayer.addTo(map)
  map.removeLayer(osmLayer)
  if (mapBasemapToggleBtn) {
    mapBasemapToggleBtn.title = 'Switch to Street map'
  }
  updateBasemapAuxLayers()

  // High-res county outline when zoomed in close; revert to lo-res when zoomed back out
  map.on('zoomend', () => {
    const z = map.getZoom()
    if (!currentCountyRegion) return
    updateCountyDots()
    if (z > 9 && isCountyRegionCode(currentCountyRegion)) {
      applyHiResCountyOutline(currentCountyRegion)
    } else if (latestCountyContextGeojson) {
      const overlayRegion = String(latestCountyContextGeojson?.activeCountyRegion || '').toUpperCase()
      const isStateOverlayMode = isStateRegionCode(overlayRegion)
      const activeFeatures = Array.isArray(latestCountyContextGeojson?.features)
        ? latestCountyContextGeojson.features.filter((f) => f?.properties?.isActiveCounty)
        : []

      if (countyOverlay) {
        countyOverlay.clearLayers()
        if (isStateOverlayMode && Array.isArray(latestCountyContextGeojson?.inverseMaskFeatures)) {
          countyOverlay.addData({ type: 'FeatureCollection', features: latestCountyContextGeojson.inverseMaskFeatures })
        } else {
          const maskFeatures = buildInverseMaskFeaturesFromActiveFeatures(activeFeatures)
          countyOverlay.addData({ type: 'FeatureCollection', features: maskFeatures.length ? maskFeatures : activeFeatures })
        }
      }

      if (activeOutlineLayerRef) {
        activeOutlineLayerRef.clearLayers()
        if (!isStateOverlayMode && activeFeatures.length) {
          activeOutlineLayerRef.addData({ type: 'FeatureCollection', features: activeFeatures })
        }
        updateCountyLineColors()
      }
    }
  })
}

function updateBasemapAuxLayers() {
  if (!map) return
  const mapEl = document.querySelector('#map')
  if (mapEl) {
    mapEl.classList.toggle('is-satellite', currentBasemap === 'satellite')
    mapEl.classList.toggle('is-osm', currentBasemap === 'osm')
  }
  if (!placeNameLayer) return
  if (currentBasemap === 'satellite') {
    if (!map.hasLayer(placeNameLayer)) placeNameLayer.addTo(map)
  } else if (map.hasLayer(placeNameLayer)) {
    map.removeLayer(placeNameLayer)
  }
}

function updateCountyLineColors() {
  const isSat = currentBasemap === 'satellite'
  const neighborStroke = isSat ? '#94a3b8' : '#64748b'
  const neighborFill  = isSat ? '#94a3b8' : '#94a3b8'
  const activeStroke  = isSat ? '#ffffff' : '#dc2626'
  const activeMaskFill = isSat ? '#94a3b8' : '#cbd5e1'
  const isCounty = isCountyRegionCode(currentCountyRegion)
  const z = map ? map.getZoom() : 0
  const hideNeighborVisuals = isCounty && z > 9
  if (neighborLayerRef) {
    neighborLayerRef.setStyle({
      // When zoomed in tightly on the active county, suppress neighbor fills for clarity,
      // but keep boundary strokes so county lines remain visible under the mask.
      color: neighborStroke,
      weight: 0.75,
      fillColor: neighborFill,
      fillOpacity: hideNeighborVisuals ? 0 : (isCounty ? 0.46 : 0),
    })
  }
  if (countyOverlay) {
    countyOverlay.setStyle({ color: 'transparent', weight: 0, fillColor: activeMaskFill, fillOpacity: 0.45, fillRule: 'evenodd' })
  }
  if (activeOutlineLayerRef) {
    activeOutlineLayerRef.setStyle({ color: activeStroke, weight: 1, fillOpacity: 0 })
  }
}

function setMode(mode) {
  const validModes = ['hybrid', 'list', 'map', 'species']
  currentMode = validModes.includes(mode) ? mode : 'hybrid'

  // data-mode on appShell drives CSS-level layout switching
  if (appShell) appShell.dataset.mode = currentMode

  // panelMap holds the table card; always active except in map-only mode
  const showTable = currentMode !== 'map'
  const showSpeciesLanguageToggle = currentMode === 'hybrid' || currentMode === 'list'
  if (panelMap) panelMap.classList.toggle('active', showTable)
  if (panelTable) panelTable.classList.toggle('active', false)
  if (speciesLangToggleBtn) speciesLangToggleBtn.toggleAttribute('hidden', !showSpeciesLanguageToggle)

  if (currentMode === 'map' || currentMode === 'hybrid') {
    initializeMap()
    window.setTimeout(() => map && map.invalidateSize(), 150)
  }

  // species mode: auto-open the species picker
  if (currentMode === 'species') {
    closeCountyPicker()
    if (speciesPicker) speciesPicker.removeAttribute('hidden')
  } else {
    closeSpeciesPicker()
  }

  syncSpeciesModeUi()
  refreshLocationBar()
}

async function triggerHardRefresh() {
  setMapLoading(true, 'Refreshing…')

  try {
    localStorage.removeItem('mrm_last_pos')
    clearLocationBootPreference()
    localStorage.removeItem(LAST_ACTIVE_CONTEXT_STORAGE_KEY)
    localStorage.removeItem(PENDING_LOCATION_STORAGE_KEY)
    localStorage.removeItem('mrm_runtime_log')
    const keysToRemove = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key) continue
      if (key.startsWith('notables:') || key.startsWith('county_context:')) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key))
  } catch {
    // ignore storage cleanup errors
  }

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  }

  if ('caches' in window) {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
  }

  const url = new URL(window.location.href)
  url.searchParams.set('refresh', String(Date.now()))
  url.searchParams.set('reset_default', '1')
  url.searchParams.set('force_location', '1')
  url.searchParams.delete('reset_nl')
  window.location.replace(url.toString())
}

function setMapFullscreen(open) {
  isMapFullscreen = open
  appShell.classList.toggle('map-fullscreen', open)
  mapFullscreenToggleBtn.setAttribute('aria-pressed', String(open))
  // Swap to compress icon when fullscreen
  const svg = mapFullscreenToggleBtn.querySelector('svg')
  if (svg) {
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '2')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.innerHTML = open
      ? '<polyline points="20 9 20 4 15 4"/><polyline points="4 15 4 20 9 20"/><line x1="20" y1="4" x2="13" y2="11"/><line x1="4" y1="20" x2="11" y2="13"/>'
      : '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>'  
  }
  window.setTimeout(() => {
    if (map) map.invalidateSize()
  }, 180)
}

function setStatusPopoverOpen(open) {
  if (!statusPopover) return
  statusPopover.classList.toggle('open', open)
  statusPopover.setAttribute('aria-hidden', String(!open))
}

async function checkApi() {
  apiStatus.className = 'badge warn'
  apiStatus.textContent = 'Checking...'
  apiDetail.textContent = `Endpoint: ${API_BASE_URL} · Build ${BUILD_TAG}`
  if (buildInfo) {
    buildInfo.textContent = `Build: ${BUILD_TAG}`
  }
  try {
    const data = await fetchWorkerHealth(getStoredEbirdApiKey())
    apiStatus.className = 'badge ok'
    apiStatus.textContent = 'Connected'
    apiDetail.textContent = `Endpoint: ${API_BASE_URL} · Regions loaded: ${Array.isArray(data) ? data.length : 0} · Build ${BUILD_TAG}`
  } catch (error) {
    apiStatus.className = 'badge warn'
    apiStatus.textContent = 'Unavailable'
    apiDetail.textContent = `Endpoint: ${API_BASE_URL} · ${error.message} · Build ${BUILD_TAG}`
    console.error(error)
  } finally {
    updateRuntimeLog()
  }
}

function normalizeEbirdApiKey(value) {
  const key = String(value || '').trim()
  // Reject blank values and anything containing HTML/shell-special characters
  // (guards against injection if the key is ever embedded in a string).
  // eBird API keys are alphanumeric, typically 16–40 characters.
  if (!key || key.length < 8 || key.length > 64 || /[<>"'`\s]/.test(key)) return ''
  return key
}

function getStoredEbirdApiKey() {
  const tryGet = (storage) => {
    try {
      const raw = storage?.getItem?.(EBIRD_API_KEY_STORAGE_KEY)
      const key = normalizeEbirdApiKey(raw)
      return key || null
    } catch {
      return null
    }
  }

  // Prefer localStorage so the key survives mobile tab suspends/reloads.
  const localKey = tryGet(localStorage)
  if (localKey) return localKey

  // Backward-compat: older builds stored this in sessionStorage only.
  const sessionKey = tryGet(sessionStorage)
  if (sessionKey) {
    try { localStorage?.setItem?.(EBIRD_API_KEY_STORAGE_KEY, sessionKey) } catch { /* ignore */ }
    return sessionKey
  }

  return null
}

function setStoredEbirdApiKey(value) {
  const key = normalizeEbirdApiKey(value)
  if (!key) return false
  let ok = false
  try { localStorage.setItem(EBIRD_API_KEY_STORAGE_KEY, key); ok = true } catch { /* ignore */ }
  try { sessionStorage.setItem(EBIRD_API_KEY_STORAGE_KEY, key); ok = true } catch { /* ignore */ }
  return ok
}

function maybeSeedEbirdApiKeyFromUrl() {
  // SECURITY NOTE: Passing API keys via URL parameters exposes them in server
  // access logs, browser history, and HTTP Referer headers of any linked
  // resources loaded before replaceState() runs.  Treat this as a convenience
  // for device-to-device transfer only — never share such URLs publicly.
  const url = new URL(window.location.href)
  const candidates = ['ebird_api_key', 'ebirdKey', 'api_key']
  let seeded = false
  for (const name of candidates) {
    const v = url.searchParams.get(name)
    if (!v) continue
    if (setStoredEbirdApiKey(v)) seeded = true
    url.searchParams.delete(name)
  }
  if (seeded) {
    window.history.replaceState({}, '', url.toString())
  }
  return seeded
}

function showApiKeyGate(message = '') {
  if (!apiKeyGate) return
  if (apiKeyError) apiKeyError.textContent = message
  setApiKeyInputVisibility(false)
  apiKeyGate.removeAttribute('hidden')
  window.setTimeout(() => {
    try { apiKeyInput?.focus() } catch { /* ignore */ }
  }, 50)
}

function hideApiKeyGate() {
  if (!apiKeyGate) return
  apiKeyGate.setAttribute('hidden', 'hidden')
  if (apiKeyError) apiKeyError.textContent = ''
}

async function testEbirdApiKey(candidateKey) {
  const key = normalizeEbirdApiKey(candidateKey)
  if (!key) return { ok: false, message: 'Paste your eBird API key to continue.' }
  const endpoint = `${API_BASE_URL}/api/aba_meta`
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 9000)
  try {
    const res = await fetch(endpoint, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'X-eBirdApiToken': key },
    })
    if (res.status === 401) {
      return { ok: false, message: 'Invalid API key (401). Re-check and try again.' }
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return { ok: false, message: `Key test failed (${res.status}). ${txt ? txt.slice(0, 80) : ''}`.trim() }
    }
    const data = await res.json().catch(() => null)
    const maxCode = Number(data?.maxCode)
    if (!Number.isFinite(maxCode) || maxCode < 1) {
      return { ok: false, message: 'Key test returned unexpected response. Try again.' }
    }
    return { ok: true, message: '' }
  } catch (e) {
    const isTimeout = e?.name === 'AbortError'
    return { ok: false, message: isTimeout ? 'Key test timed out. Try again.' : `Key test error: ${String(e?.message || e)}` }
  } finally {
    window.clearTimeout(timer)
  }
}

const EYE_ICON_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
`

const EYE_OFF_ICON_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 12s3.5-7 10-7c1.2 0 2.3.2 3.2.6"></path>
    <path d="M22 12s-3.5 7-10 7c-1.2 0-2.3-.2-3.2-.6"></path>
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path>
    <path d="M3 3l18 18"></path>
  </svg>
`

function setApiKeyInputVisibility(visible) {
  const show = Boolean(visible)
  if (apiKeyInput) apiKeyInput.type = show ? 'text' : 'password'
  if (apiKeyToggleBtn) {
    apiKeyToggleBtn.setAttribute('aria-pressed', show ? 'true' : 'false')
    apiKeyToggleBtn.setAttribute('aria-label', show ? 'Hide API key' : 'Show API key')
    apiKeyToggleBtn.title = show ? 'Hide API key' : 'Show API key'
    apiKeyToggleBtn.innerHTML = show ? EYE_OFF_ICON_SVG : EYE_ICON_SVG
  }
}

function shouldSendEbirdTokenHeader(urlString) {
  try {
    const base = new URL(API_BASE_URL, window.location.href)
    const resolved = new URL(urlString, window.location.href)
    if (resolved.origin !== base.origin) return false
    const basePath = String(base.pathname || '').replace(/\/$/, '')
    return resolved.pathname.startsWith(`${basePath}/api/`)
  } catch {
    return false
  }
}

function buildWorkerAuthHeaders(urlString) {
  const key = getStoredEbirdApiKey()
  if (!key) return {}
  if (!shouldSendEbirdTokenHeader(urlString)) return {}
  return { 'X-eBirdApiToken': key }
}

class AuthError extends Error {
  constructor(msg = 'API key required. Get a key from https://ebird.org/api/keygen and paste it here.') {
    super(msg)
    this.name = 'AuthError'
  }
}

async function fetchWithTimeout(url, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  const startMs = performance.now()
  try {
    const headers = buildWorkerAuthHeaders(url)
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal, headers })
    try {
      const isApi = String(url).includes('/api/')
      if (isApi) {
        const elapsed = Math.round(performance.now() - startMs)
        apiSessionStats.calls += 1
        apiSessionStats.totalMs += elapsed
        apiSessionStats.last = `${response.status} ${String(url).split('?')[0]} ${elapsed}ms`
      }
    } catch {
      // ignore metrics errors
    }
    if (response.status === 401) {
      const authError = new AuthError()
      showApiKeyGate(authError.message)
      throw authError
    }
    return response
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

async function fetchCountyOutline(latitude, longitude) {
  const endpoint = `${API_BASE_URL}/api/county_outline?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`
  const response = await fetchWithTimeout(endpoint, 20000)

  if (!response.ok) {
    throw new Error(`County outline request failed: ${response.status}`)
  }

  return response.json()
}

async function fetchCountyHiRes(countyRegion) {
  if (hiResCache.has(countyRegion)) return hiResCache.get(countyRegion)
  const endpoint = `${API_BASE_URL}/api/county_hires?countyRegion=${encodeURIComponent(countyRegion)}`
  const response = await fetchWithTimeout(endpoint, 15000)
  if (!response.ok) throw new Error(`County hi-res request failed: ${response.status}`)
  const data = await response.json()
  hiResCache.set(countyRegion, data)
  return data
}

// Apply hi-res outline if already zoomed in after county load
function maybeApplyHiResOnCountyLoad() {
  if (map && isCountyRegionCode(currentCountyRegion) && map.getZoom() > 9) {
    void applyHiResCountyOutline(currentCountyRegion)
  }
}

async function applyHiResCountyOutline(countyRegion) {
  if (!countyRegion || !activeOutlineLayerRef) return
  if (hiResSwapInProgress) return
  hiResSwapInProgress = true
  try {
    const hiGeo = await fetchCountyHiRes(countyRegion)
    if (!hiGeo?.features?.length) return
    // Only apply if the county is still the active one
    if (currentCountyRegion !== countyRegion) return
    if (countyOverlay) {
      countyOverlay.clearLayers()
      const maskFeatures = buildInverseMaskFeaturesFromActiveFeatures(hiGeo.features)
      countyOverlay.addData({ type: 'FeatureCollection', features: maskFeatures.length ? maskFeatures : hiGeo.features })
    }
    activeOutlineLayerRef.clearLayers()
    activeOutlineLayerRef.addData({ type: 'FeatureCollection', features: hiGeo.features })
    updateCountyLineColors()
  } catch (e) {
    console.warn('[hi-res] County hi-res fetch failed:', e)
  } finally {
    hiResSwapInProgress = false
  }
}

async function fetchCountyNotables(latitude, longitude, back = 3, countyRegion = null) {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    back: String(back),
  })
  if (countyRegion) {
    params.set('countyRegion', countyRegion)
  }
  const endpoint = `${API_BASE_URL}/api/county_notables?${params.toString()}`
  const response = await fetchWithTimeout(endpoint, COUNTY_NOTABLES_TIMEOUT_MS)
  if (!response.ok) {
    throw new Error(`County notable request failed: ${response.status}`)
  }
  return response.json()
}

async function fetchCountyNotablesWithRetry(latitude, longitude, back = 14, countyRegion = null, attempts = 1) {
  let lastError = null

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await fetchCountyNotables(latitude, longitude, back, countyRegion)
    } catch (error) {
      lastError = error
      const isLastAttempt = index === attempts - 1
      if (isLastAttempt) break
      await new Promise((resolve) => setTimeout(resolve, 300 * (index + 1)))
    }
  }

  throw lastError || new Error('County notable request failed')
}

async function prefetchStateRarities(stateRegion, daysBack = statePrefetchDaysBack) {
  const normalizedState = String(stateRegion || '').toUpperCase()
  if (!isStateRegionCode(normalizedState)) return
  const requestedDays = Math.max(1, Math.min(14, Number(daysBack) || DEFAULT_STATE_PREFETCH_DAYS_BACK))

  if (statePrefetchInFlight.has(normalizedState)) return
  const cached = loadNotablesCache(normalizedState)
  const cachedDays = getCacheDaysBack(cached)
  if (Array.isArray(cached?.observations) && cached.observations.length > 0 && Number.isFinite(cachedDays) && cachedDays >= requestedDays) {
    return
  }

  statePrefetchInFlight.add(normalizedState)
  try {
    const startMs = performance.now()
    const observations = await fetchRegionRarities(normalizedState, requestedDays, 45000)
    const elapsed = Math.round(performance.now() - startMs)
    if (!Array.isArray(observations) || observations.length === 0) return
    saveNotablesCache(normalizedState, { observations }, { daysBack: requestedDays })
    lastStatePrefetchStats = { state: normalizedState, daysBack: requestedDays, obsCount: observations.length, ms: elapsed }
    // Precompute county list for the search menu / picker.
    const entries = buildStateCountyEntries(observations, normalizedState)
    if (entries.length > 0) stateCountyOptionsCache.set(normalizedState, entries)
  } catch (e) {
    console.warn('[prefetch] state rarities failed:', normalizedState, e)
  } finally {
    statePrefetchInFlight.delete(normalizedState)
  }
}

async function fetchCountyContextWithCache(lat, lng) {
  const cached = loadCountyContextCache(lat, lng)
  if (cached) return cached
  const geojson = await fetchCountyOutline(lat, lng)
  saveCountyContextCache(lat, lng, geojson)
  return geojson
}

async function fetchStateCountyGeometry(stateRegion) {
  const normalizedState = String(stateRegion || '').toUpperCase()
  if (!isStateRegionCode(normalizedState)) return null
  // US states: "US-CA" → "CA.json";  LEAF countries: "NL" → "NL.json"
  // LEAF province: "NL-GR" → fetch "NL.json" and filter to that province
  const parts = normalizedState.split('-')
  const isLeafProvince = parts.length === 2 && LEAF_SUBNATIONAL1_COUNTRIES.has(parts[0])
  const fileCode = normalizedState.startsWith('US-') ? parts[1] : (isLeafProvince ? parts[0] : normalizedState)
  const endpoint = `./data/counties/${fileCode}.json`
  const response = await fetchWithTimeout(endpoint, 12000)
  if (!response.ok) {
    throw new Error(`State county geometry request failed: ${response.status}`)
  }
  const geojson = await response.json()
  // For a LEAF province (e.g. NL-GR), filter the parent country JSON to just that feature
  if (isLeafProvince && Array.isArray(geojson?.features)) {
    return {
      ...geojson,
      features: geojson.features.filter((f) =>
        String(f?.properties?.countyRegion || '').toUpperCase() === normalizedState
      ),
    }
  }
  return geojson
}

async function fetchRegionRarities(region, back = 7, timeoutMs = API_TIMEOUT_MS, options = {}) {
  const params = new URLSearchParams({
    region: String(region || ''),
    back: String(back),
  })
  const abaMin = Number(options?.abaMin)
  if (Number.isFinite(abaMin) && abaMin >= 1) {
    params.set('abaMin', String(Math.round(abaMin)))
  }
  const endpoint = `${API_BASE_URL}/api/rarities?${params.toString()}`
  let response
  try {
    response = await fetchWithTimeout(endpoint, timeoutMs)
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    throw new Error(`Network error fetching ${endpoint}: ${details}`)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Region rarities ${response.status}: ${body.slice(0, 120)}`)
  }
  const data = await response.json()
  // API may return plain array or { observations: [] }
  return Array.isArray(data) ? data : (Array.isArray(data?.observations) ? data.observations : [])
}

function buildStateMaskGeojson(stateRegion, sourceGeojson) {
  if (!sourceGeojson || !Array.isArray(sourceGeojson.features)) return null
  const normalizedState = String(stateRegion || '').toUpperCase()
  if (!isStateRegionCode(normalizedState)) return null

  const features = sourceGeojson.features.map((feature) => {
    const regionRaw = feature?.properties?.countyRegion || feature?.properties?.subnational2Code || feature?.properties?.subnational1Code || null
    const region = regionRaw ? String(regionRaw).toUpperCase() : null
    return {
      ...feature,
      properties: {
        ...(feature?.properties || {}),
        countyRegion: region,
        isActiveCounty: false,
      },
    }
  })

  const inverseMaskFeatures = buildInverseMaskFeaturesFromActiveFeatures(features)

  return {
    ...sourceGeojson,
    activeCountyRegion: normalizedState,
    activeLabel: getStateNameByRegion(normalizedState),
    inverseMaskFeatures,
    features,
  }
}

function setLocationUiChecking() {
  locationStatus.className = 'badge warn'
  locationStatus.textContent = 'Checking...'
  locationDetail.textContent = 'Requesting device location permission.'
}

function setLocationUiUnavailable(message) {
  locationStatus.className = 'badge warn'
  locationStatus.textContent = 'Unavailable'
  locationDetail.textContent = message
}

function setLocationUiBlocked() {
  locationStatus.className = 'badge warn'
  locationStatus.textContent = 'Blocked'
  locationDetail.textContent = 'Location permission is blocked. On iOS: Settings → Privacy & Security → Location Services → Safari Websites (or your Home Screen app) → While Using + Precise ON.'
}

function updateUserLocationOnMap(latitude, longitude, accuracyMeters) {
  initializeMap()
  const hasAccuracy = Number.isFinite(accuracyMeters) && accuracyMeters > 0
  const maxAccuracyCircleMeters = 3000
  const shouldRenderAccuracyCircle = hasAccuracy && accuracyMeters <= maxAccuracyCircleMeters
  const safeAccuracy = shouldRenderAccuracyCircle ? accuracyMeters : null

  if (!userDot) {
    userDot = L.circleMarker([latitude, longitude], {
      radius: 8,
      color: '#ffffff',
      weight: 1.4,
      fillColor: '#7c3aed',
      fillOpacity: 1,
      pane: 'userDotPane',
    }).addTo(map)
  } else {
    userDot.setLatLng([latitude, longitude])
  }

  if (!shouldRenderAccuracyCircle) {
    if (accuracyCircle) {
      accuracyCircle.remove()
      accuracyCircle = null
    }
  } else if (!accuracyCircle) {
    accuracyCircle = L.circle([latitude, longitude], {
      radius: safeAccuracy,
      color: '#009688',
      fillColor: '#009688',
      fillOpacity: 0.2,
      weight: 1.5
    }).addTo(map)
  } else {
    accuracyCircle.setLatLng([latitude, longitude])
    accuracyCircle.setRadius(safeAccuracy)
  }

  // Don't zoom here — fitBounds in renderNotablesOnMap controls the viewport
  markMapPartReady('location')
}

function drawCountyOverlay(geojson) {
  initializeMap()
  latestCountyContextGeojson = geojson
  updateCountyPickerFromGeojson(geojson)

  const allFeatures = Array.isArray(geojson?.features) ? geojson.features : []
  const activeOverlayRegion = String(geojson?.activeCountyRegion || currentCountyRegion || '').toUpperCase()
  const isStateOverlayMode = isStateRegionCode(activeOverlayRegion)
  const neighborFeatures = isStateOverlayMode
    ? allFeatures.filter((f) => {
      const region = String(
        f?.properties?.countyRegion
        || f?.properties?.subnational2Code
        || f?.properties?.subnational1Code
        || ''
      ).toUpperCase()
      return !activeOverlayRegion || region !== activeOverlayRegion
    })
    : allFeatures.filter((f) => !f?.properties?.isActiveCounty)
  const activeFeatures = isStateOverlayMode
    ? []
    : allFeatures.filter((f) => f?.properties?.isActiveCounty)
  const overlayFeatures = (isStateOverlayMode && Array.isArray(geojson?.inverseMaskFeatures))
    ? geojson.inverseMaskFeatures
    : (() => {
      const maskFeatures = buildInverseMaskFeaturesFromActiveFeatures(activeFeatures)
      return maskFeatures.length ? maskFeatures : activeFeatures
    })()

  const isSat = currentBasemap === 'satellite'
  const neighborStroke = isSat ? '#94a3b8' : '#64748b'
  const activeStroke = isSat ? '#ffffff' : '#dc2626'
  const hideNeighborVisuals = isCountyRegionCode(currentCountyRegion) && map && map.getZoom() > 9

  const flashNeighborLayer = (layer) => {
    if (!layer || typeof layer.setStyle !== 'function') return
    const nowSat = currentBasemap === 'satellite'
    const isCounty = isCountyRegionCode(currentCountyRegion)
    const baseStyle = hideNeighborVisuals
      ? { fillOpacity: 0, fillColor: '#94a3b8', color: nowSat ? '#94a3b8' : '#64748b', weight: 0.75 }
      : { fillOpacity: isCounty ? 0.46 : 0, fillColor: '#94a3b8', color: nowSat ? '#94a3b8' : '#64748b', weight: 0.75 }
    layer.setStyle({ fillOpacity: 0.72, fillColor: '#fde047', color: '#f59e0b', weight: 1.25 })
    if (layer._flashTimer) window.clearTimeout(layer._flashTimer)
    layer._flashTimer = window.setTimeout(() => {
      try {
        layer.setStyle(baseStyle)
      } catch {
        // ignore layer reset errors during rapid county switches
      }
      layer._flashTimer = null
    }, 220)
  }

  if (!neighborLayerRef) {
    neighborLayerRef = L.geoJSON(null, {
      pane: 'countyNeighborPane',
      style: hideNeighborVisuals
        ? { color: neighborStroke, weight: 0.75, fillColor: '#94a3b8', fillOpacity: 0 }
        : { color: neighborStroke, weight: 0.75, fillColor: '#94a3b8', fillOpacity: 0.46 },
      onEachFeature: (feature, layer) => {
        const region = String(
          feature?.properties?.countyRegion
          || feature?.properties?.subnational2Code
          || feature?.properties?.subnational1Code
          || ''
        ).toUpperCase() || null
        const name = feature?.properties?.countyName || feature?.properties?.NAME || feature?.properties?.name || ''
        layer.on({
          click: (e) => {
            if (mapMeasureMode && e?.latlng) {
              addMeasurePoint(e.latlng)
              if (e?.originalEvent) {
                L.DomEvent.stopPropagation(e.originalEvent)
                L.DomEvent.preventDefault(e.originalEvent)
              }
              return
            }
            const blockPolygonSwitch = shouldBlockPolygonSwitch(region)
            if (blockPolygonSwitch) {
              if (e?.originalEvent) {
                L.DomEvent.stopPropagation(e.originalEvent)
                L.DomEvent.preventDefault(e.originalEvent)
              }
              return
            }
            if (map && e?.latlng) {
              const cp = map.latLngToContainerPoint(e.latlng)
              if (handleMapPointTap(cp)) {
                if (e?.originalEvent) {
                  L.DomEvent.stopPropagation(e.originalEvent)
                  L.DomEvent.preventDefault(e.originalEvent)
                }
                return
              }
            }
            const tapLat = Number(e?.latlng?.lat)
            const tapLng = Number(e?.latlng?.lng)
            if (hasRenderedMapPoints() && isTapInsideActiveCounty(tapLat, tapLng)) {
              return
            }
            if (e?.originalEvent) {
              L.DomEvent.stopPropagation(e.originalEvent)
              L.DomEvent.preventDefault(e.originalEvent)
            }
            flashNeighborLayer(layer)
            switchCountyFromMapTap(
              region,
              Number.isFinite(tapLat) ? tapLat : null,
              Number.isFinite(tapLng) ? tapLng : null,
              name,
              'neighbor-polygon'
            )
          },
          mouseover: () => {
            if (hideNeighborVisuals) return
            const isCounty = isCountyRegionCode(currentCountyRegion)
            layer.setStyle({ fillOpacity: isCounty ? 0.56 : 0.2, fillColor: '#94a3b8', color: '#475569', weight: 1 })
          },
          mouseout: () => {
            if (hideNeighborVisuals) return
            const nowSat = currentBasemap === 'satellite'
            const isCounty = isCountyRegionCode(currentCountyRegion)
            layer.setStyle({ fillOpacity: isCounty ? 0.46 : 0, fillColor: '#94a3b8', color: nowSat ? '#94a3b8' : '#64748b', weight: 0.75 })
          },
        })
      },
    }).addTo(map)
  }

  if (!activeOutlineLayerRef) {
    activeOutlineLayerRef = L.geoJSON(null, {
      pane: 'activeCountyPane',
      style: { color: activeStroke, weight: 1, fillOpacity: 0, fillColor: 'transparent' },
    }).addTo(map)
  }

  if (!countyOverlay) {
    countyOverlay = L.geoJSON(null, {
      pane: 'countyMaskPane',
      style: { color: 'transparent', weight: 0, fillColor: '#94a3b8', fillOpacity: 0.45, fillRule: 'evenodd' },
      interactive: false,
    }).addTo(map)
  }

  if (!countyNameLayerRef) {
    countyNameLayerRef = L.layerGroup().addTo(map)
  }

  neighborLayerRef.clearLayers()
  countyOverlay.clearLayers()
  activeOutlineLayerRef.clearLayers()
  countyNameLayerRef.clearLayers()
  neighborLayerRef.addData({ type: 'FeatureCollection', features: neighborFeatures })
  countyOverlay.addData({ type: 'FeatureCollection', features: overlayFeatures })
  activeOutlineLayerRef.addData({ type: 'FeatureCollection', features: activeFeatures })

  updateCountyLineColors()

  updateCountyDots()

  // Set county label pill immediately when GeoJSON resolves — don't wait for caller chain
  const activeFeature = activeFeatures[0] || null
  const activeCountyRegion = String(activeFeature?.properties?.countyRegion || geojson?.activeCountyRegion || '').toUpperCase() || null
  const activeCountyName = geojson?.activeLabel
    || activeFeature?.properties?.countyName
    || activeFeature?.properties?.NAME
    || activeFeature?.properties?.name
    || null

  if (map && isCountyRegionCode(activeCountyRegion) && map.getZoom() > 9) {
    void applyHiResCountyOutline(activeCountyRegion)
  }

  markMapPartReady('activeCounty')
  markMapPartReady('stateMask')
}

function getDistanceAnchorPoint() {
  if (Number.isFinite(lastCountyAnchorLat) && Number.isFinite(lastCountyAnchorLng)) {
    return { lat: lastCountyAnchorLat, lng: lastCountyAnchorLng }
  }
  if (Number.isFinite(lastUserLat) && Number.isFinite(lastUserLng)) {
    return { lat: lastUserLat, lng: lastUserLng }
  }
  if (map) {
    const center = map.getCenter()
    if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
      return { lat: center.lat, lng: center.lng }
    }
  }
  return null
}

function computeClosestPointByGroup(observations, anchorLat, anchorLng) {
  const closest = new Map()
  const source = Array.isArray(observations) ? observations : []
  source.forEach((item) => {
    const lat = Number(item?.lat)
    const lng = Number(item?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    const key = getObservationGroupKey(item)
    const d = distanceKm(anchorLat, anchorLng, lat, lng)
    const prev = closest.get(key)
    if (!prev || d < prev.distanceKm) {
      closest.set(key, { distanceKm: d, lat, lng })
    }
  })
  return closest
}

function getDateBubbleClass(kind, firstDate, lastDate) {
  const lastOffset = dayOffsetFromToday(lastDate)
  if (lastOffset === 0) return 'date-bubble-red-new'       // last seen today
  if (lastOffset === 1) return 'date-bubble-green-dark'    // last seen yesterday
  if (lastOffset === 2) return 'date-bubble-green-light'   // last seen two days ago
  return 'date-bubble-neutral'                             // older or unknown
}

function renderDateBubble(label, bubbleClass) {
  const text = String(label || '').trim()
  if (!text) return ''
  const cls = bubbleClass || 'date-bubble-neutral'
  return `<span class="date-bubble ${cls}">${escapeHtml(text)}</span>`
}

function renderAbaCodeBadge(code) {
  const n = Number(code)
  if (!Number.isFinite(n) || n < 1 || n > 6) {
    return '<span class="aba-code-badge aba-code-unknown" title="ABA code unavailable">N</span>'
  }
  const safe = Math.round(n)
  return `<span class="aba-code-badge aba-code-${safe}" title="ABA code ${safe}">${safe}</span>`
}

function renderNlRarityCodeBadge(code) {
  const raw = String(code || '').trim().toUpperCase()
  if (!raw) {
    return ''
  }
  const safe = escapeHtml(raw)
  return `<span class="nl-rarity-badge" title="NL rarity code ${safe}">${safe}</span>`
}

function makeObsLocationKey(candidatePt) {
  if (!candidatePt) return ''
  const lat = Number(candidatePt?.lat)
  const lng = Number(candidatePt?.lng)
  const locId = candidatePt?.item?.locId ? String(candidatePt.item.locId) : ''
  if (candidatePt?.locKey) return String(candidatePt.locKey)
  if (locId) return locId
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat.toFixed(4)}|${lng.toFixed(4)}`
  return ''
}

function getNearbySpeciesObservations(pt, speciesName, radiusKm = 1) {
  const species = String(speciesName || '').trim()
  if (!pt || !species) return []
  const centerLat = Number(pt.lat)
  const centerLng = Number(pt.lng)
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return []

  const points = Array.isArray(speciesMarkers.get(species)) ? speciesMarkers.get(species) : []
  const dedup = new Set()
  const collected = []

  points.forEach((candidatePt) => {
    const lat = Number(candidatePt?.lat)
    const lng = Number(candidatePt?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    if (distanceKm(centerLat, centerLng, lat, lng) > radiusKm) return

    const locKey = makeObsLocationKey(candidatePt)
    const locObs = Array.isArray(lastPopupLocationIndexAllSpecies?.get?.(locKey))
      ? lastPopupLocationIndexAllSpecies.get(locKey)
      : []

    let addedAny = false
    locObs.forEach((entry) => {
      if (String(entry?.species || '').trim() !== species) return
      const dedupKey = `${species}|${String(entry?.subId || '')}|${String(entry?.obsDt || '')}|${locKey}`
      if (dedup.has(dedupKey)) return
      dedup.add(dedupKey)
      collected.push(entry)
      addedAny = true
    })

    if (!addedAny) {
      const item = candidatePt?.item || null
      if (!item) return
      if (String(item?.comName || '').trim() !== species) return
      const dedupKey = `${species}|${String(item?.subId || '')}|${String(item?.obsDt || '')}|${locKey}`
      if (dedup.has(dedupKey)) return
      dedup.add(dedupKey)
      collected.push({
        species,
        abaCode: getAbaCodeNumber(item),
        obsDt: item?.obsDt ? String(item.obsDt) : null,
        subId: item?.subId ? String(item.subId) : null,
      })
    }
  })

  return collected
}

function renderYoloCodeBadge(species, abaCode) {
  const yoloInfo = getYoloSpeciesInfo(species)
  const yCode = Number(yoloInfo?.yoloCode)
  if (!Number.isFinite(yCode)) {
    return '<span class="yolo-code-badge yolo-code-none" title="No Yolo County code"></span>'
  }
  const diverges = Number.isFinite(abaCode) && yCode > abaCode
  const noteSuffix = yoloInfo?.notes ? ` · ${escapeHtml(String(yoloInfo.notes))}` : ''
  const marker = diverges ? ' yolo-diverges' : ''
  return `<span class="yolo-code-badge yolo-code-${yCode}${marker}" title="Yolo County code ${yCode}${diverges ? ' (rarer locally)' : ''}${noteSuffix}">${yCode}</span>`
}

function statusCodeClassSuffix(code) {
  return String(code || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function renderSpeciesStatusBullets(species) {
  const info = getYoloSpeciesInfo(species)
  if (!info) return ''
  const uniqueCodes = Array.from(new Set([info.statusCode, info.avibaseStatusCode].filter(Boolean)))
  if (!uniqueCodes.length) return ''
  return uniqueCodes
    .map((code) => {
      const safeCode = escapeHtml(code)
      const cls = statusCodeClassSuffix(code)
      return `<span class="species-status-bullet status-code-${cls}" title="Reference status ${safeCode}">${safeCode}</span>`
    })
    .join('')
}

function renderStatusDot(isConfirmed) {
  const cls = isConfirmed ? 'status-dot-confirmed' : 'status-dot-pending'
  const title = isConfirmed ? 'Confirmed' : 'Pending'
  return `<span class="status-dot ${cls}" title="${title}"></span>`
}

function buildGroupedRowsFromObservations(observations) {
  const grouped = new Map()
  ;(Array.isArray(observations) ? observations : []).forEach((item) => {
    const species = item.comName || ''
    const state = getItemStateAbbrev(item)
    const county = getItemCountyName(item)
    const countyRegion = String(item?.subnational2Code || '').toUpperCase() || null
    const key = `${species}::${state}::${county}`

    // Some endpoints return raw observations (obsDt per row). Others may return
    // already-aggregated rows with dedicated first/last fields.
    const firstCandidate = parseFirstAvailableObsDate(
      item?.firstObsDt,
      item?.firstObsDate,
      item?.firstDt,
      item?.first,
      item?.obsDt
    )
    const lastCandidate = parseFirstAvailableObsDate(
      item?.lastObsDt,
      item?.lastObsDate,
      item?.lastDt,
      item?.last,
      item?.obsDt
    )

    const abaCode = getAbaCodeNumber(item)
    const scientificName = String(item?.sciName || item?.scientificName || getNlSpeciesReference(species)?.scientificName || '').trim()
    const lat = Number(item.lat)
    const lng = Number(item.lng)

    const explicitCount = Number(item?.count ?? item?.numObs ?? item?.numObservations)
    const increment = Number.isFinite(explicitCount) ? Math.max(1, Math.round(explicitCount)) : 1

    if (!grouped.has(key)) {
      grouped.set(key, {
        groupKey: key,
        species,
        state,
        county,
        countyRegion,
        count: 0,
        first: firstCandidate,
        last: lastCandidate,
        abaCode,
        scientificName,
        nlRarityCode: getNlRarityCodeForSpecies(species, scientificName),
        confirmedAny: isConfirmedObservation(item),
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        distanceKm: null,
      })
    }

    const entry = grouped.get(key)
    entry.count += increment
    entry.confirmedAny = entry.confirmedAny || isConfirmedObservation(item)
    if (abaCode !== null) {
      if (entry.abaCode === null || entry.abaCode === undefined || abaCode > entry.abaCode) {
        entry.abaCode = abaCode
      }
    }

    if (firstCandidate) {
      if (!entry.first || firstCandidate < entry.first) entry.first = firstCandidate
    }
    if (lastCandidate) {
      if (!entry.last || lastCandidate > entry.last) entry.last = lastCandidate
    }
    if (!entry.scientificName && scientificName) {
      entry.scientificName = scientificName
    }
    if (!entry.nlRarityCode) {
      entry.nlRarityCode = getNlRarityCodeForSpecies(species, entry.scientificName || scientificName)
    }
  })

  return grouped
}

function renderNotableTable(observations, countyName, regionCode, abaPillObservations = observations) {
  setTableRenderStatus('table-start')
  lastTableObservationSource = Array.isArray(observations) ? observations : []
  notableRows.innerHTML = ''
  const previousRegion = String(notableMeta?.dataset?.regionCode || '').toUpperCase()
  notableMeta.textContent = `${countyName || 'County'} · ${regionCode || ''}`.trim()
  notableMeta.dataset.regionCode = regionCode || ''

  const normalizedRegion = String(regionCode || '').toUpperCase()
  const isStateRegion = isStateRegionCode(normalizedRegion)
  const isUsRegion = normalizedRegion === US_REGION_CODE
  const tableEl = document.querySelector('.notable-table')
  if (tableEl) tableEl.classList.toggle('show-state-col', normalizedRegion.startsWith('US'))

  // For state selection, render the normal species table (same as county mode)
  // but sort by distance from the user's county (fallback: GPS / map center).
  const stateDistanceAnchor = isStateRegion ? getDistanceAnchorPoint() : null

  const abaPillGrouped = buildGroupedRowsFromObservations(abaPillObservations)

  if (!Array.isArray(observations) || observations.length === 0) {
    notableCount.className = 'badge ok'
    notableCount.textContent = '0'
    updateStatPills('0', '0', '0')
    renderAbaStatPills(Array.from(abaPillGrouped.values()))
    const isNlMode = isNlRarityPillMode(regionCode)
    const activeAba = (selectedAbaCodes instanceof Set && selectedAbaCodes.size > 0)
      ? Array.from(selectedAbaCodes)[0]
      : null
    const days = Math.max(1, Math.min(14, Number(filterDaysBack) || 7))
    const reviewOnly = selectedReviewFilters instanceof Set && selectedReviewFilters.size === 1 && selectedReviewFilters.has('R')
    const nonReviewOnly = selectedReviewFilters instanceof Set && selectedReviewFilters.size === 1 && selectedReviewFilters.has('N')
    const emptyMessage = isNlMode
      ? (reviewOnly
        ? `No records for review species in past ${days} days.`
        : nonReviewOnly
          ? `No records for non-review species in past ${days} days.`
          : isStateRegion
            ? 'No notable observations found for this state.'
            : 'No notable observations found for this county.')
      : (activeAba
        ? `No records for ABA ${activeAba} species in past ${days} days.`
        : isStateRegion
          ? 'No notable observations found for this state.'
          : 'No notable observations found for this county.')
    notableRows.innerHTML = `<tr><td colspan="8">${emptyMessage}</td></tr>`
    setTableRenderStatus('table-empty')
    return
  }

  // Group by species+county (matching desktop renderSightingsTable)
  const grouped = buildGroupedRowsFromObservations(observations)

  // Make distance-based sorting available in any view where we have an anchor.
  const distanceAnchor = getDistanceAnchorPoint()
  if (distanceAnchor && Number.isFinite(distanceAnchor.lat) && Number.isFinite(distanceAnchor.lng)) {
    const closestByKey = computeClosestPointByGroup(observations, distanceAnchor.lat, distanceAnchor.lng)
    grouped.forEach((row) => {
      const closest = closestByKey.get(row.groupKey)
      if (closest) {
        row.distanceKm = closest.distanceKm
        row.lat = closest.lat
        row.lng = closest.lng
      }
    })
  }

  // Default county-mode sort: ABA descending, then state/county/date.
  // State-mode sort: nearest first (distance), then ABA desc, then last desc.
  let sorted = Array.from(grouped.values())
  if (isStateRegion && stateDistanceAnchor) {
    sorted.forEach((row) => {
      if (!Number.isFinite(row.distanceKm)) row.distanceKm = Infinity
    })
    sorted = sorted
      .filter((row) => Number.isFinite(row.distanceKm))
      .sort((a, b) => {
        const aDist = Number.isFinite(a.distanceKm) ? a.distanceKm : Infinity
        const bDist = Number.isFinite(b.distanceKm) ? b.distanceKm : Infinity
        if (aDist !== bDist) return aDist - bDist
        const aCode = Number.isFinite(a.abaCode) ? a.abaCode : -1
        const bCode = Number.isFinite(b.abaCode) ? b.abaCode : -1
        if (aCode !== bCode) return bCode - aCode
        const aLast = a.last ? a.last.getTime() : 0
        const bLast = b.last ? b.last.getTime() : 0
        if (aLast !== bLast) return bLast - aLast
        return String(a.species || '').localeCompare(String(b.species || ''))
      })

    // Keep the current sort (no distance toggle UI).
    if (sortState?.col === 'distance') sortState = { col: 'code', dir: 'desc' }
    notableMeta.textContent = `${countyName || normalizedRegion} · ${normalizedRegion}`
  } else {
    sorted = sorted.sort((a, b) => {
      const aCode = Number.isFinite(a.abaCode) ? a.abaCode : -1
      const bCode = Number.isFinite(b.abaCode) ? b.abaCode : -1
      if (aCode !== bCode) return bCode - aCode
      const aState = String(a.state || '').toLowerCase()
      const bState = String(b.state || '').toLowerCase()
      if (aState !== bState) return aState.localeCompare(bState)
      const aCounty = String(a.county || '').toLowerCase()
      const bCounty = String(b.county || '').toLowerCase()
      if (aCounty !== bCounty) return aCounty.localeCompare(bCounty)
      return (b.last ? b.last.getTime() : 0) - (a.last ? a.last.getTime() : 0)
    })
  }

  notableCount.className = 'badge ok'
  notableCount.textContent = String(sorted.length)
  const confirmedCount = sorted.filter((r) => r.confirmedAny).length
  updateStatPills(sorted.length, confirmedCount, sorted.length - confirmedCount)
  renderAbaStatPills(Array.from(abaPillGrouped.values()))
  currentTableData = sorted
  applySortAndRender()
}

function buildStateCountySummaryRows(observations, stateRegion) {
  const normalizedState = String(stateRegion || '').toUpperCase()
  const isUS = normalizedState === US_REGION_CODE
  const source = Array.isArray(observations) ? observations : []
  const buckets = new Map()

  source.forEach((item) => {
    const itemState = String(item?.subnational1Code || '').toUpperCase()
    if (!isUS && isStateRegionCode(normalizedState) && itemState !== normalizedState) return

    // LEAF countries (e.g. NL): province IS the finest boundary → use subnational1Code
    const isLeaf = LEAF_SUBNATIONAL1_COUNTRIES.has(normalizedState)
    const regionKey = isUS ? itemState : isLeaf ? itemState : String(item?.subnational2Code || '').toUpperCase()
    if (!isUS && isLeaf && !regionKey.startsWith(normalizedState + '-')) return
    if (!isUS && !isLeaf && !/^US-[A-Z]{2}-\d{3}$/.test(regionKey)) return
    if (isUS && !/^US-[A-Z]{2}$/.test(regionKey)) return

    if (!buckets.has(regionKey)) {
      let regionName = regionKey
      if (isUS) {
        const stateObj = LOWER_48_STATES.find(s => s.code === regionKey)
        if (stateObj) regionName = stateObj.name
      } else {
        regionName = String(item?.subnational2Name || regionKey)
      }
      buckets.set(regionKey, {
        countyRegion: regionKey,
        countyName: regionName,
        observations: [],
      })
    }
    buckets.get(regionKey).observations.push(item)
  })

  const rows = Array.from(buckets.values()).map((bucket) => {
    const summary = summarizeCountyObservations(bucket.observations)
    const confirmedKeys = new Set()
    for (const item of bucket.observations) {
      const lat = Number(item?.lat)
      const lng = Number(item?.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const species = item?.comName || ''
      const state = String(item?.subnational1Code || '')
      const county = String(item?.subnational2Code || item?.subnational2Name || '')
      const locId = item?.locId ? String(item.locId) : ''
      const locKey = locId || `${lat.toFixed(4)}|${lng.toFixed(4)}`
      const key = `${species}::${state}::${county}::${locKey}`
      if (isConfirmedObservation(item)) confirmedKeys.add(key)
    }
    const confirmedCount = confirmedKeys.size
    const pendingCount = Math.max(0, summary.rarityCount - confirmedCount)
    const latestDate = bucket.observations.reduce((latest, item) => {
      const parsed = parseFirstAvailableObsDate(item?.lastObsDt, item?.lastObsDate, item?.lastDt, item?.last, item?.obsDt)
      if (!parsed) return latest
      if (!latest || parsed > latest) return parsed
      return latest
    }, null)
    const firstDate = bucket.observations.reduce((first, item) => {
      const parsed = parseFirstAvailableObsDate(item?.firstObsDt, item?.firstObsDate, item?.firstDt, item?.first, item?.obsDt)
      if (!parsed) return first
      if (!first || parsed < first) return parsed
      return first
    }, null)

    const pickerOption = countyPickerOptions.find((opt) => String(opt.countyRegion || '').toUpperCase() === bucket.countyRegion)
    const lat = Number(pickerOption?.lat)
    const lng = Number(pickerOption?.lng)

    return {
      countyRegion: bucket.countyRegion,
      countyName: bucket.countyName,
      summary,
      rarityCount: summary.rarityCount,
      confirmedCount,
      pendingCount,
      last: latestDate,
      first: firstDate,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      distanceKm: null,
    }
  })

  // If we're in a state (not US) view, sort counties by distance from the user's county (fallback: GPS).
  const anchorLat = Number.isFinite(lastCountyAnchorLat) ? lastCountyAnchorLat : (Number.isFinite(lastUserLat) ? lastUserLat : null)
  const anchorLng = Number.isFinite(lastCountyAnchorLng) ? lastCountyAnchorLng : (Number.isFinite(lastUserLng) ? lastUserLng : null)
  const hasAnchor = !isUS && Number.isFinite(anchorLat) && Number.isFinite(anchorLng)
  if (hasAnchor) {
    rows.forEach((row) => {
      if (Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
        row.distanceKm = distanceKm(anchorLat, anchorLng, row.lat, row.lng)
      } else {
        row.distanceKm = Infinity
      }
    })
    rows.sort((a, b) => {
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm
      if (b.rarityCount !== a.rarityCount) return b.rarityCount - a.rarityCount
      return a.countyName.localeCompare(b.countyName)
    })
  } else {
    rows.sort((a, b) => {
      if (b.rarityCount !== a.rarityCount) return b.rarityCount - a.rarityCount
      return a.countyName.localeCompare(b.countyName)
    })
  }

  return rows
}

function renderStateCountySummaryTable(observations, countyName, stateRegion, abaPillObservations = observations) {
  const stateRows = buildStateCountySummaryRows(observations, stateRegion)
  const isUS = String(stateRegion || '').toUpperCase() === US_REGION_CODE
  notableMeta.textContent = `${countyName || stateRegion} · ${isUS ? 'state summaries' : 'county summaries'}`
  notableMeta.dataset.regionCode = stateRegion || ''

  const abaPillGrouped = buildGroupedRowsFromObservations(abaPillObservations)
  renderAbaStatPills(Array.from(abaPillGrouped.values()))

  if (!stateRows.length) {
    notableCount.className = 'badge ok'
    notableCount.textContent = '0'
    updateStatPills('0', '0', '0')
    notableRows.innerHTML = `<tr><td colspan="8">No ${isUS ? 'state' : 'county'} summaries found for this region and filter set.</td></tr>`
    currentTableData = []
    setTableRenderStatus('state-summary-empty')
    return
  }

  const totalRarities = stateRows.reduce((sum, row) => sum + row.rarityCount, 0)
  const confirmedRarities = stateRows.reduce((sum, row) => sum + row.confirmedCount, 0)
  const pendingRarities = Math.max(0, totalRarities - confirmedRarities)

  notableCount.className = 'badge ok'
  notableCount.textContent = String(stateRows.length)
  updateStatPills(totalRarities, confirmedRarities, pendingRarities)

  const fragment = document.createDocumentFragment()
  stateRows.forEach((row) => {
    const lastBubble = renderDateBubble(formatShortDate(row.last), getDateBubbleClass('last', row.first, row.last))
    const isConfirmed = row.confirmedCount > 0
    const countPill = `<span class="count-pill ${isConfirmed ? 'count-pill-confirmed' : 'count-pill-pending'}" title="${isConfirmed ? 'Confirmed' : 'Pending'}">${row.rarityCount}</span>`
    const pinHtml = (row.lat != null && row.lng != null)
      ? `<button type="button" class="row-pin-btn" data-lat="${row.lat}" data-lng="${row.lng}" title="Open in Google Maps">📍</button>`
      : ''

    const tableRow = document.createElement('tr')
    tableRow.dataset.countyRegion = String(row.countyRegion || '').toUpperCase()
    tableRow.dataset.county = String(row.countyName || '')
    tableRow.innerHTML = `
      <td class="col-code"></td>
      <td><div class="species-cell"><button type="button" class="county-summary-btn" data-county-region="${escapeHtml(row.countyRegion)}">${escapeHtml(row.countyName)}</button><span class="county-option-meta">${escapeHtml(formatCountySummary(row.summary))}</span></div></td>
      <td class="col-county"></td>
      <td class="col-date col-last">${lastBubble}</td>
      <td class="col-reports">${countPill}</td>
      <td class="col-vis"></td>
      <td class="col-pin">${pinHtml}</td>
    `
    fragment.appendChild(tableRow)
  })

  notableRows.innerHTML = ''
  notableRows.appendChild(fragment)
  currentTableData = []
  setTableRenderStatus(`state-summary rows=${stateRows.length}`)
}

function applySortAndRender() {
  if (!currentTableData.length) return
  const { col, dir } = sortState

  const regionCode = document.querySelector('#notableMeta')?.dataset?.regionCode || ''
  const normalizedRegion = String(regionCode || '').toUpperCase()
  const isCountyView = isCountyRegionCode(normalizedRegion)
  const isYoloCountyView = isCountyView && normalizedRegion === YOLO_COUNTY_REGION
  const isLeafCountryView = LEAF_SUBNATIONAL1_COUNTRIES.has(normalizedRegion.split('-')[0])
  const isNlCountryView = normalizedRegion.split('-')[0] === 'NL'

  const getPreferredCode = (row) => {
    if (isNlCountryView) {
      return getNlRarityRank(row?.nlRarityCode)
    }
    const aba = Number(row?.abaCode)
    return Number.isFinite(aba) ? Math.round(aba) : -1
  }

  const usePinning = col !== 'distance'
  const pinnedCandidate = String(activeSortCountyRegion || '').toUpperCase()
  const pinnedRegion = (usePinning && isCountyRegionCode(pinnedCandidate) && currentTableData.some((r) => String(r?.countyRegion || '').toUpperCase() === pinnedCandidate))
    ? pinnedCandidate
    : (usePinning && currentTableData.some((r) => String(r?.countyRegion || '').toUpperCase() === YOLO_COUNTY_REGION) ? YOLO_COUNTY_REGION : '')

  const data = [...currentTableData].sort((a, b) => {
    if (pinnedSpecies) {
      const aPinnedSpecies = String(a?.species || '') === pinnedSpecies
      const bPinnedSpecies = String(b?.species || '') === pinnedSpecies
      if (aPinnedSpecies !== bPinnedSpecies) return aPinnedSpecies ? -1 : 1
    }

    const aRegion = String(a?.countyRegion || '').toUpperCase()
    const bRegion = String(b?.countyRegion || '').toUpperCase()
    if (pinnedRegion) {
      const aPinned = aRegion === pinnedRegion
      const bPinned = bRegion === pinnedRegion
      if (aPinned !== bPinned) return aPinned ? -1 : 1
    }

    const aCode = getPreferredCode(a)
    const bCode = getPreferredCode(b)
    const aLast = a.last?.getTime() ?? 0
    const bLast = b.last?.getTime() ?? 0

    if (col === 'species') {
      const aName = String(a.species || '')
      const bName = String(b.species || '')
      const cmp = aName.localeCompare(bName)
      if (cmp !== 0) return dir === 'desc' ? -cmp : cmp
      if (aCode !== bCode) return bCode - aCode
      if (aLast !== bLast) return bLast - aLast
      return String(a.county || '').localeCompare(String(b.county || ''))
    }

    if (col === 'state') {
      const aState = String(a.state || '')
      const bState = String(b.state || '')
      const cmp = aState.localeCompare(bState)
      if (cmp !== 0) return dir === 'desc' ? -cmp : cmp
      if (aCode !== bCode) return bCode - aCode
      if (aLast !== bLast) return bLast - aLast
      return String(a.species || '').localeCompare(String(b.species || ''))
    }

    if (col === 'county') {
      const aCounty = String(a.county || '')
      const bCounty = String(b.county || '')
      const cmp = aCounty.localeCompare(bCounty)
      if (cmp !== 0) return dir === 'desc' ? -cmp : cmp
      if (aCode !== bCode) return bCode - aCode
      if (aLast !== bLast) return bLast - aLast
      return String(a.species || '').localeCompare(String(b.species || ''))
    }

    if (col === 'distance') {
      const aDist = Number.isFinite(a.distanceKm) ? a.distanceKm : Infinity
      const bDist = Number.isFinite(b.distanceKm) ? b.distanceKm : Infinity
      if (aDist !== bDist) return dir === 'desc' ? (bDist - aDist) : (aDist - bDist)
      // Distance mode tie-breakers: code desc, then last desc.
      if (aCode !== bCode) return bCode - aCode
      if (aLast !== bLast) return bLast - aLast
      return String(a.species || '').localeCompare(String(b.species || ''))
    }

    if (col === 'code') {
      if (aCode !== bCode) return dir === 'desc' ? (bCode - aCode) : (aCode - bCode)
      if (aLast !== bLast) return bLast - aLast
      return String(a.species || '').localeCompare(String(b.species || ''))
    }

    const aDate = a.last?.getTime() ?? 0
    const bDate = b.last?.getTime() ?? 0
    if (aDate !== bDate) return dir === 'desc' ? (bDate - aDate) : (aDate - bDate)

    // Tiebreakers: ABA desc, then Last desc
    if (aCode !== bCode) return bCode - aCode
    if (aLast !== bLast) return bLast - aLast
    return String(a.species || '').localeCompare(String(b.species || ''))
  })
  const fragment = document.createDocumentFragment()
  data.forEach((item) => {
    const lastBubble = renderDateBubble(formatShortDate(item.last), getDateBubbleClass('last', item.first, item.last))
    const abaBadge = (!isLeafCountryView && !isNlCountryView) ? renderAbaCodeBadge(item.abaCode) : ''
    const nlBadge = isNlCountryView ? renderNlRarityCodeBadge(item.nlRarityCode) : ''
    const yoloBadge = isYoloCountyView ? renderYoloCodeBadge(item.species, item.abaCode) : ''
    const statusBullets = isYoloCountyView ? renderSpeciesStatusBullets(item.species) : ''
    const isConfirmed = Boolean(item.confirmedAny)
    const countPill = `<span class="count-pill ${isConfirmed ? 'count-pill-confirmed' : 'count-pill-pending'}" title="${isConfirmed ? 'Confirmed' : 'Pending'}">${item.count}</span>`
    const isChecked = !hiddenSpecies.has(item.species)
    const pinHtml = (item.lat != null && item.lng != null)
      ? `<button type="button" class="row-pin-btn" data-lat="${item.lat}" data-lng="${item.lng}" title="Open in Google Maps">📍</button>`
      : ''
    const row = document.createElement('tr')
    const safeSpecies = escapeHtml(item.species)
    const speciesDisplayLabel = getDisplaySpeciesLabel(item.species, item.scientificName)
    const speciesLabel = escapeHtml(speciesDisplayLabel || item.species)
    const safeCountyFull = escapeHtml(String(item.county || ''))
    const safeCountyShort = escapeHtml(shortCountyName(item.county))
    row.dataset.species = item.species
    row.dataset.county = String(item.county || '')
    row.dataset.countyRegion = String(item.countyRegion || '').toUpperCase()
    row.innerHTML = `
      <td class="col-code"><div class="code-cell">${nlBadge}${abaBadge}${yoloBadge}</div></td>
      <td><div class="species-cell">${statusBullets}<button type="button" class="species-btn" data-species="${safeSpecies}">${speciesLabel}</button></div></td>
      <td class="col-state">${escapeHtml(String(item.state || ''))}</td>
      <td class="col-county"><button type="button" class="county-cell county-cell-btn" data-county-region="${escapeHtml(String(item.countyRegion || '').toUpperCase())}" title="${safeCountyFull}">${safeCountyShort}</button></td>
      <td class="col-date col-last">${lastBubble}</td>
      <td class="col-reports">${countPill}</td>
      <td class="col-vis"><input type="checkbox" class="obs-vis-cb" data-species="${safeSpecies}" ${isChecked ? 'checked' : ''}></td>
      <td class="col-pin">${pinHtml}</td>
    `
    fragment.appendChild(row)
  })
  notableRows.innerHTML = ''
  notableRows.appendChild(fragment)
  // Re-sync toggle-all
  const toggleAll = document.querySelector('#toggleAllVis')
  if (toggleAll) {
    if (hiddenSpecies.size === 0) { toggleAll.checked = true; toggleAll.indeterminate = false }
    else if (hiddenSpecies.size >= currentTableData.length) { toggleAll.checked = false; toggleAll.indeterminate = false }
    else { toggleAll.indeterminate = true }
  }
  // Update sort icons
  ;[
    { id: 'thCode', col: 'code' },
    { id: 'thSpecies', col: 'species' },
    { id: 'thState', col: 'state' },
    { id: 'thCounty', col: 'county' },
    { id: 'thLast', col: 'last' },
  ].forEach(({ id, col: mappedCol }) => {
    const th = document.querySelector(`#${id}`)
    if (!th) return
    if (id === 'thCounty' && th.childNodes[0]?.nodeType === Node.TEXT_NODE) {
      th.childNodes[0].textContent = isLeafCountryView ? 'Province' : 'County'
    }
    const icon = th.querySelector('.sort-icon')
    if (!icon) return
    if (mappedCol === col) {
      icon.textContent = dir === 'desc' ? ' ↓' : ' ↑'
      th.classList.add('sort-active')
    } else {
      icon.textContent = ''
      th.classList.remove('sort-active')
    }
  })
  setTableRenderStatus(`sorted:${col}:${dir} rows=${data.length}`)
}

function ensureDistanceKmForCurrentTableData() {
  if (!Array.isArray(currentTableData) || currentTableData.length === 0) return
  const anchor = getDistanceAnchorPoint()
  if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lng)) return

  const closestByKey = computeClosestPointByGroup(lastTableObservationSource, anchor.lat, anchor.lng)
  currentTableData.forEach((row) => {
    const closest = closestByKey.get(row.groupKey)
    if (closest) {
      row.distanceKm = closest.distanceKm
      row.lat = closest.lat
      row.lng = closest.lng
      return
    }
    if (Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
      row.distanceKm = distanceKm(anchor.lat, anchor.lng, row.lat, row.lng)
    } else {
      row.distanceKm = Infinity
    }
  })
}

function setActiveSortCountyRegion(nextRegion) {
  const normalized = String(nextRegion || '').toUpperCase()
  if (!isCountyRegionCode(normalized)) return
  activeSortCountyRegion = normalized
  applySortAndRender()
}

function countryCodeFromRegionCode(regionCode) {
  const normalized = String(regionCode || '').toUpperCase().trim()
  if (!normalized) return null
  const head = normalized.split('-')[0]
  return head || null
}

function getEffectivePhysicalCountryCode() {
  const gpsCode = String(currentPhysicalCountryCode || '').toUpperCase()
  if (gpsCode) return gpsCode
  return countryCodeFromRegionCode(currentCountyRegion || currentActiveCountyCode || '')
}

function shouldShowSpeciesAlphaCodes() {
  const activeCountry = countryCodeFromRegionCode(currentCountyRegion || currentActiveCountyCode || '')
  return activeCountry !== 'NL'
}

function getDisplaySpeciesLabel(englishName, scientificName = '') {
  const english = String(englishName || '').trim()
  if (!english) return ''
  if (speciesNameLanguage !== 'nl') return english
  const dutch = String(getNlLocalNameForSpecies(english, scientificName) || '').trim()
  if (!dutch) return english
  if (normalizeSpeciesLookupKey(dutch) === normalizeSpeciesLookupKey(english)) return english
  return dutch
}

function syncSpeciesLanguageToggleUi() {
  if (!speciesLangToggleBtn) return
  const isNl = speciesNameLanguage === 'nl'
  speciesLangToggleBtn.textContent = isNl ? 'NL' : 'EN'
  speciesLangToggleBtn.setAttribute('title', `Species labels: ${isNl ? 'Dutch' : 'English'}`)
  speciesLangToggleBtn.setAttribute('aria-pressed', String(isNl))
}

function useUsDateTimeFormat() {
  return getEffectivePhysicalCountryCode() === 'US'
}

function formatObsDateTimeByRegion(obsDt) {
  const d = parseObsDate(obsDt)
  if (!d) return obsDt || 'Unknown date'

  const month = d.getMonth() + 1
  const day = d.getDate()
  const yearShort = String(d.getFullYear()).slice(-2)
  const minutes = String(d.getMinutes()).padStart(2, '0')

  if (useUsDateTimeFormat()) {
    const hour = d.getHours()
    const normalizedAmPm = hour >= 12 ? 'PM' : 'AM'
    const hour12 = hour % 12 || 12
    return `${month}/${day}/${yearShort} ${hour12}:${minutes}${normalizedAmPm}`
  }

  const hour24 = d.getHours()
  return `${day}/${month}/${yearShort} ${hour24}:${minutes}`
}

function getLocalSpeciesNameFromAliases(info, englishName, scientificName) {
  const aliases = Array.isArray(info?.aliases) ? info.aliases : []
  const englishNeedle = normalizeSpeciesLookupKey(englishName)
  const sciNeedle = String(scientificName || '').trim().toLowerCase()
  const wantedCountry = String(getEffectivePhysicalCountryCode() || '').toLowerCase()
  const nlRef = getNlSpeciesReference(englishName)

  const normalizedCandidates = aliases
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)

  const tagged = normalizedCandidates
    .map((entry) => {
      const match = entry.match(/^([a-z]{2})\s*[:|-]\s*(.+)$/i)
      if (!match) return null
      const cc = String(match[1] || '').toLowerCase()
      const value = String(match[2] || '').trim()
      if (!value) return null
      return { cc, value }
    })
    .filter(Boolean)

  if (wantedCountry) {
    const exact = tagged.find((entry) => entry.cc === wantedCountry)
    if (exact) return { name: exact.value, source: 'alias-tag' }
  }

  if (wantedCountry === 'nl') {
    const avibase = getAvibaseNlChecklistInfo(englishName, scientificName)
    const avibaseDutch = String(avibase?.dutchName || '').trim()
    if (avibaseDutch) return { name: avibaseDutch, source: 'avibase' }
  }

  if (wantedCountry === 'nl') {
    const nlRefName = String(nlRef?.localName || nlRef?.dutchName || nlRef?.nlName || '').trim()
    if (nlRefName) return { name: nlRefName, source: 'nl-ref' }
  }

  const plain = normalizedCandidates.find((name) => {
    const lower = normalizeSpeciesLookupKey(name)
    return lower !== englishNeedle && lower !== sciNeedle && !/^[a-z]{2}\s*[:|-]/i.test(name)
  })
  if (plain) return { name: plain, source: 'alias' }

  const supplemental = LOCAL_SPECIES_NAME_LOOKUP.get(englishNeedle)
  if (!supplemental || typeof supplemental !== 'object') return { name: null, source: 'none' }
  if (wantedCountry && typeof supplemental[wantedCountry] === 'string' && supplemental[wantedCountry].trim()) {
    return { name: supplemental[wantedCountry].trim(), source: 'supp' }
  }
  if (typeof supplemental.nl === 'string' && supplemental.nl.trim()) {
    return { name: supplemental.nl.trim(), source: 'supp' }
  }
  return { name: null, source: 'none' }
}

function getNlLocalNameForSpecies(englishName, scientificName = '') {
  const avibase = getAvibaseNlChecklistInfo(englishName, scientificName)
  const avibaseDutch = String(avibase?.dutchName || '').trim()
  if (avibaseDutch) return avibaseDutch

  const info = getYoloSpeciesInfo(englishName)
  const local = getLocalSpeciesNameFromAliases(info, englishName, scientificName)
  const localName = String(local?.name || '').trim()
  if (localName) return localName
  const nlRef = getNlSpeciesReference(englishName)
  const nlRefName = String(nlRef?.localName || nlRef?.dutchName || nlRef?.nlName || '').trim()
  if (nlRefName) return nlRefName
  return ''
}

function getScientificNameForSpecies(englishName) {
  const info = getYoloSpeciesInfo(englishName)
  const refSci = String(info?.scientificName || '').trim()
  if (refSci) return { name: refSci, source: 'ref' }

  const nlRef = getNlSpeciesReference(englishName)
  const nlSci = String(nlRef?.scientificName || '').trim()
  if (nlSci) return { name: nlSci, source: 'nl-ref' }

  const source = Array.isArray(currentRawObservations) ? currentRawObservations : []
  const match = source.find((item) => String(item?.comName || '').trim() === String(englishName || '').trim()) || null
  const obsSci = String(match?.sciName || match?.scientificName || '').trim()
  if (obsSci) return { name: obsSci, source: 'obs' }
  return { name: null, source: 'none' }
}

function setSpeciesDetailDebug(meta = {}) {
  if (!speciesDetailDebug) return
  speciesDetailDebug.textContent = ''
  speciesDetailDebug.removeAttribute('title')
  speciesDetailDebug.setAttribute('hidden', 'hidden')
}

function chooseFrequencyWeeklyAxisMax(maxObservedPercent) {
  const maxPct = Math.max(0, Number(maxObservedPercent) || 0)
  return FREQUENCY_WEEKLY_AXIS_BINS.find((bin) => maxPct <= bin.threshold)?.axisMax || FREQUENCY_WEEKLY_Y_MAX
}

function getSpeciesDetailTargetPoint(speciesName) {
  const species = String(speciesName || '').trim()
  if (!species) return null
  const points = Array.isArray(speciesMarkers.get(species)) ? speciesMarkers.get(species) : []
  const currentLocKey = String(speciesDetailBody?.querySelector?.('.obs-popup-inner')?.dataset?.locKey || '')
  return points.find((pt) => String(pt?.locKey || '') === currentLocKey) || pickBestSpeciesPoint(points, species)
}

function ensureFrequencyScaleToggleHandler() {
  if (_frequencyScaleToggleHandlerInstalled) return
  _frequencyScaleToggleHandlerInstalled = true
  document.addEventListener('click', (event) => {
    const btn = event.target?.closest?.('.species-freq-scale-toggle')
    if (!btn) return
    event.preventDefault()
    frequencyWeeklyScaleMode = frequencyWeeklyScaleMode === 'stretched' ? 'standard' : 'stretched'
    if (!speciesDetailPanel || speciesDetailPanel.hasAttribute('hidden') || !selectedSpecies) return
    const targetPt = getSpeciesDetailTargetPoint(String(selectedSpecies))
    if (!targetPt) return
    speciesDetailBody.innerHTML = buildObservationPopupHtml(targetPt, { hideHeader: true })
    void updateSpeciesDetailFrequencyCharts(String(selectedSpecies), targetPt)
  })
}

function setSpeciesDetailTitle(speciesName) {
  if (!speciesDetailTitle) return
  const english = String(speciesName || '').trim()
  if (!english) {
    speciesDetailTitle.textContent = ''
    if (speciesDetailDebug) speciesDetailDebug.setAttribute('hidden', 'hidden')
    return
  }

  const sci = getScientificNameForSpecies(english)
  const scientificName = String(sci?.name || '').trim()
  const displayName = String(getDisplaySpeciesLabel(english, scientificName) || english).trim()

  setSpeciesDetailDebug({
    latinSource: sci?.source || 'none',
    localSource: 'none',
  })

  speciesDetailTitle.innerHTML = `<span class="species-detail-title-en">${escapeHtml(displayName)}</span>`
}

function setSpeciesDetailHeader(speciesName) {
  setSpeciesDetailTitle(speciesName)
  if (!speciesDetailStatus) return
  speciesDetailStatus.innerHTML = ''
  speciesDetailStatus.setAttribute('hidden', 'hidden')
}

function normalizeFrequencyNeedle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function deriveSpeciesFrequencyRegions(targetPt = null) {
  const candidate = String(
    targetPt?.item?.subnational2Code
    || targetPt?.item?.subnational1Code
    || currentCountyRegion
    || currentActiveCountyCode
    || ''
  ).toUpperCase()
  if (!candidate) return { nationalRegion: null, stateRegion: null, countyRegion: null }

  const parts = candidate.split('-').filter(Boolean)
  const nationalRegion = String(parts[0] || '').toUpperCase() || null
  const stateRegion = parts.length >= 2
    ? `${parts[0]}-${parts[1]}`.toUpperCase()
    : null
  const countyRegion = parts.length >= 3
    ? `${parts[0]}-${parts[1]}-${parts[2]}`.toUpperCase()
    : null

  if (!isValidRegionCodeForFrequency(nationalRegion)) {
    return { nationalRegion: null, stateRegion: null, countyRegion: null }
  }
  const stateValid = isValidRegionCodeForFrequency(stateRegion) && stateRegion !== nationalRegion
  const countyValid = isValidRegionCodeForFrequency(countyRegion) && countyRegion !== stateRegion
  return {
    nationalRegion,
    stateRegion: stateValid ? stateRegion : null,
    countyRegion: countyValid ? countyRegion : null,
  }
}

function isValidRegionCodeForFrequency(value) {
  const region = String(value || '').toUpperCase().trim()
  if (!region) return false
  if (/^[A-Z]{2,3}$/.test(region)) return true
  if (/^US-[A-Z]{2,3}-\d{3}$/.test(region)) return true
  if (/^[A-Z]{2,3}-[A-Z0-9]{1,6}$/.test(region)) return true
  return false
}

function getSpeciesCodeForFrequency(speciesName, targetPt = null) {
  const fromItem = String(targetPt?.item?.speciesCode || targetPt?.item?.speciesCodeEb || '').trim().toLowerCase()
  if (fromItem) return fromItem
  const yolo = getYoloSpeciesInfo(speciesName)
  const fromYolo = String(yolo?.speciesCode || yolo?.ebirdSpeciesCode || '').trim().toLowerCase()
  if (fromYolo) return fromYolo
  const nlRef = getNlSpeciesReference(speciesName)
  const fromNlRef = String(nlRef?.speciesCode || nlRef?.ebirdSpeciesCode || '').trim().toLowerCase()
  if (fromNlRef) return fromNlRef
  return ''
}

function findFrequencyRecordInDoc(doc, { speciesName, scientificName, speciesCode }) {
  const rows = Array.isArray(doc?.species) ? doc.species : []
  if (!rows.length) return null

  const codeNeedle = String(speciesCode || '').trim().toLowerCase()
  if (codeNeedle) {
    const byCode = rows.find((row) => String(row?.speciesCode || '').trim().toLowerCase() === codeNeedle)
    if (byCode) return byCode
  }

  const englishNeedle = normalizeFrequencyNeedle(speciesName)
  const scientificNeedle = normalizeFrequencyNeedle(scientificName)
  return rows.find((row) => {
    const rowEnglish = normalizeFrequencyNeedle(row?.comName || row?.commonName || '')
    const rowScientific = normalizeFrequencyNeedle(row?.sciName || row?.scientificName || '')
    if (englishNeedle && rowEnglish === englishNeedle) return true
    if (scientificNeedle && rowScientific === scientificNeedle) return true
    return false
  }) || null
}

async function fetchFrequencyRegionDocStatic(region) {
  const normalized = String(region || '').toUpperCase().trim()
  if (!isValidRegionCodeForFrequency(normalized)) return null
  if (speciesFrequencyRegionCache.has(normalized)) return speciesFrequencyRegionCache.get(normalized)

  const endpoint = `./data/frequency/regions/${encodeURIComponent(normalized)}.json`
  try {
    const response = await fetchWithTimeout(endpoint, 8000)
    if (!response.ok) return null
    const json = await response.json()
    speciesFrequencyRegionCache.set(normalized, json)
    return json
  } catch {
    return null
  }
}

async function fetchSpeciesFrequencyFromApi(region, speciesName, speciesCode = '') {
  const normalized = String(region || '').toUpperCase().trim()
  if (!isValidRegionCodeForFrequency(normalized)) return null
  if (!getStoredEbirdApiKey()) return null

  const params = new URLSearchParams({ region: normalized, species: speciesName })
  if (speciesCode) params.set('speciesCode', speciesCode)
  const endpoint = `${API_BASE_URL}/api/species_frequency?${params.toString()}`

  try {
    const response = await fetchWithTimeout(endpoint, 10000)
    if (!response.ok) return null
    const payload = await response.json()
    const monthly = Array.isArray(payload?.frequencyMonthly)
      ? payload.frequencyMonthly.map((n) => Number(n) || 0).slice(0, 12)
      : []
    while (monthly.length < 12) monthly.push(0)
    const weekly = Array.isArray(payload?.frequencyWeekly)
      ? payload.frequencyWeekly.map((n) => Number(n) || 0).slice(0, 48)
      : []
    while (weekly.length < 48 && weekly.length > 0) weekly.push(0)
    const annual = Number(payload?.frequencyAnnual)
    return {
      region: normalized,
      source: String(payload?.source || 'worker-api'),
      monthly,
      weekly: weekly.length === 48 ? weekly : null,
      annual: Number.isFinite(annual) ? annual : (monthly.reduce((sum, n) => sum + n, 0) / 12),
    }
  } catch {
    return null
  }
}

async function fetchSpeciesFrequency(region, speciesName, scientificName, speciesCode = '') {
  const normalized = String(region || '').toUpperCase().trim()
  if (!isValidRegionCodeForFrequency(normalized)) return null

  const fromApi = await fetchSpeciesFrequencyFromApi(normalized, speciesName, speciesCode)
  const apiMonthlySum = fromApi
    ? (Array.isArray(fromApi.monthly) ? fromApi.monthly.reduce((sum, n) => sum + (Number(n) || 0), 0) : 0)
    : 0

  const doc = await fetchFrequencyRegionDocStatic(normalized)
  if (!doc) return fromApi || null
  const record = findFrequencyRecordInDoc(doc, { speciesName, scientificName, speciesCode })
  if (!record) return fromApi || null

  const monthly = Array.isArray(record?.frequencyMonthly)
    ? record.frequencyMonthly.map((n) => Number(n) || 0).slice(0, 12)
    : []
  while (monthly.length < 12) monthly.push(0)
  const weekly = Array.isArray(record?.frequencyWeekly)
    ? record.frequencyWeekly.map((n) => Number(n) || 0).slice(0, 48)
    : []
  while (weekly.length < 48 && weekly.length > 0) weekly.push(0)
  const annual = Number(record?.frequencyAnnual)
  const fromStatic = {
    region: normalized,
    source: String(doc?.source || 'static-json'),
    monthly,
    weekly: weekly.length === 48 ? weekly : null,
    annual: Number.isFinite(annual) ? annual : (monthly.reduce((sum, n) => sum + n, 0) / 12),
  }
  const staticMonthlySum = monthly.reduce((sum, n) => sum + (Number(n) || 0), 0)

  if (fromApi) {
    const apiWeeklySum = Array.isArray(fromApi.weekly)
      ? fromApi.weekly.reduce((sum, n) => sum + (Number(n) || 0), 0)
      : 0
    const staticWeeklySum = Array.isArray(fromStatic.weekly)
      ? fromStatic.weekly.reduce((sum, n) => sum + (Number(n) || 0), 0)
      : 0
    if (staticWeeklySum > 0 && apiWeeklySum <= 0) return fromStatic
    return staticMonthlySum > apiMonthlySum ? fromStatic : fromApi
  }
  return fromStatic
}

function renderSpeciesFrequencyPanel(title, frequencyData, options = {}) {
  const panelTitle = String(title || '')
  const isNationalPanel = /^National\b/i.test(panelTitle)
  const monthly = Array.isArray(frequencyData?.monthly) ? frequencyData.monthly : []
  const weekly = Array.isArray(frequencyData?.weekly) ? frequencyData.weekly : []
  const hasWeekly = weekly.length === 48
  const bins = hasWeekly ? weekly : monthly
  if (!bins.length) return ''
  const getCurrentFrequencyWeekIndex = () => {
    const now = new Date()
    const month = now.getMonth()
    const day = now.getDate()
    const daysInMonth = new Date(now.getFullYear(), month + 1, 0).getDate()
    const quarter = Math.min(3, Math.floor(((day - 1) / Math.max(1, daysInMonth)) * 4))
    const index = (month * 4) + quarter
    return Math.max(0, Math.min(47, index))
  }
  const formatFrequencyPercent = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return '—'
    const pct = numeric * 100
    if (pct <= 0) return '0.0%'
    if (pct < 1) return `${pct.toFixed(2)}%`
    return `${pct.toFixed(1)}%`
  }
  const maxValue = Math.max(0, ...bins)
  const weeklyPctValues = hasWeekly
    ? bins.map((n) => Math.max(0, (Number(n) || 0) * 100))
    : []
  const weeklyMaxObservedPct = hasWeekly ? Math.max(0, ...weeklyPctValues) : 0
  const sharedWeeklyAxisMax = Number(options?.sharedWeeklyAxisMax)
  const weeklyAxisMax = hasWeekly
    ? (Number.isFinite(sharedWeeklyAxisMax) && sharedWeeklyAxisMax > 0
      ? sharedWeeklyAxisMax
      : chooseFrequencyWeeklyAxisMax(weeklyMaxObservedPct))
    : FREQUENCY_WEEKLY_Y_MAX
  const currentWeekIndex = hasWeekly ? getCurrentFrequencyWeekIndex() : -1
  const bars = bins.map((value, index) => {
    const safeValue = Number(value) || 0
    const safeValuePct = Math.max(0, safeValue * 100)
    const monthIndex = hasWeekly ? Math.floor(index / 4) : index
    const weekInMonth = hasWeekly ? (index % 4) + 1 : null
    const label = FREQUENCY_MONTH_LABELS[monthIndex] || ''
    const isMonthBoundary = hasWeekly && index > 0 && (index % 4 === 0)
    const wrapClass = isMonthBoundary ? 'species-freq-bar-wrap species-freq-week-split' : 'species-freq-bar-wrap'
    if (hasWeekly) {
      const linearRatio = weeklyAxisMax > 0
        ? Math.max(0, Math.min(1, safeValuePct / weeklyAxisMax))
        : 0
      const stretchedRatio = 1 - Math.exp(-linearRatio * FREQUENCY_WEEKLY_STRETCH_MULTIPLIER)
      const magnitudeRatio = frequencyWeeklyScaleMode === 'stretched' ? stretchedRatio : linearRatio
      const magnitudePct = Math.max(0, Math.min(FREQUENCY_WEEKLY_BAR_HEADROOM_PCT, magnitudeRatio * FREQUENCY_WEEKLY_BAR_HEADROOM_PCT))
      const tooltipText = formatFrequencyPercent(safeValue)
      return `<div class="${wrapClass}"><span class="species-freq-bar species-freq-bar-centered" style="height:${magnitudePct.toFixed(2)}%" data-freq-tooltip="${escapeHtml(tooltipText)}"></span></div>`
    }

    const pct = maxValue > 0
      ? Math.max(0, Math.min(100, (safeValue / maxValue) * 100))
      : 0
    const tooltipText = formatFrequencyPercent(safeValue)
    return `<div class="${wrapClass}"><span class="species-freq-bar" style="height:${pct.toFixed(2)}%" data-freq-tooltip="${escapeHtml(tooltipText)}"></span></div>`
  }).join('')
  const months = FREQUENCY_MONTH_LABELS.map((m) => `<span>${escapeHtml(m)}</span>`).join('')
  const annual = Number(frequencyData?.annual)
  const annualText = formatFrequencyPercent(annual)
  const axis = hasWeekly
    ? `<div class="species-freq-weekly-months">${months}</div>`
    : `<div class="species-freq-months">${months}</div>`
  const scaleToggle = hasWeekly && isNationalPanel
    ? `<button type="button" class="species-freq-scale-toggle" data-scale-mode="${escapeHtml(frequencyWeeklyScaleMode)}" aria-label="Frequency scale mode ${escapeHtml(frequencyWeeklyScaleMode === 'stretched' ? 'percent' : 'linear')}" title="Scale: ${escapeHtml(frequencyWeeklyScaleMode === 'stretched' ? '%' : 'LIN')}"><span class="species-freq-scale-text">${escapeHtml(frequencyWeeklyScaleMode === 'stretched' ? '%' : 'LIN')}</span></button>`
    : ''
  const panelClass = scaleToggle ? 'species-freq-panel species-freq-panel-has-toggle' : 'species-freq-panel'
  const marker = hasWeekly
    ? `<span class="species-freq-current-week-marker" style="left:calc(((100% / 48) * ${currentWeekIndex}) + (100% / 96));" title="Current week"></span>`
    : ''
  return `<section class="${panelClass}"><div class="species-freq-head"><span class="species-freq-title">${escapeHtml(panelTitle)}</span><span class="species-freq-annual">Annual avg ${escapeHtml(annualText)}</span></div><div class="species-freq-bars ${hasWeekly ? 'species-freq-bars-weekly species-freq-bars-centered' : ''}">${marker}${bars}</div>${axis}${scaleToggle}</section>`
}

async function updateSpeciesDetailFrequencyCharts(speciesName, targetPt = null) {
  if (!speciesDetailBody || !speciesDetailPanel || speciesDetailPanel.hasAttribute('hidden')) return
  const species = String(speciesName || '').trim()
  if (!species) return

  const requestId = ++latestSpeciesFrequencyRequestId
  const container = speciesDetailBody.querySelector('.obs-popup-inner') || speciesDetailBody
  const old = container.querySelector('.species-freq-section')
  if (old) old.remove()

  const section = document.createElement('div')
  section.className = 'species-freq-section'
  section.innerHTML = '<div class="species-freq-loading">Loading frequency charts…</div>'
  container.appendChild(section)

  const scientific = String(targetPt?.item?.sciName || targetPt?.item?.scientificName || getScientificNameForSpecies(species)?.name || '').trim()
  const speciesCode = getSpeciesCodeForFrequency(species, targetPt)
  const { nationalRegion, stateRegion, countyRegion } = deriveSpeciesFrequencyRegions(targetPt)
  const targets = []
  const isUsDetail = nationalRegion === 'US'
  if (countyRegion) targets.push({ key: 'county', region: countyRegion, title: 'County' })
  if (stateRegion) targets.push({ key: 'regional', region: stateRegion, title: isUsDetail ? 'State' : 'Province' })
  if (nationalRegion && !isUsDetail) targets.push({ key: 'national', region: nationalRegion, title: 'National' })

  if (!targets.length) {
    section.innerHTML = '<div class="species-freq-empty">Frequency charts unavailable for this region.</div>'
    return
  }

  const results = await Promise.all(targets.map(async (target) => {
    const data = await fetchSpeciesFrequency(target.region, species, scientific, speciesCode)
    return { ...target, data }
  }))

  if (requestId !== latestSpeciesFrequencyRequestId) return
  if (!speciesDetailPanel || speciesDetailPanel.hasAttribute('hidden')) return
  if (String(selectedSpecies || '').trim() !== species) return

  const weeklySeries = results
    .map((entry) => (Array.isArray(entry?.data?.weekly) ? entry.data.weekly : []))
    .filter((series) => series.length === 48)
  const sharedWeeklyMaxObservedPct = weeklySeries.length
    ? Math.max(
      0,
      ...weeklySeries.map((series) => Math.max(0, ...series.map((n) => (Number(n) || 0) * 100))),
    )
    : 0
  const sharedWeeklyAxisMax = weeklySeries.length
    ? chooseFrequencyWeeklyAxisMax(sharedWeeklyMaxObservedPct)
    : null

  const panels = results
    .filter((entry) => entry?.data && Array.isArray(entry.data.monthly) && entry.data.monthly.length)
    .map((entry) => renderSpeciesFrequencyPanel(entry.title, entry.data, { sharedWeeklyAxisMax }))
    .filter(Boolean)

  const countyMissing = Boolean(results.find((entry) => entry?.key === 'county' && !entry?.data))
  const regionalAvailable = Boolean(results.find((entry) => entry?.key === 'regional' && entry?.data))
  const countyUnavailableNote = (countyMissing && regionalAvailable)
    ? '<div class="species-freq-note">County frequency not available; showing state.</div>'
    : ''

  section.innerHTML = panels.length
    ? `${countyUnavailableNote}<div class="species-freq-grid">${panels.join('')}</div>`
    : '<div class="species-freq-empty">No frequency data found for this species in selected regions.</div>'
}

function deriveSpeciesDetailStateRegion(speciesName, targetPt = null) {
  const fromTarget = String(targetPt?.item?.subnational1Code || '').toUpperCase()
  if (isStateRegionCode(fromTarget)) return fromTarget

  const pts = speciesMarkers.get(String(speciesName || ''))
  if (Array.isArray(pts)) {
    for (const pt of pts) {
      const candidate = String(pt?.item?.subnational1Code || '').toUpperCase()
      if (isStateRegionCode(candidate)) return candidate
    }
  }

  const fallback = String(stateRegionFromAnyRegion(currentCountyRegion || '') || '').toUpperCase()
  return isStateRegionCode(fallback) ? fallback : null
}

function openSpeciesDetailForSelection(speciesName, targetPt = null) {
  const species = String(speciesName || '').trim()
  if (!species) return
  mapPointSpeciesFilter = new Set()
  selectedSpecies = species
  lastSpeciesDetailStateRegion = deriveSpeciesDetailStateRegion(species, targetPt)

  if (speciesDetailPanel && speciesDetailBody && speciesDetailTitle) {
    applySpeciesDetailPanelLayout()
    setSpeciesDetailHeader(species)
    speciesDetailBody.innerHTML = targetPt
      ? buildObservationPopupHtml(targetPt, { hideHeader: true })
      : '<div class="obs-popup-inner"><p>No recent observations found.</p></div>'
    speciesDetailPanel.removeAttribute('hidden')
    void updateSpeciesDetailFrequencyCharts(species, targetPt)
  }
}

async function restoreSpeciesOverviewFromBack() {
  const targetState = String(lastSpeciesDetailStateRegion || '').toUpperCase()
  selectedSpecies = null

  if (!targetState || !isStateRegionCode(targetState)) {
    applyActiveFiltersAndRender({ allowAutoRecovery: false, fitToObservations: true })
    return
  }

  const activeRegion = String(currentCountyRegion || '').toUpperCase()
  if (activeRegion === targetState) {
    applyActiveFiltersAndRender({ allowAutoRecovery: false, fitToObservations: true })
    return
  }

  await activateStateByRegion(targetState)
}

// ---------------------------------------------------------------------------
// Fast canvas overlay — replaces per-marker Leaflet objects with a single
// Canvas2D draw pass + one click-handler for hit-testing.
// ---------------------------------------------------------------------------
const ABA_COLORS = {
  1: { fill: '#067bc2', border: '#ffffff' },
  2: { fill: '#84bcda', border: '#ffffff' },
  3: { fill: '#ecc30b', border: '#ffffff' },
  4: { fill: '#f37748', border: '#ffffff' },
  5: { fill: '#ED1313', border: '#ffffff' },
}
const ABA_DEFAULT_COLOR = { fill: '#4b5563', border: '#ffffff' }
const MARKER_RADIUS = 9        // px, logical
const HIT_RADIUS = 12          // px, slightly larger for touch
const CLUSTER_ZOOM_THRESHOLD = 10
const CLUSTER_GRID_PX = 44
const COUNTY_MILE_CLUSTER_RADIUS_KM = 1.60934
const COUNTY_MILE_CLUSTER_ZOOM_THRESHOLD = 12

let fastCanvasOverlay = null   // L.Layer instance
let fastCanvasData = []        // rendered points for current zoom (clustered or raw)
let fastCanvasBaseData = []    // raw points before clustering
let fastCanvasPopup = null     // single reused L.popup
let fastCanvasPopupKey = null  // key for last opened popup (for toggle close)

function getCanvasPopupKey(pt) {
  if (!pt) return ''
  const locKey = String(pt.locKey || '')
  const lat = Number(pt.lat)
  const lng = Number(pt.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return locKey
  return `${locKey || 'loc'}|${lat.toFixed(5)}|${lng.toFixed(5)}`
}

function buildClusteredCanvasData(baseData, mapInstance) {
  if (!mapInstance) return Array.isArray(baseData) ? baseData : []
  const source = Array.isArray(baseData) ? baseData : []
  if (!source.length) return []

  const zoom = mapInstance.getZoom()
  const isCountyView = isCountyRegionCode(String(currentActiveCountyCode || '').toUpperCase())

  // In county views, cluster geographically (within ~1 mile) and count *unique species*
  // within each geographic cluster.
  if (isCountyView && zoom <= COUNTY_MILE_CLUSTER_ZOOM_THRESHOLD) {
    const radiusKm = COUNTY_MILE_CLUSTER_RADIUS_KM
    const cellSizeM = radiusKm * 1000

    const toMercator = (lat, lng) => {
      const R = 6378137
      const x = R * (lng * Math.PI / 180)
      const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2))
      return { x, y }
    }

    const projected = source.map((pt) => {
      const { x, y } = toMercator(pt.lat, pt.lng)
      const cx = Math.floor(x / cellSizeM)
      const cy = Math.floor(y / cellSizeM)
      return { x, y, cx, cy }
    })

    const cellMap = new Map() // key -> indices
    for (let i = 0; i < source.length; i += 1) {
      const pr = projected[i]
      const key = `${pr.cx}:${pr.cy}`
      if (!cellMap.has(key)) cellMap.set(key, [])
      cellMap.get(key).push(i)
    }

    const visited = new Array(source.length).fill(false)
    const clusters = []

    for (let i = 0; i < source.length; i += 1) {
      const seed = source[i]
      if (!seed || seed.hidden) { visited[i] = true; continue }
      if (visited[i]) continue
      visited[i] = true

      const queue = [i]
      const memberIdx = [i]

      while (queue.length) {
        const idx = queue.pop()
        const pr = projected[idx]
        const base = source[idx]

        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            const key = `${pr.cx + dx}:${pr.cy + dy}`
            const candidates = cellMap.get(key)
            if (!candidates) continue
            for (const candIdx of candidates) {
              if (visited[candIdx]) continue
              const cand = source[candIdx]
              if (!cand || cand.hidden) { visited[candIdx] = true; continue }
              if (distanceKm(base.lat, base.lng, cand.lat, cand.lng) <= radiusKm) {
                visited[candIdx] = true
                queue.push(candIdx)
                memberIdx.push(candIdx)
              }
            }
          }
        }
      }

      if (memberIdx.length === 1) {
        clusters.push(seed)
        continue
      }

      let latSum = 0
      let lngSum = 0
      let maxAbaCode = null
      const speciesSet = new Set()
      for (const idx of memberIdx) {
        const pt = source[idx]
        latSum += pt.lat
        lngSum += pt.lng
        const list = Array.isArray(pt?.speciesList) ? pt.speciesList : []
        if (list.length) {
          list.forEach((name) => { if (name) speciesSet.add(String(name)) })
        } else {
          const label = String(pt?.species || '')
          if (label) speciesSet.add(label)
        }
        if (Number.isFinite(pt.abaCode) && (!Number.isFinite(maxAbaCode) || pt.abaCode > maxAbaCode)) {
          maxAbaCode = pt.abaCode
        }
      }

      const speciesCount = speciesSet.size
      const abaCode = Number.isFinite(maxAbaCode) ? maxAbaCode : null
      const colors = ABA_COLORS[abaCode] || ABA_DEFAULT_COLOR
      clusters.push({
        lat: latSum / memberIdx.length,
        lng: lngSum / memberIdx.length,
        fill: colors.fill,
        border: colors.border,
        species: `${speciesCount} species`,
        safeSpecies: escapeHtml(`${speciesCount} species`),
        abaCode,
        subIds: [],
        subDates: [],
        item: seed?.item || null,
        label: String(speciesCount),
        hidden: false,
        isCluster: true,
        clusterCount: speciesCount,
      })
    }

    return clusters
  }

  if (zoom > CLUSTER_ZOOM_THRESHOLD) return source

  const buckets = new Map()
  source.forEach((pt) => {
    if (pt.hidden) return
    const cp = mapInstance.latLngToContainerPoint([pt.lat, pt.lng])
    const key = `${Math.round(cp.x / CLUSTER_GRID_PX)}:${Math.round(cp.y / CLUSTER_GRID_PX)}`
    if (!buckets.has(key)) {
      buckets.set(key, {
        points: [],
        latSum: 0,
        lngSum: 0,
        maxAbaCode: Number.isFinite(pt.abaCode) ? pt.abaCode : null,
      })
    }
    const bucket = buckets.get(key)
    bucket.points.push(pt)
    bucket.latSum += pt.lat
    bucket.lngSum += pt.lng
    if (Number.isFinite(pt.abaCode) && (!Number.isFinite(bucket.maxAbaCode) || pt.abaCode > bucket.maxAbaCode)) {
      bucket.maxAbaCode = pt.abaCode
    }
  })

  const clustered = []
  buckets.forEach((bucket) => {
    if (bucket.points.length === 1) {
      clustered.push(bucket.points[0])
      return
    }
    const abaCode = Number.isFinite(bucket.maxAbaCode) ? bucket.maxAbaCode : null
    const colors = ABA_COLORS[abaCode] || ABA_DEFAULT_COLOR
    const speciesSet = new Set()
    bucket.points.forEach((pt) => {
      const list = Array.isArray(pt?.speciesList) ? pt.speciesList : []
      if (list.length) {
        list.forEach((name) => { if (name) speciesSet.add(String(name)) })
      } else {
        const label = String(pt?.species || '')
        if (label) speciesSet.add(label)
      }
    })
    const pointsCount = bucket.points.length
    const speciesCount = speciesSet.size || pointsCount
    clustered.push({
      lat: bucket.latSum / pointsCount,
      lng: bucket.lngSum / pointsCount,
      fill: colors.fill,
      border: colors.border,
      species: `${speciesCount} species`,
      safeSpecies: escapeHtml(`${speciesCount} species`),
      abaCode,
      subIds: [],
      subDates: [],
      item: bucket.points[0]?.item || null,
      label: String(speciesCount),
      hidden: false,
      isCluster: true,
      clusterCount: speciesCount,
    })
  })

  return clustered
}

function buildFastCanvasOverlay() {
  const CanvasOverlay = L.Layer.extend({
    onAdd(m) {
      this._map = m
      this._canvas = document.createElement('canvas')
      this._canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none'
      m.getPanes().notablePane.appendChild(this._canvas)
      m.on('move zoomend resize', this._redraw, this)
      this._redraw()
    },
    onRemove(m) {
      m.off('move zoomend resize', this._redraw, this)
      this._canvas.remove()
    },
    redraw() { this._redraw() },
    _redraw() {
      const m = this._map
      const size = m.getSize()
      const dpr = window.devicePixelRatio || 1
      const cvs = this._canvas
      cvs.width  = size.x * dpr
      cvs.height = size.y * dpr
      cvs.style.width  = size.x + 'px'
      cvs.style.height = size.y + 'px'

      // Align canvas top-left with the map's current tile origin
      const topLeft = m.containerPointToLayerPoint([0, 0])
      L.DomUtil.setPosition(cvs, topLeft)

      const ctx = cvs.getContext('2d')
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, size.x, size.y)

      const drawData = buildClusteredCanvasData(fastCanvasBaseData, m)
      fastCanvasData = drawData
      for (const pt of drawData) {
        if (pt.hidden) continue
        const r = pt.isCluster ? Math.min(17, MARKER_RADIUS + Math.floor(Math.log2((pt.clusterCount || 1) + 1)) * 2) : MARKER_RADIUS
        // Use layer-space coordinates so canvas positioning and point math
        // stay in the same reference frame during pan/zoom transforms.
        const lp = m.latLngToLayerPoint([pt.lat, pt.lng])
        const x = lp.x - topLeft.x
        const y = lp.y - topLeft.y
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = pt.fill
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = pt.border
        ctx.stroke()
        if (pt.isCluster) {
          if (labelMode !== 'off') {
            const txt = String(pt.clusterCount || '')
            ctx.font = '700 10px sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillStyle = '#ffffff'
            ctx.fillText(txt, x, y)
          }
          continue
        }
        if (pt.label) {
          ctx.font = '600 11px sans-serif'
          ctx.textAlign = 'left'
          ctx.textBaseline = 'alphabetic'
          const tx = x + r + 4
          const ty = y + 4
          const tw = ctx.measureText(pt.label).width
          const pad = 2
          ctx.fillStyle = 'rgba(255,255,255,0.82)'
          ctx.beginPath()
          ctx.roundRect(tx - pad, ty - 10, tw + pad * 2, 13, 3)
          ctx.fill()
          ctx.fillStyle = '#0f172a'
          ctx.fillText(pt.label, tx, ty)
        }
      }
    },
  })
  return new CanvasOverlay()
}

function hitTestCanvas(containerPoint) {
  const m = map
  let best = null
  let bestDist = Infinity
  for (const pt of fastCanvasData) {
    if (pt.hidden) continue
    const cp = m.latLngToContainerPoint([pt.lat, pt.lng])
    const dx = cp.x - containerPoint.x
    const dy = cp.y - containerPoint.y
    const hitRadius = pt.isCluster ? 18 : HIT_RADIUS
    const r2 = hitRadius * hitRadius
    const d2 = dx * dx + dy * dy
    if (d2 <= r2 && d2 < bestDist) {
      best = pt
      bestDist = d2
    }
  }
  return best
}

function findNearbyCanvasPoint(containerPoint, maxRadiusPx = 22) {
  const m = map
  if (!m || !containerPoint || !Array.isArray(fastCanvasData) || fastCanvasData.length === 0) return null
  let best = null
  let bestDist = Infinity
  const maxR2 = maxRadiusPx * maxRadiusPx
  for (const pt of fastCanvasData) {
    if (!pt || pt.hidden) continue
    const cp = m.latLngToContainerPoint([pt.lat, pt.lng])
    const dx = cp.x - containerPoint.x
    const dy = cp.y - containerPoint.y
    const d2 = dx * dx + dy * dy
    if (d2 <= maxR2 && d2 < bestDist) {
      best = pt
      bestDist = d2
    }
  }
  return best
}

function getSpeciesNamesForMapPoint(pt) {
  if (!pt) return []
  const direct = Array.isArray(pt?.speciesList)
    ? pt.speciesList.map((name) => String(name || '').trim()).filter(Boolean)
    : []
  if (direct.length > 0) return Array.from(new Set(direct))

  const itemLocKey = String(pt?.locKey || getLocationKeyForItem(pt?.item) || '').trim()
  if (!itemLocKey) return []
  const entries = Array.isArray(lastPopupLocationIndexAllSpecies?.get?.(itemLocKey))
    ? lastPopupLocationIndexAllSpecies.get(itemLocKey)
    : []
  const fromIndex = entries
    .map((entry) => String(entry?.species || '').trim())
    .filter(Boolean)
  return Array.from(new Set(fromIndex))
}

function applyMapPointSpeciesFilter(pt) {
  const names = getSpeciesNamesForMapPoint(pt)
  if (!Array.isArray(names) || names.length === 0) return
  selectedSpecies = null
  mapPointSpeciesFilter = new Set(names)
  applyActiveFiltersAndRender({ renderMap: false, allowAutoRecovery: false })
}

function handleMapPointTap(containerPoint) {
  if (!map || !containerPoint) return false

  let pt = null
  if (fastCanvasData.length > 0) {
    pt = hitTestCanvas(containerPoint) || findNearbyCanvasPoint(containerPoint, 22)
  }
  if (!pt) return false

  if (pt.isCluster && map) {
    const isCountyView = isCountyRegionCode(String(currentActiveCountyCode || '').toUpperCase())
    const nextZoom = isCountyView
      ? Math.max(map.getZoom() + 2, COUNTY_EXPLODE_ZOOM)
      : Math.max(map.getZoom() + 2, CLUSTER_ZOOM_THRESHOLD + 1)
    map.setView([pt.lat, pt.lng], nextZoom, { animate: true })
    return true
  }

  const key = getCanvasPopupKey(pt)
  if (key && fastCanvasPopup && fastCanvasPopupKey === key) {
    fastCanvasPopup.remove()
    fastCanvasPopup = null
    fastCanvasPopupKey = null
    return true
  }

  applyMapPointSpeciesFilter(pt)
  openObservationPopup(pt)
  return true
}

function buildObservationPopupHtml(pt, options = {}) {
  if (!pt) return ''
  const hideHeader = Boolean(options?.hideHeader)
  const item = pt.item
  const locId = item?.locId ? String(item.locId) : null
  const locName = item?.locName ? String(item.locName) : ''
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${pt.lat},${pt.lng}`)}`
  const speciesList = Array.isArray(pt?.speciesList) ? pt.speciesList : []
  const speciesCount = speciesList.length

  const fallbackLocKey = `${Number(pt.lat).toFixed(4)}|${Number(pt.lng).toFixed(4)}`
  const ptLocKey = String(pt.locKey || locId || fallbackLocKey)

  // Prefer the broader index so a species-focused popup can still show
  // other notable species at the same location.
  const locObsAll = Array.isArray(lastPopupLocationIndexAllSpecies?.get?.(ptLocKey))
    ? lastPopupLocationIndexAllSpecies.get(ptLocKey)
    : (Array.isArray(lastMapLocationIndex?.get?.(ptLocKey)) ? lastMapLocationIndex.get(ptLocKey) : [])

  const focusSpecies = (() => {
    const needle = String(selectedSpecies || '').trim()
    if (needle && locObsAll.some((o) => String(o?.species || '') === needle)) return needle
    if (speciesCount === 1) return String(speciesList[0] || '').trim() || null
    return null
  })()

  const header = (() => {
    if (hideHeader) return ''
    if (focusSpecies) {
      const name = escapeHtml(focusSpecies)
      const showCode = shouldShowSpeciesAlphaCodes()
      const codeHtml = showCode ? `<span class="obs-popup-code">${escapeHtml(getSpeciesMapLabel(focusSpecies))}</span>` : ''
      return `<div class="obs-popup-header">${codeHtml}<span class="obs-popup-species obs-popup-species-small">${name}</span></div>`
    }
    const label = escapeHtml(speciesCount === 1 ? String(speciesList[0] || '') : `${speciesCount || 0} species`)
    return `<div class="obs-popup-header"><span class="obs-popup-species">${label}</span></div>`
  })()

  const countyRaw = item?.subnational2Name ? String(item.subnational2Name) : ''
  const stateRaw = item?.subnational1Code ? String(item.subnational1Code) : ''
  const stateAbbrev = stateRaw.toUpperCase().startsWith('US-') ? stateRaw.toUpperCase().slice(3) : stateRaw.toUpperCase()
  let countyDisplay = countyRaw.trim()
  if (countyDisplay && !/county\s*$/i.test(countyDisplay)) countyDisplay = `${countyDisplay} County`
  const countyStateText = (countyDisplay && stateAbbrev) ? `${countyDisplay}, ${stateAbbrev}` : ''

  const locationLink = locName
    ? (() => {
      const hotspot = locId
        ? `<a class="obs-popup-location" href="https://ebird.org/hotspot/${encodeURIComponent(locId)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(locName)}">${escapeHtml(locName)}</a>`
        : `<span class="obs-popup-location" title="${escapeHtml(locName)}">${escapeHtml(locName)}</span>`
      return `<span class="obs-popup-location-wrap">${hotspot}<a class="obs-popup-mapit" href="${mapsUrl}" target="_blank" rel="noopener noreferrer" title="Map it">&#x1F4CD;</a></span>`
    })()
    : ''

  const metaParts = []
  if (countyStateText) metaParts.push(`<span class="obs-popup-county">${escapeHtml(countyStateText)}</span>`)
  if (locationLink) metaParts.push(locationLink)
  const metaLine = metaParts.length ? `<div class="obs-popup-meta">${metaParts.join(' · ')}</div>` : ''

  const speciesMetaLine = (() => {
    if (!hideHeader || !focusSpecies) return ''
    const species = String(focusSpecies || '').trim()
    if (!species) return ''

    const row = Array.isArray(currentTableData)
      ? currentTableData.find((entry) => String(entry?.species || '') === species)
      : null
    const scientificName = String(row?.scientificName || getScientificNameForSpecies(species)?.name || '').trim()
    const avibase = getAvibaseNlChecklistInfo(species, scientificName)
    const avibaseStatusEn = String(avibase?.statusEn || '').trim()
    const isConfirmed = row ? Boolean(row.confirmedAny) : false
    const statusParts = [isConfirmed ? 'Confirmed' : 'Unconfirmed']
    if (avibaseStatusEn) statusParts.push(avibaseStatusEn)
    const statusCls = isConfirmed ? 'status-dot-confirmed' : 'status-dot-pending'

    const latinHtml = scientificName
      ? `<span class="obs-popup-latin">${escapeHtml(scientificName)}</span>`
      : ''
    const statusHtml = `<span class="obs-popup-status"><span class="status-dot ${statusCls}" aria-hidden="true"></span><span>${escapeHtml(statusParts.join(' · '))}</span></span>`
    return `<div class="obs-popup-species-meta">${latinHtml}${statusHtml}</div>`
  })()

  // Observation bullets: all observations from the past 7 days for focused
  // species (or overall at this location if no focused species).
  const sevenDayCutoff = cutoffDateForDaysBack(7)
  const focusNeedle = focusSpecies ? String(focusSpecies) : ''
  const locFocusObs = focusNeedle ? locObsAll.filter((o) => String(o?.species || '') === focusNeedle) : locObsAll
  const nearbyFocusObs = focusNeedle ? getNearbySpeciesObservations(pt, focusNeedle, nearbyObservationRadiusKm) : []
  const focusObs = (focusNeedle
    ? (nearbyFocusObs.length > 0 ? nearbyFocusObs : locFocusObs)
    : locFocusObs)
    .filter((o) => {
      const parsed = parseObsDate(o?.obsDt)
      return Boolean(parsed && parsed >= sevenDayCutoff)
    })
    .slice()
    .sort((a, b) => {
      const aMs = parseObsDate(a?.obsDt)?.getTime?.() ?? 0
      const bMs = parseObsDate(b?.obsDt)?.getTime?.() ?? 0
      if (aMs !== bMs) return bMs - aMs
      return String(a?.subId || '').localeCompare(String(b?.subId || ''))
    })

  const renderObsBullet = (o) => {
    if (!o) return ''
    const dt = formatObsDateTimeByRegion(o?.obsDt)
    const sid = o?.subId ? String(o.subId) : ''
    if (sid) {
      const label = `${escapeHtml(dt)} - list`
      return `<li><a href="https://ebird.org/checklist/${encodeURIComponent(sid)}" target="_blank" rel="noopener noreferrer">${label}</a></li>`
    }
    return `<li><span>${escapeHtml(dt)} - list unavailable</span></li>`
  }

  const obsBullets = focusObs.map((o) => renderObsBullet(o)).filter(Boolean)
  const obsSection = obsBullets.length
    ? `<ul class="obs-popup-checklist">${obsBullets.join('')}</ul>`
    : '<ul class="obs-popup-checklist"><li>No observations in past 7 days.</li></ul>'

  // Other notable species at this location (even when in single-species view)
  const otherSpeciesSection = (() => {
    const allSpeciesHere = Array.from(new Set(locObsAll.map((o) => String(o?.species || '').trim()).filter(Boolean)))
    const others = allSpeciesHere.filter((sp) => !focusNeedle || sp !== focusNeedle)
    if (others.length === 0) return ''

    const maxAbaBySpecies = new Map()
    const lastMsBySpecies = new Map()
    for (const o of locObsAll) {
      const sp = String(o?.species || '').trim()
      if (!sp) continue
      const code = Number(o?.abaCode)
      if (Number.isFinite(code)) {
        const prev = maxAbaBySpecies.get(sp)
        if (!Number.isFinite(prev) || code > prev) maxAbaBySpecies.set(sp, code)
      }
      const ms = parseObsDate(o?.obsDt)?.getTime?.() ?? 0
      const prevMs = lastMsBySpecies.get(sp) || 0
      if (ms > prevMs) lastMsBySpecies.set(sp, ms)
    }

    others.sort((a, b) => {
      const aCode = maxAbaBySpecies.get(a)
      const bCode = maxAbaBySpecies.get(b)
      const aNum = Number.isFinite(aCode) ? aCode : -1
      const bNum = Number.isFinite(bCode) ? bCode : -1
      if (aNum !== bNum) return bNum - aNum
      const aMs = lastMsBySpecies.get(a) || 0
      const bMs = lastMsBySpecies.get(b) || 0
      if (aMs !== bMs) return bMs - aMs
      return String(a).localeCompare(String(b))
    })

    const items = others.map((sp) => {
      const name = escapeHtml(sp)
      const showCode = shouldShowSpeciesAlphaCodes()
      const codeHtml = showCode ? `<span class="obs-popup-code">${escapeHtml(getSpeciesMapLabel(sp))}</span> ` : ''
      return `<li><a class="js-switch-species" href="#" data-species="${escapeHtml(sp)}" data-loc-key="${escapeHtml(ptLocKey)}" data-lat="${escapeHtml(pt.lat)}" data-lng="${escapeHtml(pt.lng)}">${codeHtml}<span class="obs-popup-other-name">${name}</span></a></li>`
    })

    return `<div class="obs-popup-section-title">Other notable species at location:</div><ul class="obs-popup-checklist obs-popup-other">${items.join('')}</ul>`
  })()

  return `<div class="obs-popup-inner" data-loc-key="${escapeHtml(ptLocKey)}">${header}${speciesMetaLine}${metaLine}${obsSection}${otherSpeciesSection}</div>`
}

function openObservationPopup(pt) {
  if (!map || !pt) return
  if (speciesDetailPanel && !speciesDetailPanel.hasAttribute('hidden')) {
    speciesDetailPanel.setAttribute('hidden', 'hidden')
  }
  const html = buildObservationPopupHtml(pt)
  if (!html) return
  ensurePopupSpeciesSwitchHandler()
  if (!fastCanvasPopup) fastCanvasPopup = L.popup({ maxWidth: 260, className: 'obs-popup' })
  fastCanvasPopupKey = getCanvasPopupKey(pt)
  fastCanvasPopup.setLatLng([pt.lat, pt.lng]).setContent(html).openOn(map)
}

let _popupSpeciesSwitchInstalled = false
function ensurePopupSpeciesSwitchHandler() {
  if (_popupSpeciesSwitchInstalled) return
  _popupSpeciesSwitchInstalled = true
  document.addEventListener('click', (event) => {
    const link = event.target?.closest?.('.obs-popup a.js-switch-species')
    if (!link) return
    event.preventDefault()
    const species = String(link.dataset.species || '').trim()
    const locKey = String(link.dataset.locKey || '').trim()
    const lat = Number(link.dataset.lat)
    const lng = Number(link.dataset.lng)
    if (!species) return

    selectedSpecies = species
    applyActiveFiltersAndRender({ allowAutoRecovery: false })

    if (!map) return
    const pts = speciesMarkers.get(species)
    if (!pts || pts.length === 0) return
    const targetPt = (locKey
      ? (pts.find((p) => String(p?.locKey || '') === locKey) || null)
      : null) || (Number.isFinite(lat) && Number.isFinite(lng)
      ? (pts.find((p) => Math.abs(Number(p?.lat) - lat) < 1e-6 && Math.abs(Number(p?.lng) - lng) < 1e-6) || null)
      : null) || pickBestSpeciesPoint(pts, species)

    if (targetPt) {
      ensureSpeciesZoomLabelsVisible()
      map.invalidateSize()
      map.setView([targetPt.lat, targetPt.lng], Math.max(map.getZoom(), 13), { animate: true })
      if (fastCanvasPopup) { fastCanvasPopup.remove(); fastCanvasPopup = null }
      fastCanvasPopupKey = null
      window.setTimeout(() => openSpeciesDetailForSelection(species, targetPt), 80)
    }
  })
}

function pickBestSpeciesPoint(points, speciesName = '') {
  if (!Array.isArray(points) || points.length === 0) return null
  if (points.length === 1) return points[0]
  const needle = String(speciesName || '')
  const toMs = (pt) => {
    if (needle && pt?.speciesLastMs instanceof Map) {
      const ms = pt.speciesLastMs.get(needle)
      if (Number.isFinite(ms)) return ms
    }
    const list = Array.isArray(pt?.subDates) ? pt.subDates : []
    let best = 0
    list.forEach((raw) => {
      const parsed = parseObsDate(raw)
      const ms = parsed ? parsed.getTime() : 0
      if (ms > best) best = ms
    })
    return best
  }
  return points.reduce((best, current) => (toMs(current) > toMs(best) ? current : best), points[0])
}

// Install a single map click handler once
let _canvasClickInstalled = false
function ensureCanvasClickHandler() {
  if (_canvasClickInstalled) return
  _canvasClickInstalled = true
  // We listen on the map container directly so we get clicks through the canvas
  document.querySelector('#map')?.addEventListener('click', (e) => {
    if (!map) return
    const rect = map.getContainer().getBoundingClientRect()
    const cp = L.point(e.clientX - rect.left, e.clientY - rect.top)
    if (mapMeasureMode) {
      const latlng = map.containerPointToLatLng(cp)
      addMeasurePoint(latlng)
      e.stopPropagation()
      return
    }
    if (handleMapPointTap(cp)) {
      e.stopPropagation()
      return
    }

    const latlng = map.containerPointToLatLng(cp)
    const neighborFeature = findNeighborCountyFeatureAtLatLng(latlng.lat, latlng.lng)
    if (neighborFeature) {
      const region = String(
        neighborFeature?.properties?.countyRegion
        || neighborFeature?.properties?.subnational2Code
        || neighborFeature?.properties?.subnational1Code
        || ''
      ).toUpperCase() || null
      const name = neighborFeature?.properties?.countyName || neighborFeature?.properties?.NAME || neighborFeature?.properties?.name || ''
      const blockPolygonSwitch = shouldBlockPolygonSwitch(region)
      if (fastCanvasPopup) { fastCanvasPopup.remove(); fastCanvasPopup = null }
      fastCanvasPopupKey = null
      if (blockPolygonSwitch) return
      switchCountyFromMapTap(region, latlng.lat, latlng.lng, name, 'canvas-fallback')
      return
    }

    const blockPolygonSwitch = shouldBlockPolygonSwitch()
    if (blockPolygonSwitch || (hasRenderedMapPoints() && isTapInsideActiveCounty(latlng.lat, latlng.lng))) {
      if (fastCanvasPopup) { fastCanvasPopup.remove(); fastCanvasPopup = null }
      fastCanvasPopupKey = null
      return
    }

    if (fastCanvasPopup) { fastCanvasPopup.remove(); fastCanvasPopup = null }
    fastCanvasPopupKey = null
  })
}

function clearMeasureLayers() {
  if (mapMeasureLineLayer && map) map.removeLayer(mapMeasureLineLayer)
  if (mapMeasureLabelMarker && map) map.removeLayer(mapMeasureLabelMarker)
  mapMeasureLineLayer = null
  mapMeasureLabelMarker = null
}

function formatMeasureDistance(totalMeters) {
  const meters = Number(totalMeters)
  if (!Number.isFinite(meters) || meters <= 0) return '0 m'
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(2)} km`
}

function updateMeasurePolyline() {
  if (!map) return
  clearMeasureLayers()
  if (!Array.isArray(mapMeasurePoints) || mapMeasurePoints.length === 0) return

  if (mapMeasurePoints.length > 1) {
    mapMeasureLineLayer = L.polyline(mapMeasurePoints, {
      color: '#2563eb',
      weight: 3,
      opacity: 0.95,
      pane: 'notablePane',
    }).addTo(map)
  }

  let totalMeters = 0
  for (let index = 1; index < mapMeasurePoints.length; index += 1) {
    totalMeters += mapMeasurePoints[index - 1].distanceTo(mapMeasurePoints[index])
  }
  const label = formatMeasureDistance(totalMeters)
  const lastPoint = mapMeasurePoints[mapMeasurePoints.length - 1]
  mapMeasureLabelMarker = L.marker(lastPoint, {
    pane: 'notablePane',
    interactive: false,
    icon: L.divIcon({
      className: 'map-measure-label',
      html: `<span>${escapeHtml(label)}</span>`,
      iconSize: null,
    }),
  }).addTo(map)
}

function setMeasureMode(active) {
  mapMeasureMode = Boolean(active)
  if (!mapMeasureBtn) return
  mapMeasureBtn.setAttribute('aria-pressed', mapMeasureMode ? 'true' : 'false')
  mapMeasureBtn.classList.toggle('active', mapMeasureMode)
  mapMeasureBtn.title = mapMeasureMode ? 'Stop measuring' : 'Measure distance'
}

function addMeasurePoint(latlng) {
  if (!latlng) return
  mapMeasurePoints.push(latlng)
  updateMeasurePolyline()
}

function resetMeasureTool() {
  mapMeasurePoints = []
  clearMeasureLayers()
}
// ---------------------------------------------------------------------------

function renderNotablesOnMap(observations, activeCountyCode = '', fitToObservations = false) {
  initializeMap()
  perfStart('map')

  const renderId = ++latestMapRenderId

  const totalPoints = Array.isArray(observations) ? observations.length : 0
  const showPermanentLabels = labelMode !== 'off' && totalPoints <= MAP_LABEL_MAX_POINTS

  // Build an index of *all* observations at each location for popup display,
  // while also aggregating per-location metadata for rendering one point per
  // location (avoids overlapping labels when multiple species share a hotspot).
  const locationIndex = new Map() // locKey -> { seen:Set, items:Array, speciesSet:Set, speciesAbaMax:Map, speciesLastMs:Map, maxAba, repItem, lat, lng }
  if (Array.isArray(observations)) {
    for (const item of observations) {
      const lat = Number(item?.lat)
      const lng = Number(item?.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const species = String(item?.comName || 'Unknown species')
      const locId = item?.locId ? String(item.locId) : ''
      const locKey = locId || `${lat.toFixed(4)}|${lng.toFixed(4)}`
      if (!locationIndex.has(locKey)) {
        locationIndex.set(locKey, {
          seen: new Set(),
          items: [],
          speciesSet: new Set(),
          speciesAbaMax: new Map(),
          speciesLastMs: new Map(),
          maxAba: null,
          repItem: item,
          lat,
          lng,
        })
      }
      const bucket = locationIndex.get(locKey)
      bucket.lat = Number.isFinite(bucket.lat) ? bucket.lat : lat
      bucket.lng = Number.isFinite(bucket.lng) ? bucket.lng : lng

      bucket.speciesSet.add(species)

      const code = getAbaCodeNumber(item)
      if (Number.isFinite(code)) {
        if (!Number.isFinite(bucket.maxAba) || code > bucket.maxAba) {
          bucket.maxAba = code
          bucket.repItem = item
        }
        const existingMax = bucket.speciesAbaMax.get(species)
        if (!Number.isFinite(existingMax) || code > existingMax) bucket.speciesAbaMax.set(species, code)
      }

      const obsDtRaw = item?.obsDt ? String(item.obsDt) : ''
      const parsed = obsDtRaw ? parseObsDate(obsDtRaw) : null
      const ms = parsed ? parsed.getTime() : 0
      if (ms > 0) {
        const existingMs = bucket.speciesLastMs.get(species) || 0
        if (ms > existingMs) bucket.speciesLastMs.set(species, ms)
      }

      const subId = item?.subId ? String(item.subId) : ''
      const uniq = `${species}|${subId}|${obsDtRaw}`
      if (bucket.seen.has(uniq)) continue
      bucket.seen.add(uniq)
      bucket.items.push({
        species,
        abaCode: code,
        obsDt: obsDtRaw || null,
        subId: subId || null,
      })
    }
  }

  const locationPoints = Array.from(locationIndex.entries()).map(([locKey, bucket]) => {
    const speciesList = Array.from(bucket?.speciesSet || []).filter(Boolean)
      .sort((a, b) => {
        const aCode = bucket?.speciesAbaMax?.get?.(a)
        const bCode = bucket?.speciesAbaMax?.get?.(b)
        const aNum = Number.isFinite(aCode) ? aCode : -1
        const bNum = Number.isFinite(bCode) ? bCode : -1
        if (aNum !== bNum) return bNum - aNum
        return String(a).localeCompare(String(b))
      })

    return {
      locKey,
      lat: bucket.lat,
      lng: bucket.lng,
      maxAba: Number.isFinite(bucket.maxAba) ? bucket.maxAba : null,
      item: bucket.repItem || null,
      speciesList,
      speciesLastMs: bucket.speciesLastMs instanceof Map ? bucket.speciesLastMs : new Map(),
    }
  })

  // Signature dedup — skip if nothing changed and we're not force-fitting
  let signatureHash = 0
  for (const { lat, lng, maxAba } of locationPoints) {
    const code = Number.isFinite(maxAba) ? maxAba : 0
    signatureHash = ((signatureHash * 33) ^ (Math.round(lat * 10000) + Math.round(lng * 10000) + code)) >>> 0
  }
  const renderSignature = `${activeCountyCode}|${locationPoints.length}|${signatureHash}|${labelMode}`
  if (!fitToObservations && renderSignature === lastMapRenderSignature) {
    syncPolygonBlockDebugBadge()
    perfEnd('map')
    return
  }
  lastMapRenderSignature = renderSignature

  // Build lightweight data objects — no Leaflet marker construction
  const nextData = []
  const nextSpeciesMap = new Map()  // species → [{lat,lng}] for table row highlight
  for (const loc of locationPoints) {
    const lat = Number(loc?.lat)
    const lng = Number(loc?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const abaCode = Number.isFinite(loc?.maxAba) ? loc.maxAba : null
    const colors = ABA_COLORS[abaCode] || ABA_DEFAULT_COLOR
    const item = loc?.item || null
    const locKey = String(loc?.locKey || '')
    const speciesList = Array.isArray(loc?.speciesList) ? loc.speciesList : []

    const itemCounty = String(item?.subnational2Code || '').toUpperCase()
    const isInActiveCounty = !activeCountyCode || itemCounty === activeCountyCode

    const label = (() => {
      if (!isInActiveCounty || !showPermanentLabels) return null
      if (labelMode === 'full') {
        return speciesList.length === 1 ? speciesList[0] : `${speciesList.length} spp`
      }
      // Abbrev mode: show a short multi-species label without spamming overlays.
      const maxParts = 2
      const parts = speciesList.slice(0, maxParts).map((name) => {
        if (!shouldShowSpeciesAlphaCodes()) return String(name || '')
        return getSpeciesMapLabel(name)
      })
      const remaining = speciesList.length - parts.length
      return `${parts.join(' ')}${remaining > 0 ? ` +${remaining}` : ''}`.trim() || null
    })()

    const pt = {
      lat,
      lng,
      fill: colors.fill,
      border: colors.border,
      abaCode,
      item,
      label,
      hidden: false,
      locKey,
      speciesList,
      speciesLastMs: loc?.speciesLastMs instanceof Map ? loc.speciesLastMs : new Map(),
    }

    nextData.push(pt)
    speciesList.forEach((name) => {
      if (!name) return
      if (!nextSpeciesMap.has(name)) nextSpeciesMap.set(name, [])
      nextSpeciesMap.get(name).push(pt)
    })
  }

  if (renderId !== latestMapRenderId) { perfEnd('map'); return }

  // Swap in new data and redraw the single canvas layer
  fastCanvasBaseData = nextData
  fastCanvasData = nextData
  // Publish location index for popup rendering.
  lastMapLocationIndex = new Map()
  locationIndex.forEach((bucket, key) => {
    lastMapLocationIndex.set(key, Array.isArray(bucket?.items) ? bucket.items : [])
  })
  speciesMarkers = nextSpeciesMap   // reuse same variable — callers key on species name
  hiddenSpecies = new Set()
  const toggleAllEl = document.querySelector('#toggleAllVis')
  if (toggleAllEl) { toggleAllEl.checked = true; toggleAllEl.indeterminate = false }

  if (!fastCanvasOverlay) {
    fastCanvasOverlay = buildFastCanvasOverlay()
    fastCanvasOverlay.addTo(map)
    ensureCanvasClickHandler()
  } else {
    fastCanvasOverlay.redraw()
  }

  // Remove old Leaflet featureGroup layer if present from a previous render
  if (notableLayer) { map.removeLayer(notableLayer); notableLayer = null }

  syncPolygonBlockDebugBadge()

  perfEnd('map')

  if (fitToObservations && nextData.length > 0) {
    const lats = nextData.map((p) => p.lat)
    const lngs = nextData.map((p) => p.lng)
    const bounds = L.latLngBounds(
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)]
    )
    if (bounds.isValid()) {
      const effectiveMaxZoom = (typeof mapFitMaxZoomOnce === 'number' && Number.isFinite(mapFitMaxZoomOnce))
        ? mapFitMaxZoomOnce
        : MAP_POINTS_FIT_MAX_ZOOM
      mapFitMaxZoomOnce = null
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: effectiveMaxZoom, animate: false })
    }
  }
}

function recomputeCanvasVisibilityFromHiddenSpecies() {
  const hidden = hiddenSpecies instanceof Set ? hiddenSpecies : new Set()
  const base = Array.isArray(fastCanvasBaseData) ? fastCanvasBaseData : []
  base.forEach((pt) => {
    const list = Array.isArray(pt?.speciesList) ? pt.speciesList : []
    // Hide a location point only if *all* of its species are hidden.
    pt.hidden = list.length ? list.every((name) => hidden.has(String(name))) : false
  })
  fastCanvasOverlay?.redraw()
  syncPolygonBlockDebugBadge()
}

function formatNearbyRadiusLabel(km) {
  const value = Number(km)
  if (!Number.isFinite(value) || value <= 0) return '1km'
  if (value < 1) return `${Math.round(value * 1000)}m`
  return `${value}km`
}

function syncNearbyRadiusButtonUi() {
  if (!mapNearbyRadiusBtn) return
  const label = formatNearbyRadiusLabel(nearbyObservationRadiusKm)
  mapNearbyRadiusBtn.textContent = label
  mapNearbyRadiusBtn.title = `Nearby radius: ${label}`
  mapNearbyRadiusBtn.setAttribute('aria-label', `Nearby observations radius ${label}`)
}

function cycleNearbyObservationRadius() {
  const options = Array.isArray(nearbyObservationRadiusOptionsKm) && nearbyObservationRadiusOptionsKm.length
    ? nearbyObservationRadiusOptionsKm
    : [1]
  const current = Number(nearbyObservationRadiusKm)
  const index = options.findIndex((value) => Math.abs(Number(value) - current) < 1e-9)
  const next = options[(index >= 0 ? index + 1 : 0) % options.length]
  nearbyObservationRadiusKm = Number(next)
  syncNearbyRadiusButtonUi()

  if (speciesDetailPanel && !speciesDetailPanel.hasAttribute('hidden') && selectedSpecies) {
    const points = Array.isArray(speciesMarkers.get(String(selectedSpecies))) ? speciesMarkers.get(String(selectedSpecies)) : []
    const currentLocKey = String(speciesDetailBody?.querySelector?.('.obs-popup-inner')?.dataset?.locKey || '')
    const targetPt = points.find((pt) => String(pt?.locKey || '') === currentLocKey) || pickBestSpeciesPoint(points, String(selectedSpecies))
    if (targetPt) {
      speciesDetailBody.innerHTML = buildObservationPopupHtml(targetPt, { hideHeader: true })
      void updateSpeciesDetailFrequencyCharts(String(selectedSpecies), targetPt)
    }
  }
}

async function loadCountyNotables(latitude, longitude, countyRegion = null, requestId = null, countySwitchRequestId = null, allowStateFallback = false) {
  perfStart('fetch')
  const notablesLoadId = ++latestNotablesLoadId
  const effectiveDaysBack = Math.max(1, Math.min(14, Number(filterDaysBack) || 7))
  const previousObservations = Array.isArray(currentRawObservations) ? currentRawObservations.slice() : []
  const previousCountyNameState = currentCountyName
  const previousCountyRegionState = currentCountyRegion
  const previousActiveCountyCodeState = currentActiveCountyCode
  const normalizedTargetRegion = String(countyRegion || '').toUpperCase() || null
  const normalizedPreviousRegion = String(previousCountyRegionState || '').toUpperCase() || null
  const isExplicitCountySwitch = countySwitchRequestId !== null && Boolean(normalizedTargetRegion) && normalizedTargetRegion !== normalizedPreviousRegion
  // Detect LEAF country province regions (e.g. 'NL-GR'). These use subnational1Code,
  // not subnational2Code, and must NOT call the US-only county_notables API.
  const isLeafProvinceRegion = Boolean(normalizedTargetRegion) && (() => { const p = normalizedTargetRegion.split('-'); return p.length === 2 && LEAF_SUBNATIONAL1_COUNTRIES.has(p[0]) })()
  const previousCountText = notableCount.textContent
  const previousMetaText = notableMeta.textContent
  const previousRowsHtml = notableRows.innerHTML
  const previousRenderStatus = tableRenderStatus?.textContent || ''
  const hadPreviousRows = /<tr[\s>]/i.test(previousRowsHtml) && !/(Loading county notables|request timed out|did not complete|not available right now|No notable observations found)/i.test(previousRowsHtml)
  let cachedWarm = !hadPreviousRows ? loadNotablesCache(countyRegion) : null
  let warmSource = null
  let hasCachedWarm = Array.isArray(cachedWarm?.observations) && cachedWarm.observations.length > 0
  let skipNetworkFetch = false

  // If we have a state-level cache that covers the requested daysBack, use it
  // to serve county switches without additional API calls.
  if (!hasCachedWarm && !hadPreviousRows && normalizedTargetRegion && isCountyRegionCode(normalizedTargetRegion)) {
    const stateRegion = stateRegionFromCountyRegion(normalizedTargetRegion)
    const stateCached = stateRegion ? loadNotablesCache(stateRegion) : null
    const stateDays = getCacheDaysBack(stateCached)
    if (stateRegion && Array.isArray(stateCached?.observations) && stateCached.observations.length > 0 && Number.isFinite(stateDays) && stateDays >= effectiveDaysBack) {
      const scoped = stateCached.observations.filter((item) => String(isLeafProvinceRegion ? (item?.subnational1Code || '') : (item?.subnational2Code || '')).toUpperCase() === normalizedTargetRegion)
      if (scoped.length > 0) {
        cachedWarm = {
          observations: scoped,
          countyName: String(isLeafProvinceRegion ? (scoped[0]?.subnational1Name || '') : (scoped[0]?.subnational2Name || '')) || null,
          countyRegion: normalizedTargetRegion,
          sourceStrategy: 'state-cache-client',
          __meta: { daysBack: stateDays, fromState: stateRegion },
        }
        hasCachedWarm = true
        warmSource = 'state'
        skipNetworkFetch = true
      }
    }
  }

  if (hasCachedWarm && !warmSource) warmSource = 'county'

  setMapLoading(true, 'Loading notable observations…')
  setTableRenderStatus('load-start')
  if (hasCachedWarm) {
    currentRawObservations = cachedWarm.observations
    currentCountyName = cachedWarm?.countyName || null
    currentCountyRegion = cachedWarm?.countyRegion || countyRegion || null
    currentActiveCountyCode = (cachedWarm?.countyRegion || countyRegion || '').toUpperCase()
    rememberLastGoodObservations(currentRawObservations, currentCountyName, currentCountyRegion, currentActiveCountyCode)
    refreshCountyPickerSummaries()
    const warmFiltered = applyActiveFiltersAndRender({ renderMap: false })
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    if (!isStaleNotablesLoad(notablesLoadId, requestId, countySwitchRequestId)) {
      setMapLoading(true, 'Rendering map points…')
      renderNotablesOnMap(warmFiltered, currentActiveCountyCode, true)
      maybeApplyHiResOnCountyLoad()
    }
    notableMeta.textContent = `${notableMeta.textContent} · ${warmSource === 'state' ? 'state-cached' : 'cached'}`
    setTableRenderStatus(`cache-warm rows=${cachedWarm.observations.length}`)
    markMapPartReady('observations')

    if (skipNetworkFetch) {
      perfEnd('fetch')
      setMapLoading(false)
      // Ensure we still fill the broader state cache in the background (e.g., 14d)
      // so future navigation stays offline.
      const stateRegion = normalizedTargetRegion ? stateRegionFromCountyRegion(normalizedTargetRegion) : null
      if (stateRegion) void prefetchStateRarities(stateRegion, statePrefetchDaysBack)
      updateRuntimeLog()
      return
    }
  } else {
    notableCount.className = 'badge warn'
    notableCount.textContent = hadPreviousRows ? 'Refreshing…' : 'Loading…'
    notableMeta.textContent = hadPreviousRows ? 'Refreshing county notables…' : 'Loading county notables…'
  }
  if (!hadPreviousRows && !hasCachedWarm) {
    updateStatPills('…', '…', '…')
    notableRows.innerHTML = '<tr><td colspan="8">Loading county notables…</td></tr>'
  }

  const loadingWatchdog = window.setTimeout(() => {
    if (isStaleNotablesLoad(notablesLoadId, requestId, countySwitchRequestId)) return
    if (notableCount.textContent !== 'Loading…' && notableCount.textContent !== 'Refreshing…') return
    if (hadPreviousRows) {
      if (!isExplicitCountySwitch) {
        notableCount.className = 'badge ok'
        notableCount.textContent = previousCountText
        notableMeta.textContent = `${previousMetaText} · refresh-timeout`
        notableRows.innerHTML = previousRowsHtml
        if (tableRenderStatus) {
          tableRenderStatus.textContent = previousRenderStatus || 'render: refresh-timeout-restored'
        }
        markMapPartReady('observations')
        return
      }
    }
    notableCount.className = 'badge warn'
    notableCount.textContent = '0'
    notableMeta.textContent = 'County notables request timed out'
    updateStatPills('0', '0', '0')
    notableRows.innerHTML = '<tr><td colspan="8">County notables request timed out. Try refresh or Use My Location again.</td></tr>'
    setTableRenderStatus('watchdog-timeout')
    markMapPartReady('observations')
  }, 9000)

  try {
    let result = null
    let observations = []
    let strategy = null

    if (isLeafProvinceRegion) {
      // LEAF country provinces (e.g. NL-GR) must not call the US-only county_notables API.
      // Load state-level notables and filter locally by subnational1Code.
      const leafStateRegion = stateRegionFromCountyRegion(normalizedTargetRegion)
      if (leafStateRegion) {
        const stateData = await fetchRegionRarities(leafStateRegion, effectiveDaysBack)
        const leafFiltered = Array.isArray(stateData)
          ? stateData.filter((item) => String(item?.subnational1Code || '').toUpperCase() === normalizedTargetRegion)
          : []
        if (leafFiltered.length > 0) {
          observations = leafFiltered
          strategy = 'state-filter-leaf'
          result = {
            countyName: String(leafFiltered[0]?.subnational1Name || '') || null,
            countyRegion: normalizedTargetRegion,
            sourceStrategy: strategy,
          }
        }
      }
    } else {
      // Fire primary (with countyRegion) and generic fallback concurrently so we
      // don't stack two sequential 5 s timeouts when the primary is slow/failing.
      const needFallback = !countyRegion // if no region provided, only one fetch needed
      const primaryPromise = fetchCountyNotablesWithRetry(latitude, longitude, effectiveDaysBack, countyRegion, 1).catch((e) => { console.warn('Primary county notables failed:', e); return null })
      const fallbackPromise = needFallback
        ? primaryPromise
        : fetchCountyNotablesWithRetry(latitude, longitude, effectiveDaysBack, null, 1).catch((e) => { console.warn('Fallback county notables failed:', e); return null })

      const [primaryResult, fallbackResult] = await Promise.all([primaryPromise, fallbackPromise])

      const primaryObs = Array.isArray(primaryResult?.observations) ? primaryResult.observations : []
      const fallbackObs = Array.isArray(fallbackResult?.observations) ? fallbackResult.observations : []

      if (countyRegion) {
        if (primaryResult && primaryObs.length > 0) {
          result = primaryResult
          observations = primaryObs
          strategy = primaryResult?.sourceStrategy || 'county-region'
        } else if (fallbackResult && fallbackObs.length > 0) {
          result = fallbackResult
          observations = fallbackObs
          strategy = fallbackResult?.sourceStrategy || 'county-fallback'
        } else if (primaryResult) {
          result = primaryResult
          observations = primaryObs
          strategy = primaryResult?.sourceStrategy || 'county-region'
        } else if (fallbackResult) {
          result = fallbackResult
          observations = fallbackObs
          strategy = fallbackResult?.sourceStrategy || 'county-fallback'
        }
      } else if (primaryObs.length >= fallbackObs.length && primaryObs.length > 0) {
        result = primaryResult
        observations = primaryObs
        strategy = primaryResult?.sourceStrategy || 'county-region'
      } else if (fallbackObs.length > 0) {
        result = fallbackResult
        observations = fallbackObs
        strategy = fallbackResult?.sourceStrategy || 'county-fallback'
      }
    }

    if (allowStateFallback && !isExplicitCountySwitch && observations.length === 0 && countyRegion) {
      const stateRegion = stateRegionFromCountyRegion(countyRegion)
      if (stateRegion) {
        try {
            const stateData = await fetchRegionRarities(stateRegion, effectiveDaysBack)
          const filtered = Array.isArray(stateData)
            ? stateData.filter((item) => String(isLeafProvinceRegion ? (item?.subnational1Code || '') : (item?.subnational2Code || '')).toUpperCase() === countyRegion)
            : []

          if (filtered.length > observations.length) {
            observations = filtered
            strategy = 'state-filter-client'
            result = {
              countyName: null,
              countyRegion,
              sourceStrategy: strategy,
            }
          }
        } catch (stateFallbackError) {
          console.warn('State filtered fallback failed:', stateFallbackError)
        }
      }
    }

    if (isStaleNotablesLoad(notablesLoadId, requestId, countySwitchRequestId)) {
      return
    }

    if (observations.length > 0) {
      saveNotablesCache(result?.countyRegion || countyRegion || null, result, { daysBack: effectiveDaysBack })
    }

    const activeCountyCode = (result?.countyRegion || countyRegion || '').toUpperCase()
    const filteredObs = activeCountyCode
      ? observations.filter((item) => !item.subnational2Code || String(item.subnational2Code).toUpperCase() === activeCountyCode)
      : observations
    let displayObs = activeCountyCode ? filteredObs : observations
    if (allowStateFallback && !isExplicitCountySwitch && countyRegion && activeCountyCode && displayObs.length === 0) {
      const stateRegion = stateRegionFromCountyRegion(activeCountyCode)
      if (stateRegion) {
        try {
          const stateData = await fetchRegionRarities(stateRegion, effectiveDaysBack)
          const stateFiltered = Array.isArray(stateData)
            ? stateData.filter((item) => String(isLeafProvinceRegion ? (item?.subnational1Code || '') : (item?.subnational2Code || '')).toUpperCase() === activeCountyCode)
            : []
          if (stateFiltered.length > 0) {
            displayObs = stateFiltered
            strategy = 'state-filter-client'
          }
        } catch (stateFallbackError) {
          console.warn('State fallback after county filter-empty failed:', stateFallbackError)
        }
      }
    }
    if (displayObs.length === 0 && !isExplicitCountySwitch) {
      const recoveryTarget = activeCountyCode || countyRegion || previousCountyRegionState || null
      const recovery = getRecoverySnapshot(recoveryTarget)
      if (recovery && Array.isArray(recovery.observations) && recovery.observations.length > 0) {
        displayObs = recovery.observations.slice()
        strategy = `${strategy || 'county-region'}-recovered`
        currentCountyName = recovery.countyName || currentCountyName || null
        currentCountyRegion = recovery.countyRegion || countyRegion || currentCountyRegion || null
        currentActiveCountyCode = String(recovery.activeCountyCode || currentActiveCountyCode || '').toUpperCase()
      }
    }

    const resolvedCountyName = result?.countyName || currentCountyName || previousCountyNameState || null
    const resolvedCountyRegion = result?.countyRegion || currentCountyRegion || countyRegion || previousCountyRegionState || null
    const resolvedActiveCountyCode = String(activeCountyCode || currentActiveCountyCode || resolvedCountyRegion || previousActiveCountyCodeState || '').toUpperCase()

    currentRawObservations = displayObs
    currentCountyName = resolvedCountyName
    currentCountyRegion = resolvedCountyRegion
    currentActiveCountyCode = resolvedActiveCountyCode
    if (displayObs.length > 0) {
      rememberLastGoodObservations(displayObs, currentCountyName, currentCountyRegion, currentActiveCountyCode)
    } else if (previousObservations.length > 0 && !isExplicitCountySwitch) {
      currentRawObservations = previousObservations
      currentCountyName = previousCountyNameState
      currentCountyRegion = previousCountyRegionState
      currentActiveCountyCode = previousActiveCountyCodeState
      strategy = `${strategy || 'county-region'}-restored`
    }

    // Prefer a stable county-center anchor (from picker options) over the
    // triggering lat/lng (which may be user's GPS inside the county).
    const anchorRegion = String(currentActiveCountyCode || currentCountyRegion || '').toUpperCase()
    const anchorOption = countyPickerOptions.find((opt) => String(opt?.countyRegion || '').toUpperCase() === anchorRegion) || null
    const anchorLat = Number(anchorOption?.lat)
    const anchorLng = Number(anchorOption?.lng)
    if (Number.isFinite(anchorLat) && Number.isFinite(anchorLng)) {
      setCountyDistanceAnchor(anchorLat, anchorLng, anchorRegion)
    } else {
      setCountyDistanceAnchor(latitude, longitude, anchorRegion)
    }

    // Keep county picker sorted around the active county (state list), if available.
    const stateRegion = stateRegionFromCountyRegion(currentActiveCountyCode || currentCountyRegion || '')
    const cachedStateEntries = stateRegion ? stateCountyOptionsCache.get(stateRegion) : null
    if (stateRegion && Array.isArray(cachedStateEntries) && cachedStateEntries.length > 1) {
      applyCountyPickerOptionsFromStateEntries(
        cachedStateEntries,
        currentActiveCountyCode || '',
        (Number.isFinite(lastCountyAnchorLat) && Number.isFinite(lastCountyAnchorLng))
          ? { lat: lastCountyAnchorLat, lng: lastCountyAnchorLng }
          : null
      )
    }
    refreshCountyPickerSummaries()
    const displayFiltered = applyActiveFiltersAndRender({ renderMap: false })
    perfEnd('fetch')
    perfStart('table')
    setTableRenderStatus(`table-ok rows=${currentRawObservations.length}`)
    perfEnd('table')
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    if (isStaleNotablesLoad(notablesLoadId, requestId, countySwitchRequestId)) return
    setMapLoading(true, 'Rendering map points…')
    renderNotablesOnMap(displayFiltered, currentActiveCountyCode, true)
    setTableRenderStatus(`map-ok points=${displayFiltered.length}`)
    maybeApplyHiResOnCountyLoad()
    if (strategy) {
      notableMeta.textContent = `${notableMeta.textContent} · ${strategy}`
    }
    const activeStateRegion = stateRegionFromCountyRegion(currentActiveCountyCode || currentCountyRegion || '')
    if (activeStateRegion) {
      void prefetchStateRarities(activeStateRegion, statePrefetchDaysBack)
    }
    updateRuntimeLog()
  } catch (error) {
    console.error('County notables unavailable:', error)
    if (error?.name === 'AuthError') return
    if (isStaleNotablesLoad(notablesLoadId, requestId, countySwitchRequestId)) {
      return
    }

    if (hadPreviousRows) {
      if (!isExplicitCountySwitch) {
        notableCount.className = 'badge ok'
        notableCount.textContent = previousCountText
        notableMeta.textContent = `${previousMetaText} · refresh-failed`
        notableRows.innerHTML = previousRowsHtml
        if (tableRenderStatus) {
          tableRenderStatus.textContent = previousRenderStatus || 'render: refresh-failed-restored'
        }
        return
      }
    }

    const cached = loadNotablesCache(countyRegion)
    if (cached && Array.isArray(cached.observations) && cached.observations.length > 0) {
      currentRawObservations = cached.observations
      currentCountyName = cached?.countyName || null
      currentCountyRegion = cached?.countyRegion || countyRegion || null
      currentActiveCountyCode = (cached?.countyRegion || countyRegion || '').toUpperCase()
      rememberLastGoodObservations(currentRawObservations, currentCountyName, currentCountyRegion, currentActiveCountyCode)
      refreshCountyPickerSummaries()
      const cachedFiltered = applyActiveFiltersAndRender({ renderMap: false })
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      if (isStaleNotablesLoad(notablesLoadId, requestId, countySwitchRequestId)) return
      setMapLoading(true, 'Rendering map points…')
      renderNotablesOnMap(cachedFiltered, currentActiveCountyCode, true)
      maybeApplyHiResOnCountyLoad()
      notableMeta.textContent = `${notableMeta.textContent} · cached-fallback`
      setTableRenderStatus(`cache-ok rows=${cached.observations.length}`)
      return
    }

    const recovery = getRecoverySnapshot(countyRegion || previousCountyRegionState || null)
    if (recovery && Array.isArray(recovery.observations) && recovery.observations.length > 0) {
      currentRawObservations = recovery.observations.slice()
      currentCountyName = recovery.countyName || previousCountyNameState || null
      currentCountyRegion = recovery.countyRegion || countyRegion || previousCountyRegionState || null
      currentActiveCountyCode = String(recovery.activeCountyCode || previousActiveCountyCodeState || '').toUpperCase()
      refreshCountyPickerSummaries()
      const recoveredFiltered = applyActiveFiltersAndRender({ renderMap: false })
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      if (isStaleNotablesLoad(notablesLoadId, requestId, countySwitchRequestId)) return
      setMapLoading(true, 'Rendering map points…')
      renderNotablesOnMap(recoveredFiltered, currentActiveCountyCode, true)
      maybeApplyHiResOnCountyLoad()
      notableMeta.textContent = `${notableMeta.textContent} · recovered`
      setTableRenderStatus(`recover-ok rows=${recovery.observations.length}`)
      return
    }

    notableCount.className = 'badge warn'
    notableCount.textContent = '0'
    notableMeta.textContent = 'County notables currently unavailable'
    updateStatPills('0', '0', '0')
    notableRows.innerHTML = '<tr><td colspan="8">No notable observations available right now.</td></tr>'
    setTableRenderStatus(`load-error err=${error?.message || 'unknown'}`)
    updateRuntimeLog()
  } finally {
    window.clearTimeout(loadingWatchdog)
    if (isStaleNotablesLoad(notablesLoadId, requestId, countySwitchRequestId)) {
      return
    }
    if (notableCount.textContent === 'Loading…' || notableCount.textContent === 'Refreshing…') {
      if (hadPreviousRows) {
        notableCount.className = 'badge ok'
        notableCount.textContent = previousCountText
        notableMeta.textContent = `${previousMetaText} · refresh-incomplete`
        notableRows.innerHTML = previousRowsHtml
        if (tableRenderStatus) {
          tableRenderStatus.textContent = previousRenderStatus || 'render: refresh-incomplete-restored'
        }
        markMapPartReady('observations')
        return
      }
      notableCount.className = 'badge warn'
      notableCount.textContent = '0'
      updateStatPills('0', '0', '0')
      notableMeta.textContent = 'County notables request did not complete'
      notableRows.innerHTML = '<tr><td colspan="8">County notables request did not complete. Please try again.</td></tr>'
      setTableRenderStatus('load-finalized-no-data')
    }
    markMapPartReady('observations')
    updateRuntimeLog()
  }
}

async function updateCountyForLocation(latitude, longitude, requestId = null, countySwitchRequestId = null) {
  try {
    setMapLoading(true, 'Loading county…')
    const geojson = await fetchCountyContextWithCache(latitude, longitude)
    if ((requestId !== null && isStaleLocationRequest(requestId)) || (countySwitchRequestId !== null && isStaleCountySwitchRequest(countySwitchRequestId))) {
      return { countyLabel: null, countyRegion: null }
    }
    drawCountyOverlay(geojson)
    const countyFeature = Array.isArray(geojson?.features)
      ? geojson.features.find((f) => f?.properties?.isActiveCounty)
      : null
    const countyLabel = countyFeature?.properties?.countyName || countyFeature?.properties?.NAME || countyFeature?.properties?.name || null
    const countyRegion = countyFeature?.properties?.countyRegion || geojson?.activeCountyRegion || null
    return { countyLabel, countyRegion }
  } catch (error) {
    console.error('County context unavailable:', error)
    setMapLoading(false)
    return { countyLabel: null, countyRegion: null }
  }
}

async function loadStateNotables(stateRegion, requestId = null) {
  const notablesLoadId = ++latestNotablesLoadId
  const normalizedState = String(stateRegion || '').toUpperCase()
  setMapLoading(true, `Loading ${stateRegion} notables…`)
  setTableRenderStatus('load-start')
  notableCount.className = 'badge warn'
  notableCount.textContent = 'Loading…'
  notableMeta.textContent = `Loading rarities for ${stateRegion}…`
  updateStatPills('…', '…', '…')
  notableRows.innerHTML = '<tr><td colspan="8">Loading notables…</td></tr>'
  clearStateMarkers()

  try {
    const effectiveDaysBack = Math.max(1, Math.min(14, Number(filterDaysBack) || 7))
    const observations = await fetchRegionRarities(stateRegion, effectiveDaysBack, 45000)
    if (isStaleNotablesLoad(notablesLoadId, requestId)) return
    let stateCountyGeojson = null
    try {
      stateCountyGeojson = await fetchStateCountyGeometry(normalizedState)
      if (!isStaleNotablesLoad(notablesLoadId, requestId)) {
        const stateMaskGeojson = buildStateMaskGeojson(normalizedState, stateCountyGeojson)
        if (stateMaskGeojson) drawCountyOverlay(stateMaskGeojson)
        zoomToStateBounds(stateCountyGeojson, normalizedState)
      }
    } catch (overlayError) {
      console.warn('State mask overlay unavailable:', overlayError)
      markMapPartReady('activeCounty')
      markMapPartReady('stateMask')
    }
    currentRawObservations = Array.isArray(observations) ? observations : []
    saveNotablesCache(normalizedState, { observations: currentRawObservations }, { daysBack: effectiveDaysBack })
    const stateCountyEntries = buildStateCountyEntries(currentRawObservations, stateRegion)
    stateCountyOptionsCache.set(stateRegion, stateCountyEntries)
    currentCountyName = getStateNameByRegion(normalizedState)
    currentCountyRegion = normalizedState
    currentActiveCountyCode = ''
    refreshHeaderStateOptions()
    renderStatePickerOptions()
    applyCountyPickerOptionsFromStateEntries(
      stateCountyEntries,
      '',
      (Number.isFinite(lastCountyAnchorLat) && Number.isFinite(lastCountyAnchorLng))
        ? { lat: lastCountyAnchorLat, lng: lastCountyAnchorLng }
        : (Number.isFinite(lastUserLat) && Number.isFinite(lastUserLng) ? { lat: lastUserLat, lng: lastUserLng } : null)
    )
    refreshSearchCountyOptions(currentRawObservations, stateRegion)
    refreshHeaderCountyOptions()
    rememberLastGoodObservations(currentRawObservations, currentCountyName, normalizedState, '')
    applyActiveFiltersAndRender({ renderMap: true, fitToObservations: true })
    setMapLoading(false)
    markMapPartReady('observations')
  } catch (error) {
    if (isStaleNotablesLoad(notablesLoadId, requestId)) return
    if (error?.name === 'AuthError') return
    console.error('loadStateNotables error:', error)
    notableCount.className = 'badge warn'
    notableCount.textContent = '0'
    notableMeta.textContent = `Error: ${error?.message || error}`
    updateStatPills('0', '0', '0')
    const safeErrorMessage = escapeHtml(error?.message || 'unknown error')
    notableRows.innerHTML = `<tr><td colspan="8">Load failed: ${safeErrorMessage}.</td></tr>`
    setTableRenderStatus(`state-error: ${error?.message || ''}`)
    setMapLoading(false)
    markMapPartReady('observations')
  }
}

async function loadNationalNotables(regionCode = US_REGION_CODE, abaMinFloor = 3, requestId = null) {
  const notablesLoadId = ++latestNotablesLoadId
  const normalizedRegion = String(regionCode || '').toUpperCase() || US_REGION_CODE
  const effectiveAbaMin = Math.max(3, Number(abaMinFloor) || 3)

  setMapLoading(true, `Loading ${normalizedRegion} notables…`)
  setTableRenderStatus('us-load-start')
  notableCount.className = 'badge warn'
  notableCount.textContent = 'Loading…'
  notableMeta.textContent = `Loading rarities for ${normalizedRegion} (ABA ${effectiveAbaMin}+)…`
  updateStatPills('…', '…', '…')
  notableRows.innerHTML = '<tr><td colspan="8">Loading US notables…</td></tr>'

  const effectiveDaysBack = Math.max(1, Math.min(14, Number(filterDaysBack) || 7))
  try {
    const observations = await fetchRegionRarities(normalizedRegion, effectiveDaysBack, 45000, { abaMin: effectiveAbaMin })
    if (isStaleNotablesLoad(notablesLoadId, requestId)) return

    currentRawObservations = Array.isArray(observations) ? observations : []
    currentCountyName = 'United States'
    currentCountyRegion = US_REGION_CODE
    currentActiveCountyCode = ''
    countyPickerOptions = []
    refreshHeaderStateOptions()
    renderStatePickerOptions()
    refreshHeaderCountyOptions()
    setSearchCountyIdleMessage('County select disabled for US')
    rememberLastGoodObservations(currentRawObservations, currentCountyName, currentCountyRegion, '')

    if (neighborLayerRef) neighborLayerRef.clearLayers()
    if (countyOverlay) countyOverlay.clearLayers()
    if (activeOutlineLayerRef) activeOutlineLayerRef.clearLayers()
    if (countyNameLayerRef) countyNameLayerRef.clearLayers()
    if (countyDotLayerRef) countyDotLayerRef.clearLayers()
    clearStateMarkers()

    markMapPartReady('activeCounty')
    markMapPartReady('stateMask')

    if (map) {
      map.fitBounds(L.latLngBounds([24.5, -125], [49.5, -66.5]), { padding: [20, 20], maxZoom: 5, animate: true })
    }

    applyActiveFiltersAndRender({ renderMap: true, fitToObservations: false })
    setMapLoading(false)
    markMapPartReady('observations')
  } catch (error) {
    if (isStaleNotablesLoad(notablesLoadId, requestId)) return
    if (error?.name === 'AuthError') return
    console.error('loadNationalNotables error:', error)
    notableCount.className = 'badge warn'
    notableCount.textContent = '0'
    notableMeta.textContent = `Error: ${error?.message || error}`
    updateStatPills('0', '0', '0')
    const safeErrorMessage = escapeHtml(error?.message || 'unknown error')
    notableRows.innerHTML = `<tr><td colspan="8">US load failed: ${safeErrorMessage}.</td></tr>`
    setTableRenderStatus(`us-error: ${error?.message || ''}`)
    setMapLoading(false)
    markMapPartReady('observations')
  }
}

async function loadNeighborCounty(lat, lng, countyRegion, countyName) {
  const explodeNow = Boolean(explodeClustersOnNextCountySwitch)
  explodeClustersOnNextCountySwitch = false
  if (explodeNow) mapFitMaxZoomOnce = COUNTY_EXPLODE_ZOOM
  clearStateMarkers()

  const normalizedCountyRegion = countyRegion ? String(countyRegion).toUpperCase() : null
  // Avoid Number(null) => 0 (which would incorrectly send us to 0,0).
  let targetLat = (lat === null || lat === undefined || lat === '') ? NaN : Number(lat)
  let targetLng = (lng === null || lng === undefined || lng === '') ? NaN : Number(lng)
  const countySwitchRequestId = ++latestCountySwitchRequestId
  mapLoadState.activeCounty = false
  mapLoadState.stateMask = false
  mapLoadState.observations = false
  setMapLoading(true, 'Switching county…')

  try {
    let countyContextPromise
    let zoomGeojson = null
    const localCountyGeojson = buildCountyGeojsonWithActiveRegion(latestCountyContextGeojson, normalizedCountyRegion || null)
    if (localCountyGeojson) {
      const localCountyFeature = localCountyGeojson.features.find((f) => f?.properties?.isActiveCounty)
      const localCountyRegion = String(localCountyFeature?.properties?.countyRegion || normalizedCountyRegion || '').toUpperCase() || null
      if (localCountyRegion) {
        currentCountyRegion = localCountyRegion
        currentActiveCountyCode = localCountyRegion
      }
      drawCountyOverlay(localCountyGeojson)
      zoomGeojson = localCountyGeojson
      const localCountyLabel = localCountyFeature?.properties?.countyName || localCountyFeature?.properties?.NAME || localCountyFeature?.properties?.name || countyName || null
      const center = getFeatureCenter(localCountyFeature)
      if ((!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) && center) {
        targetLat = center.lat
        targetLng = center.lng
      }
      countyContextPromise = Promise.resolve({ countyLabel: localCountyLabel, countyRegion: localCountyRegion })
    } else {
      if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
        if (Number.isFinite(lastUserLat) && Number.isFinite(lastUserLng)) {
          targetLat = lastUserLat
          targetLng = lastUserLng
        } else if (map) {
          const center = map.getCenter()
          targetLat = center.lat
          targetLng = center.lng
        }
      }
      countyContextPromise = updateCountyForLocation(targetLat, targetLng, null, countySwitchRequestId)
    }
    const countyContext = await countyContextPromise

    if (isStaleCountySwitchRequest(countySwitchRequestId)) return

    const resolvedCountyRegion = String(countyContext?.countyRegion || normalizedCountyRegion || '').toUpperCase() || null

    if (resolvedCountyRegion && Number.isFinite(targetLat) && Number.isFinite(targetLng)) {
      setCountyDistanceAnchor(targetLat, targetLng, resolvedCountyRegion)
    }

    if (!zoomGeojson && latestCountyContextGeojson) zoomGeojson = latestCountyContextGeojson
    const zoomed = zoomToActiveCounty(zoomGeojson, resolvedCountyRegion, { maxZoom: explodeNow ? COUNTY_EXPLODE_ZOOM : 11 })
    if (!zoomed && map && Number.isFinite(targetLat) && Number.isFinite(targetLng)) {
      map.setView([targetLat, targetLng], Math.max(map.getZoom(), explodeNow ? COUNTY_EXPLODE_ZOOM : 9), { animate: true })
    }

    await loadCountyNotables(targetLat, targetLng, resolvedCountyRegion, null, countySwitchRequestId, true)
  } catch (error) {
    console.error('loadNeighborCounty failed:', error)
    if (error?.name === 'AuthError') return
    if (!isStaleCountySwitchRequest(countySwitchRequestId)) {
      setMapLoading(false)
      restoreFromRecoverySnapshot('county-switch-error')
      updateRuntimeLog()
    }
  }
}

async function requestUserLocation(manualRetry = false) {
  perfStart('location')
  const requestId = ++latestLocationRequestId

  const isSecureOrigin = window.isSecureContext

  if (!('geolocation' in navigator)) {
    setLocationUiUnavailable('Location is not supported on this device/browser.')
    setNotablesUnavailableState(
      'County notables unavailable without location',
      'Location is not supported on this device/browser.',
      'location-unsupported'
    )
    return false
  }

  const permissionState = await getGeolocationPermissionState()
  if (permissionState === 'denied') {
    saveLocationBootPreference('declined')
    setLocationUiBlocked()
    showLocationPermGate()
    return false
  }

  setLocationUiChecking()
  if (!isSecureOrigin) {
    locationStatus.className = 'badge warn'
    locationStatus.textContent = 'Checking...'
    locationDetail.textContent = 'Non-secure origin detected. Attempting location; if blocked, open over HTTPS or localhost.'
  }
  resetMapLoadState()

  try {
    let position
    try {
      position = await getCurrentPositionAsync({
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000
      })
    } catch (highAccuracyError) {
      const retryable = highAccuracyError && (highAccuracyError.code === 2 || highAccuracyError.code === 3)
      if (!retryable) {
        throw highAccuracyError
      }

      locationDetail.textContent = 'High-accuracy attempt failed; retrying with standard accuracy.'
      position = await getCurrentPositionAsync({
        enableHighAccuracy: false,
        timeout: 20000,
        maximumAge: 30000
      })
    }

    const { latitude, longitude, accuracy } = position.coords
    lastUserLat = latitude
    lastUserLng = longitude
    // Persist so next app open can skip the browser prompt
    try { localStorage.setItem('mrm_last_pos', JSON.stringify({ lat: latitude, lng: longitude, ts: Date.now() })) } catch (_) {}
    if (isStaleLocationRequest(requestId)) {
      return false
    }

    locationStatus.className = 'badge ok'
    locationStatus.textContent = 'Located'
    saveLocationBootPreference('granted')
    const baseLocationDetail = `Lat ${latitude.toFixed(5)}, Lon ${longitude.toFixed(5)} · ±${Math.round(accuracy)} m`
    locationDetail.textContent = baseLocationDetail
    perfEnd('location')
    updateUserLocationOnMap(latitude, longitude, accuracy)

    // Extract cached county region so notables fetch can skip its own TIGER lookup
    const cachedGeoJson = loadCountyContextCache(latitude, longitude)
    const cachedActiveFeature = Array.isArray(cachedGeoJson?.features)
      ? cachedGeoJson.features.find((f) => f?.properties?.isActiveCounty)
      : null
    const cachedCountyRegion = cachedActiveFeature?.properties?.countyRegion || cachedGeoJson?.activeCountyRegion || null

    // Fire county outline and notables in parallel; pass cached region to notables so it skips its own TIGER call.
    perfStart('county')
    const countyContextPromise = updateCountyForLocation(latitude, longitude, requestId)
    const notablesPromise = loadCountyNotables(latitude, longitude, cachedCountyRegion, requestId, null, manualRetry)
    const countyContext = await countyContextPromise
    perfEnd('county')

    if (isStaleLocationRequest(requestId)) {
      return false
    }

    if (countyContext?.countyLabel) {
      const regionHint = countyContext?.countyRegion ? ` (${countyContext.countyRegion})` : ''
      locationDetail.textContent = `${baseLocationDetail} · ${countyContext.countyLabel}${regionHint}`
    }
    currentPhysicalCountryCode = countryCodeFromRegionCode(countyContext?.countyRegion || '')
    await notablesPromise
    updateRuntimeLog()
    return true
  } catch (error) {
    let reason = error && error.message ? error.message : 'Location permission was denied or timed out.'

    if (error && typeof error.code === 'number') {
      if (error.code === 1) {
        saveLocationBootPreference('declined')
        setLocationUiBlocked()
        showLocationPermGate()
        setMapLoading(false)
        updateRuntimeLog()
        return false
      } else if (error.code === 2) {
        reason = 'Position unavailable. Move to an open area and verify Location Services are on.'
      } else if (error.code === 3) {
        reason = 'Location request timed out. Try again while outdoors or on stronger signal.'
      }
    }

    setLocationUiUnavailable(reason)
    setNotablesUnavailableState(
      'County notables unavailable due to location error',
      reason,
      'location-error'
    )
    setMapLoading(false)
    console.error(error)
    updateRuntimeLog()
    return false
  }
}

retryLocationBtn.addEventListener('click', () => { void requestUserLocation(true) })

function showLocationPermGate() {
  locPermGate?.removeAttribute('hidden')
}

function hideLocationPermGate() {
  locPermGate?.setAttribute('hidden', 'hidden')
}

locPermRetryBtn?.addEventListener('click', () => {
  hideLocationPermGate()
  void requestUserLocation(true)
})

locPermDeclineBtn?.addEventListener('click', () => {
  hideLocationPermGate()
  saveLocationBootPreference('declined')
  setLocationUiUnavailable('Location declined. Showing California.')
  currentPhysicalCountryCode = null
  void activateStateByRegion(DEFAULT_NO_LOCATION_REGION)
})
menuInfoBtn?.addEventListener('click', () => {
  if (!infoModal) return
  renderInfoTechMetrics()
  renderTapDebugLog()
  infoModal.removeAttribute('hidden')
})
speciesLangToggleBtn?.addEventListener('click', () => {
  speciesNameLanguage = speciesNameLanguage === 'en' ? 'nl' : 'en'
  syncSpeciesLanguageToggleUi()
  renderSpeciesPickerOptions()
  updateSpeciesButtonLabel()
  applySortAndRender()
  if (speciesDetailPanel && !speciesDetailPanel.hasAttribute('hidden') && selectedSpecies) {
    setSpeciesDetailHeader(String(selectedSpecies))
  }
})
infoCloseBtn?.addEventListener('click', () => {
  infoModal?.setAttribute('hidden', 'hidden')
})
headerDaysBackSelect?.addEventListener('change', async (event) => {
  filterDaysBack = Number(event.target.value) || 7
  if (filterDaysBackInput) filterDaysBackInput.value = String(filterDaysBack)
  updateFilterUi()
  await refreshCurrentRegionDataForDaysBack()
})

headerCountyBtn?.addEventListener('click', (event) => {
  event.preventDefault()
  toggleCountyPicker()
})

headerSpeciesBtn?.addEventListener('click', (event) => {
  event.preventDefault()
  toggleSpeciesPicker()
})

// Mode tab bar — 4 view modes
modeTabBar?.addEventListener('click', (event) => {
  const btn = event.target.closest('.mode-tab')
  if (!btn) return
  event.preventDefault()
  const newMode = btn.dataset.mode
  if (!newMode || newMode === currentMode) return
  if (speciesDetailPanel && !speciesDetailPanel.hasAttribute('hidden')) {
    speciesDetailPanel.setAttribute('hidden', 'hidden')
  }
  setMode(newMode)
})

// Country button: quick NL/US switch (2-char fixed) — sets pending, opens region picker
headerCountryBtn?.addEventListener('click', (event) => {
  event.preventDefault()
  const menu = document.createElement('div')
  menu.className = 'country-picker-popover'
  menu.innerHTML = [
    { code: 'NL', label: 'Netherlands \u{1F1F3}\u{1F1F1}' },
    { code: 'US', label: 'United States \u{1F1FA}\u{1F1F8}' },
  ].map((c) => `<button class="country-pick-item" data-code="${c.code}">${c.label}</button>`).join('')
  const rect = headerCountryBtn.getBoundingClientRect()
  Object.assign(menu.style, { position: 'fixed', left: `${rect.left}px`, bottom: `${window.innerHeight - rect.top + 4}px`, zIndex: '2000', background: '#1f2937', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '0.55rem', padding: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' })
  document.body.append(menu)
  const cleanup = () => menu.remove()
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.country-pick-item')
    if (!item) return
    cleanup()
    const code = item.dataset.code
    const isNl = code === 'NL'
    const targetRegion = isNl ? 'NL' : US_REGION_CODE
    // Immediately start loading records for the chosen country domain
    void activateStateByRegion(targetRegion)
    // For US also open state picker so user can drill to a specific state
    if (!isNl) {
      renderStatePickerOptions()
      toggleStatePicker()
    }
  })
  window.setTimeout(() => document.addEventListener('click', cleanup, { once: true, capture: true }), 0)
})

headerStateBtn?.addEventListener('click', (event) => {
  event.preventDefault()
  renderStatePickerOptions()
  toggleStatePicker()
})

headerStateSelect?.addEventListener('change', async (event) => {
  const next = String(event?.target?.value || '').toUpperCase()
  if (next !== US_REGION_CODE && !isStateRegionCode(next)) return
  clearPendingLocationSelection()
  await activateStateByRegion(next)
})

headerCountySelect?.addEventListener('change', async (event) => {
  const selectEl = event.target
  const countyRegion = String(selectEl?.value || '').toUpperCase()
  if (!countyRegion) return
  const option = countyPickerOptions.find((opt) => String(opt.countyRegion || '').toUpperCase() === countyRegion) || null
  if (option) {
    clearPendingLocationSelection()
    await activateCountyFromOption(option)
    return
  }

  clearPendingLocationSelection()
  await activateCountyByRegion(countyRegion)
})
filterDaysBackInput?.addEventListener('input', (event) => {
  filterDaysBack = Number(event.target.value) || 7
  updateFilterUi()
  applyActiveFiltersAndRender({ fitToObservations: true })
})
filterDaysBackInput?.addEventListener('change', async () => {
  await refreshCurrentRegionDataForDaysBack()
})
filterAbaMinInput?.addEventListener('input', (event) => {
  filterAbaMin = Math.max(1, Math.min(5, Number(event.target.value) || 1))
  updateFilterUi()
  applyActiveFiltersAndRender()
})
syncSpeciesLanguageToggleUi()
updateFilterUi()
menuSearchBtn?.addEventListener('click', () => {
  if (!searchPopover) return
  refreshSearchRegionOptions()
  void ensureSearchCountyOptionsForState(searchRegionSelect?.value || stateRegionFromCountyRegion(currentCountyRegion || '') || '')
  updateFilterUi()
  syncSearchSlidersForRegion(searchRegionSelect?.value || stateRegionFromCountyRegion(currentCountyRegion || '') || '')
  searchPopover.toggleAttribute('hidden')
})
searchRegionSelect?.addEventListener('change', () => {
  const newRegion = searchRegionSelect?.value || ''
  if (currentCountyRegion === US_REGION_CODE && newRegion !== US_REGION_CODE) {
    if (searchAbaMinInput) searchAbaMinInput.value = '1'
  }
  syncSearchSlidersForRegion(newRegion)
  setSearchCountyLoading('Loading counties…')
  void ensureSearchCountyOptionsForState(newRegion)
})
searchDaysBackInput?.addEventListener('input', () => {
  if (!searchDaysBackValue || !searchDaysBackInput) return
  searchDaysBackValue.textContent = String(Math.max(1, Math.min(14, Number(searchDaysBackInput.value) || filterDaysBack)))
})
searchAbaMinInput?.addEventListener('input', () => {
  syncSearchSlidersForRegion(searchRegionSelect?.value || stateRegionFromCountyRegion(currentCountyRegion || '') || '')
})
searchCloseBtn?.addEventListener('click', () => {
  searchPopover?.setAttribute('hidden', 'hidden')
})
searchApplyBtn?.addEventListener('click', async () => {
  if (searchApplyInProgress) return
  searchApplyInProgress = true
  const selectedRegion = String(searchRegionSelect?.value || '').toUpperCase()
  const selectedCountyRegion = String(searchCountySelect?.value || '').toUpperCase()
  const selectedName = searchSpeciesSelect ? String(searchSpeciesSelect.value || '').trim() : ''
  const chosenDays = Number(searchDaysBackInput?.value || filterDaysBack) || filterDaysBack
  const requestedAbaMin = Number(searchAbaMinInput?.value || filterAbaMin) || filterAbaMin
  const effectiveAbaMin = getEffectiveSearchAbaMin(selectedRegion, requestedAbaMin)
  try {
    // Species search field is currently removed from the UI; don't clobber any active species filter.
    if (searchSpeciesSelect) selectedSpecies = selectedName || null
    filterDaysBack = chosenDays
    filterAbaMin = effectiveAbaMin
    if (filterDaysBackInput) filterDaysBackInput.value = String(filterDaysBack)
    if (filterAbaMinInput) filterAbaMinInput.value = String(filterAbaMin)
    updateFilterUi()
    syncSearchSlidersForRegion(selectedRegion)
    applyActiveFiltersAndRender({ fitToObservations: true })
    // Selection priority (wireframe contract): county > state/US.
    if (/^US-[A-Z]{2}-\d{3}$/.test(selectedCountyRegion)) {
      activateCountyFromSearchSelection(selectedCountyRegion)
    } else if (selectedRegion) {
      if (selectedRegion === US_REGION_CODE) {
        await loadNationalNotables(selectedRegion, effectiveAbaMin)
      } else if (isStateRegionCode(selectedRegion)) {
        await loadStateNotables(selectedRegion)
      }
    }
    searchPopover?.setAttribute('hidden', 'hidden')
  } catch (error) {
    console.error('search apply failed:', error)
    if (error?.name === 'AuthError') return
    setMapLoading(false)
    restoreFromRecoverySnapshot('search-apply-error')
    updateRuntimeLog()
  } finally {
    searchApplyInProgress = false
  }
})

tapDebugEnabled = loadTapDebugEnabled()
if (tapDebugToggle) {
  tapDebugToggle.checked = tapDebugEnabled
  tapDebugToggle.addEventListener('change', (event) => {
    tapDebugEnabled = Boolean(event?.target?.checked)
    saveTapDebugEnabled(tapDebugEnabled)
    if (tapDebugEnabled) {
      logTapResolution('debug-enabled', { source: 'about-modal', detail: 'tap debugging turned on' })
    } else {
      renderTapDebugLog()
    }
  })
}
renderTapDebugLog()

function focusMapOnUserLocation() {
  if (!map) return
  if (lastUserLat !== null && lastUserLng !== null) {
    map.invalidateSize()
    map.setView([lastUserLat, lastUserLng], 14, { animate: true })
  } else {
    void requestUserLocation()
  }
}

menuPinBtn?.addEventListener('click', () => {
  focusMapOnUserLocation()
})

bottomReloadBtn?.addEventListener('click', async () => {
  try {
    await triggerHardRefresh()
  } catch (error) {
    console.error('hard reload failed:', error)
  }
})
mapFullscreenToggleBtn.addEventListener('click', () => {
  setMapFullscreen(!isMapFullscreen)
})

mapBasemapToggleBtn?.addEventListener('click', () => {
  if (!map || !osmLayer || !satelliteLayer) return
  if (currentBasemap === 'osm') {
    map.removeLayer(osmLayer)
    satelliteLayer.addTo(map)
    currentBasemap = 'satellite'
    mapBasemapToggleBtn.title = 'Switch to Street map'
  } else {
    map.removeLayer(satelliteLayer)
    osmLayer.addTo(map)
    currentBasemap = 'osm'
    mapBasemapToggleBtn.title = 'Switch to Satellite'
  }
  updateBasemapAuxLayers()
  updateCountyLineColors()
})

mapLocateBtn?.addEventListener('click', () => {
  focusMapOnUserLocation()
})

mapMeasureBtn?.addEventListener('click', () => {
  const next = !mapMeasureMode
  if (!next) {
    setMeasureMode(false)
    resetMeasureTool()
    return
  }
  if (!map) initializeMap()
  setMeasureMode(true)
  resetMeasureTool()
})

mapNearbyRadiusBtn?.addEventListener('click', () => {
  cycleNearbyObservationRadius()
})

function syncMapLabelToggleUi() {
  const mapEl = document.querySelector('#map')
  if (mapEl) mapEl.classList.toggle('labels-hidden', labelMode === 'off')
  if (!mapLabelToggleBtn) return
  mapLabelToggleBtn.setAttribute('aria-pressed', String(labelMode !== 'off'))
  mapLabelToggleBtn.style.opacity = labelMode === 'off' ? '0.5' : ''
  mapLabelToggleBtn.title = labelMode === 'abbr' ? 'Show full names' : labelMode === 'full' ? 'Hide labels' : 'Show abbreviated names'
  const textEl = mapLabelToggleBtn.querySelector('text')
  if (textEl) {
    textEl.textContent = labelMode === 'abbr' ? 'B' : labelMode === 'full' ? 'F' : ''
  }
}

function setLabelMode(nextMode, { rerender = false } = {}) {
  const allowed = new Set(['abbr', 'full', 'off'])
  if (!allowed.has(nextMode)) return
  labelMode = nextMode
  syncMapLabelToggleUi()
  if (rerender) {
    lastMapRenderSignature = ''
    applyActiveFiltersAndRender({ allowAutoRecovery: false })
  }
}

function ensureSpeciesZoomLabelsVisible() {
  if (labelMode === 'off') {
    setLabelMode('abbr', { rerender: true })
  }
}

mapLabelToggleBtn?.addEventListener('click', () => {
  const nextMode = labelMode === 'abbr' ? 'full' : (labelMode === 'full' ? 'off' : 'abbr')
  setLabelMode(nextMode, { rerender: true })
})

syncNearbyRadiusButtonUi()

countyPickerList?.addEventListener('click', async (event) => {
  const btn = event.target.closest('.county-option')
  if (!btn) return
  const index = Number(btn.dataset.index)
  const option = countyPickerOptions[index]
  if (!option) return
  closeCountyPicker()
  clearPendingLocationSelection()
  await activateCountyFromOption(option)
})

speciesPickerList?.addEventListener('click', (event) => {
  const btn = event.target.closest('.county-option')
  if (!btn) return
  const species = String(btn.dataset.species || '').trim()
  closeSpeciesPicker()
  mapPointSpeciesFilter = new Set()
  selectedSpecies = species || null
  applyActiveFiltersAndRender({ allowAutoRecovery: false })

  // Take the user directly to the selected species on the map.
  if (selectedSpecies && map) {
    const pts = speciesMarkers.get(selectedSpecies)
    if (pts && pts.length > 0) {
      ensureSpeciesZoomLabelsVisible()
      map.invalidateSize()
      const targetPt = pickBestSpeciesPoint(pts, selectedSpecies)
      if (pts.length === 1 && targetPt) {
        map.setView([targetPt.lat, targetPt.lng], Math.max(map.getZoom(), 13), { animate: true })
        openObservationPopup(targetPt)
      } else {
        const lats = pts.map((p) => p.lat)
        const lngs = pts.map((p) => p.lng)
        map.fitBounds(
          L.latLngBounds([Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]),
          { padding: [40, 40], maxZoom: 13, animate: true }
        )
        if (targetPt) window.setTimeout(() => openObservationPopup(targetPt), 120)
      }
    }
  }
})

statePickerList?.addEventListener('click', async (event) => {
  const btn = event.target.closest('.county-option')
  if (!btn) return
  const code = String(btn.dataset.code || '').toUpperCase()
  if (!code) return
  closeStatePicker()
  clearPendingLocationSelection()
  await activateStateByRegion(code)
})

function activateAbaPill(pill) {
  if (!pill) return
  const rawCode = String(pill.dataset.code || '').toUpperCase()
  const isNlMode = isNlRarityPillMode()
  if (isNlMode) {
    if (rawCode !== 'R' && rawCode !== 'N') return
    selectedAbaCodes = new Set()
    if (!(selectedReviewFilters instanceof Set)) selectedReviewFilters = new Set()
    if (selectedReviewFilters.has(rawCode)) selectedReviewFilters.delete(rawCode)
    else selectedReviewFilters.add(rawCode)
    applyActiveFiltersAndRender({ allowAutoRecovery: false })
    return
  }

  selectedReviewFilters = new Set()

  const parsedCode = Number(rawCode)
  if (!Number.isFinite(parsedCode)) return
  const code = Math.round(parsedCode)
  if (code < 0 || code > 5) return
  // In US mode, codes 0 (N), 1, 2 are locked
  const isUsMode = String(currentCountyRegion || '').toUpperCase() === US_REGION_CODE
  if (isUsMode && (code === 0 || code === 1 || code === 2)) return
  if (!(selectedAbaCodes instanceof Set)) selectedAbaCodes = new Set()

  // Multi-select toggle: click toggles individual codes on/off.
  if (selectedAbaCodes.has(code)) selectedAbaCodes.delete(code)
  else selectedAbaCodes.add(code)

  applyActiveFiltersAndRender({ allowAutoRecovery: false })
}

function bindAbaPillContainer(container) {
  if (!container) return
  container.addEventListener('click', (e) => {
    const pill = e.target.closest('.stat-aba-pill')
    activateAbaPill(pill)
  })
  container.addEventListener('keydown', (e) => {
    const pill = e.target.closest('.stat-aba-pill')
    if (!pill) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      activateAbaPill(pill)
    }
  })
}

bindAbaPillContainer(topAbaPills)
bindAbaPillContainer(pickerAbaPills)
bindAbaPillContainer(statePickerAbaPills)

abaCodePickerList?.addEventListener('click', (event) => {
  const btn = event.target.closest('.county-option')
  if (!btn) return
  const index = Number(btn.dataset.index)
  const option = abaCodePickerOptions[index]
  if (!option) return
  if (!(selectedAbaCodes instanceof Set)) selectedAbaCodes = new Set()
  if (option.value === 'all') {
    selectedAbaCodes = new Set()
  } else {
    const parsedCode = Number(option.value)
    if (Number.isFinite(parsedCode)) {
      const code = Math.round(parsedCode)
      if (code >= 1 && code <= 5) {
        if (selectedAbaCodes.has(code)) selectedAbaCodes.delete(code)
        else selectedAbaCodes.add(code)
      }
    }
  }
  applyActiveFiltersAndRender({ allowAutoRecovery: false })
})

document.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Node)) return
  if (searchPopover && !searchPopover.hasAttribute('hidden') && !searchPopover.contains(target) && !(menuSearchBtn?.contains(target))) {
    searchPopover.setAttribute('hidden', 'hidden')
  }
  // Allow ABA bar clicks without dismissing open county/species/state pickers
  const clickedAbaBar = bottomAbaBar && bottomAbaBar.contains(target)
  if (!clickedAbaBar) {
    if (countyPicker && !countyPicker.contains(target) && !(headerCountyBtn && headerCountyBtn.contains(target))) {
      closeCountyPicker()
    }
    if (speciesPicker && !speciesPicker.contains(target) && !(headerSpeciesBtn && headerSpeciesBtn.contains(target))) {
      closeSpeciesPicker()
    }
    if (statePicker && !statePicker.contains(target) && !(headerStateBtn && headerStateBtn.contains(target))) {
      closeStatePicker()
    }
  }
  if (abaCodePicker && !abaCodePicker.contains(target) && !(topAbaPills && topAbaPills.contains(target))) {
    closeAbaCodePicker()
  }
  if (infoModal && !infoModal.hasAttribute('hidden')) {
    const shouldClose = target instanceof Element && target.getAttribute('data-close') === 'info'
    if (shouldClose) infoModal.setAttribute('hidden', 'hidden')
  }
})

notableRows.addEventListener('click', (event) => {
  const pinBtn = event.target.closest('.row-pin-btn')
  if (pinBtn) {
    const lat = pinBtn.dataset.lat
    const lng = pinBtn.dataset.lng
    if (lat && lng) {
      window.open(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`,
        '_blank', 'noopener,noreferrer'
      )
    }
    return
  }

  const countySummaryBtn = event.target.closest('.county-summary-btn')
  if (countySummaryBtn) {
    const row = countySummaryBtn.closest('tr')
    const rowCountyRegion = String(row?.dataset?.countyRegion || countySummaryBtn.dataset.countyRegion || '').toUpperCase()
    const rowCountyName = String(row?.dataset?.county || countySummaryBtn.textContent || '').trim()
    if (rowCountyRegion) {
      if (isStateRegionCode(rowCountyRegion)) {
        // It's a US state or a LEAF subnational1 (NL-GR province) — load its notables.
        if (searchRegionSelect) searchRegionSelect.value = rowCountyRegion
        if (searchAbaMinInput) searchAbaMinInput.value = '1'
        syncSearchSlidersForRegion(rowCountyRegion)
        filterAbaMin = 1
        updateFilterUi()
        void activateStateByRegion(rowCountyRegion)
      } else {
        const option = countyPickerOptions.find((opt) => String(opt.countyRegion || '').toUpperCase() === rowCountyRegion)
        if (option) {
          activateCountyFromOption(option)
        } else {
          activateCountyByRegion(rowCountyRegion, null, null, rowCountyName)
        }
      }
    }
    return
  }

  const countyCellBtn = event.target.closest('.county-cell-btn')
  if (countyCellBtn) {
    const row = countyCellBtn.closest('tr')
    const rowCountyRegion = String(row?.dataset?.countyRegion || countyCellBtn.dataset.countyRegion || '').toUpperCase()
    const rowCountyName = String(row?.dataset?.county || countyCellBtn.textContent || '').trim()
    if (!isCountyRegionCode(rowCountyRegion)) return

    const option = countyPickerOptions.find((opt) => String(opt.countyRegion || '').toUpperCase() === rowCountyRegion)
    if (option) {
      activateCountyFromOption(option)
    } else {
      activateCountyByRegion(rowCountyRegion, null, null, rowCountyName)
    }
    return
  }

  const btn = event.target.closest('.species-btn')
  if (!btn) return
  const species = btn.dataset.species
  if (!species) return

  // Pin this species to the top of the table.
  const wasPinned = pinnedSpecies === species
  pinnedSpecies = wasPinned ? null : species
  const pinnedNow = pinnedSpecies === species

  const row = btn.closest('tr')
  const rowCountyRegion = String(row?.dataset?.countyRegion || '').toUpperCase()
  const rowCountyName = String(row?.dataset?.county || '')
  const activeRegion = String(currentCountyRegion || '').toUpperCase()
  const isStateView = isStateRegionCode(activeRegion)
  const isDetailOpen = Boolean(speciesDetailPanel && !speciesDetailPanel.hasAttribute('hidden'))

  if (isDetailOpen) {
    mapPointSpeciesFilter = new Set()
    selectedSpecies = species
    const pts = Array.isArray(speciesMarkers.get(species)) ? speciesMarkers.get(species) : []
    const currentLocKey = String(speciesDetailBody?.querySelector?.('.obs-popup-inner')?.dataset?.locKey || '')
    const targetPt = (currentLocKey
      ? (pts.find((p) => String(p?.locKey || '') === currentLocKey) || null)
      : null) || pickBestSpeciesPoint(pts, species)
    openSpeciesDetailForSelection(species, targetPt)

    if (currentMode === 'hybrid' && targetPt && map) {
      ensureSpeciesZoomLabelsVisible()
      map.invalidateSize()
      map.setView([targetPt.lat, targetPt.lng], Math.max(map.getZoom(), 13), { animate: true })
    }
    return
  }

  if (currentMode !== 'list' && isStateView && rowCountyRegion) {
    preservePinnedSpeciesOnce = true
    mapPointSpeciesFilter = new Set()
    selectedSpecies = species
    const option = countyPickerOptions.find((opt) => String(opt.countyRegion || '').toUpperCase() === rowCountyRegion)
    if (option) {
      activateCountyFromOption(option)
      return
    }
    activateCountyByRegion(rowCountyRegion, null, null, rowCountyName)
    return
  }

  applySortAndRender()
  const tableWrap = document.querySelector('.table-wrap')
  if (pinnedNow && tableWrap) tableWrap.scrollTop = 0

  // Highlight row
  notableRows.querySelectorAll('tr.row-highlighted').forEach((r) => r.classList.remove('row-highlighted'))
  const escapedSpecies = String(species).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const newBtn = notableRows.querySelector(`.species-btn[data-species="${escapedSpecies}"]`)
  const newRow = newBtn?.closest('tr')
  if (newRow) newRow.classList.add('row-highlighted')

  const pts = speciesMarkers.get(species)

  // In list or hybrid mode: show species detail panel with observation info
  if (currentMode === 'list' || currentMode === 'hybrid') {
    const targetPt = pts?.length ? pickBestSpeciesPoint(pts, species) : null
    openSpeciesDetailForSelection(species, targetPt)
    // In hybrid mode, also zoom the map since it is visible
    if (currentMode === 'hybrid' && pts?.length && map) {
      ensureSpeciesZoomLabelsVisible()
      map.invalidateSize()
      const targetPt2 = targetPt
      if (pts.length === 1 && targetPt2) {
        map.setView([targetPt2.lat, targetPt2.lng], Math.max(map.getZoom(), 13), { animate: true })
      } else if (pts.length > 1) {
        const lats = pts.map((p) => p.lat)
        const lngs = pts.map((p) => p.lng)
        map.fitBounds(L.latLngBounds([Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]), { padding: [40, 40], maxZoom: 13, animate: true })
      }
    }
    return
  }

  // Map mode: zoom to point(s) and open popup
  if (!pts || pts.length === 0 || !map) return
  ensureSpeciesZoomLabelsVisible()
  if (map) map.invalidateSize()
  const targetPt = pickBestSpeciesPoint(pts, species)
  if (pts.length === 1 && targetPt) {
    map.setView([targetPt.lat, targetPt.lng], Math.max(map.getZoom(), 13), { animate: true })
    openObservationPopup(targetPt)
  } else {
    const lats = pts.map((p) => p.lat)
    const lngs = pts.map((p) => p.lng)
    map.fitBounds(L.latLngBounds([Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]), { padding: [40, 40], maxZoom: 13, animate: true })
    if (targetPt) {
      window.setTimeout(() => openObservationPopup(targetPt), 120)
    }
  }
})

  speciesDetailBackBtn?.addEventListener('click', async () => {
    if (speciesDetailPanel) speciesDetailPanel.setAttribute('hidden', 'hidden')
    await restoreSpeciesOverviewFromBack()
  if (speciesDetailPanel) speciesDetailPanel.setAttribute('hidden', 'hidden')
})

function applySpeciesDetailPanelLayout() {
  if (!speciesDetailPanel) return
  if (currentMode === 'hybrid') {
    const appMainEl = document.querySelector('.app-main')
    const rect = appMainEl?.getBoundingClientRect()
    if (rect) {
      speciesDetailPanel.style.top = `${Math.round(rect.top)}px`
      speciesDetailPanel.style.left = '0px'
      speciesDetailPanel.style.right = '0px'
      speciesDetailPanel.style.bottom = `${Math.max(0, Math.round(window.innerHeight - rect.bottom))}px`
      return
    }
  }

  speciesDetailPanel.style.top = ''
  speciesDetailPanel.style.left = ''
  speciesDetailPanel.style.right = ''
  speciesDetailPanel.style.bottom = ''
}

window.addEventListener('resize', () => {
  if (!speciesDetailPanel || speciesDetailPanel.hasAttribute('hidden')) return
  applySpeciesDetailPanelLayout()
})

document.querySelector('#reportsHelpBtn')?.addEventListener('click', (event) => {
  event.stopPropagation()
  const btn = event.currentTarget
  const popover = document.querySelector('#reportsHelpPopover')
  if (!popover) return
  const isHidden = popover.hasAttribute('hidden')
  if (isHidden) {
    const rect = btn.getBoundingClientRect()
    popover.style.top = `${rect.bottom + 6}px`
    popover.style.right = `${window.innerWidth - rect.right}px`
    popover.style.left = ''
    popover.removeAttribute('hidden')
    btn.setAttribute('aria-expanded', 'true')
  } else {
    popover.setAttribute('hidden', 'hidden')
    btn.setAttribute('aria-expanded', 'false')
  }
})

document.addEventListener('click', (event) => {
  const popover = document.querySelector('#reportsHelpPopover')
  if (!popover || popover.hasAttribute('hidden')) return
  if (!event.target.closest('#thReports')) {
    popover.setAttribute('hidden', 'hidden')
    document.querySelector('#reportsHelpBtn')?.setAttribute('aria-expanded', 'false')
  }
})

document.querySelector('.notable-table thead').addEventListener('click', (event) => {
  const th = event.target.closest('th[data-sort]')
  if (!th) return
  const col = th.dataset.sort
  if (sortState.col === col) {
    sortState.dir = sortState.dir === 'desc' ? 'asc' : 'desc'
  } else {
    sortState.col = col
    sortState.dir = (col === 'species' || col === 'state' || col === 'county') ? 'asc' : 'desc'
  }
  applySortAndRender()
})

notableRows.addEventListener('change', (event) => {
  const cb = event.target.closest('.obs-vis-cb')
  if (!cb) return
  const species = cb.dataset.species
  if (!species) return
  const show = cb.checked
  if (show) hiddenSpecies.delete(species)
  else hiddenSpecies.add(species)
  recomputeCanvasVisibilityFromHiddenSpecies()
  // Sync toggle-all checkbox state
  const toggleAll = document.querySelector('#toggleAllVis')
  if (toggleAll) {
    const total = notableRows.querySelectorAll('.obs-vis-cb').length
    if (hiddenSpecies.size === 0) { toggleAll.checked = true; toggleAll.indeterminate = false }
    else if (hiddenSpecies.size >= total) { toggleAll.checked = false; toggleAll.indeterminate = false }
    else { toggleAll.indeterminate = true }
  }
})

document.querySelector('#toggleAllVis')?.addEventListener('change', (event) => {
  const show = event.target.checked
  event.target.indeterminate = false
  speciesMarkers.forEach((_pts, species) => {
    if (show) hiddenSpecies.delete(species)
    else hiddenSpecies.add(species)
  })
  recomputeCanvasVisibilityFromHiddenSpecies()
  notableRows.querySelectorAll('.obs-vis-cb').forEach((cb) => { cb.checked = show })
})

setMode('hybrid')
ensureFrequencyScaleToggleHandler()

// Keep ABA bar visible immediately in all modes (hybrid/list/map) even before data loads.
renderAbaStatPills([])

let appBooted = false

async function bootAppOnce() {
  if (appBooted) return
  appBooted = true

  await cleanupLegacyServiceWorkersOnce()

  hideApiKeyGate()
  await checkApi()

  const launchUrl = new URL(window.location.href)
  const forceFreshLocation = launchUrl.searchParams.get('force_location') === '1'
  const resetToDefault = launchUrl.searchParams.get('reset_default') === '1' || launchUrl.searchParams.get('reset_nl') === '1'
  const prefetchBackParam = launchUrl.searchParams.get('prefetch_back')
  // Clean up all transient URL params injected by triggerHardRefresh or external tools
  // to avoid them persisting in the address bar and browser history.
  let urlMutated = false
  if (forceFreshLocation) { launchUrl.searchParams.delete('force_location'); urlMutated = true }
  if (resetToDefault) {
    launchUrl.searchParams.delete('reset_default')
    launchUrl.searchParams.delete('reset_nl')
    urlMutated = true
  }
  if (launchUrl.searchParams.has('refresh')) { launchUrl.searchParams.delete('refresh'); urlMutated = true }
  if (prefetchBackParam !== null) { launchUrl.searchParams.delete('prefetch_back'); urlMutated = true }
  if (urlMutated) window.history.replaceState({}, '', launchUrl.toString())

  // Optional perf tuning: prefetch a whole state's rarities in the background.
  // Useful for avoiding many subsequent county calls when navigating within a state.
  if (prefetchBackParam != null && prefetchBackParam !== '') {
    const parsed = Number(prefetchBackParam)
    if (Number.isFinite(parsed)) {
      statePrefetchDaysBack = Math.max(1, Math.min(14, Math.round(parsed)))
    }
  } else {
    statePrefetchDaysBack = DEFAULT_STATE_PREFETCH_DAYS_BACK
  }

  // Hard-reset path: force default flow and clear pending selections.
  if (resetToDefault) {
    locationStatus.className = 'badge warn'
    locationStatus.textContent = 'Default'
    locationDetail.textContent = 'California · reset'
    try {
      clearLocationBootPreference()
      clearPendingLocationSelection()
      await activateStateByRegion(DEFAULT_NO_LOCATION_REGION)
    } finally {
      updateRuntimeLog()
    }
    return
  }

  if (restorePendingLocationSelection()) {
    try {
      locationStatus.className = 'badge warn'
      locationStatus.textContent = 'Pending'
      locationDetail.textContent = 'Applying saved selection…'
      if (pendingCountyOption) {
        await activateCountyFromOption(pendingCountyOption, { preservePending: true })
      } else if (pendingRegionCode) {
        await activateStateByRegion(pendingRegionCode, { preservePending: true })
      }
      clearPendingLocationSelection()
      updateRuntimeLog()
      return
    } catch (error) {
      console.error('pending startup load failed:', error)
    }
  }

  // Default fallback: California state view when no location is available.
  const startFromDefaultRegion = async () => {
    locationStatus.className = 'badge warn'
    locationStatus.textContent = 'Default'
    locationDetail.textContent = 'California · no location'
    try {
      await activateStateByRegion(DEFAULT_NO_LOCATION_REGION)
      updateRuntimeLog()
      return true
    } catch (error) {
      console.error('default region startup failed:', error)
      updateRuntimeLog()
      return false
    }
  }

  // Default startup path: try device location first (unless user explicitly declined),
  // then fall back to California.
  const locationBootPref = loadLocationBootPreference()
  const shouldAttemptAutoLocation = forceFreshLocation || locationBootPref !== 'declined'
  if (shouldAttemptAutoLocation) {
    const located = await requestUserLocation(false)
    if (located) return
  }

  await startFromDefaultRegion()
}

function ensureApiKeyOrGate() {
  maybeSeedEbirdApiKeyFromUrl()
  const key = getStoredEbirdApiKey()
  if (key) {
    void bootAppOnce()
    return true
  }
  showApiKeyGate('')
  return false
}

apiKeyOpenBtn?.addEventListener('click', () => {
  window.open('https://ebird.org/api/keygen', '_blank', 'noopener,noreferrer')
})

apiKeyToggleBtn?.addEventListener('click', () => {
  const currentlyText = apiKeyInput?.type === 'text'
  setApiKeyInputVisibility(!currentlyText)
  try { apiKeyInput?.focus() } catch { /* ignore */ }
})

apiKeyCloseBtn?.addEventListener('click', () => {
  hideApiKeyGate()
})

apiKeySaveBtn?.addEventListener('click', async () => {
  if (apiKeyError) apiKeyError.textContent = ''
  const candidateKey = normalizeEbirdApiKey(apiKeyInput?.value)
  if (!candidateKey) {
    if (apiKeyError) apiKeyError.textContent = 'Paste your eBird API key to continue.'
    return
  }

  if (apiKeySaveBtn) apiKeySaveBtn.disabled = true
  try {
    const test = await testEbirdApiKey(candidateKey)
    if (!test.ok) {
      if (apiKeyError) apiKeyError.textContent = test.message || 'API key test failed.'
      return
    }
    const ok = setStoredEbirdApiKey(candidateKey)
    if (!ok) {
      if (apiKeyError) apiKeyError.textContent = 'Could not save API key (storage blocked?).'
      return
    }
    hideApiKeyGate()
    void bootAppOnce()
  } finally {
    if (apiKeySaveBtn) apiKeySaveBtn.disabled = false
  }
})

apiKeyInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    apiKeySaveBtn?.click()
  }
})

// Gate startup on API key.
ensureApiKeyOrGate()

function sleep(ms) {
  return new Promise((resolve) => { window.setTimeout(resolve, ms) })
}

function maybeStartStressTestRunner() {
  const url = new URL(window.location.href)
  if (url.searchParams.get('stress') !== '1') return

  const key = getStoredEbirdApiKey()
  if (!key) {
    console.warn('[stress] Missing API key; enter it first, then reload with ?stress=1')
    return
  }

  const states = ['US-CA', 'US-AZ', 'US-OR', 'US-WA', 'US-NV', 'US-ID', 'US-UT', 'US-CO']
  const daysBackOptions = [1, 3, 7, 14]
  const intervalMs = Math.max(800, Number(url.searchParams.get('stress_ms')) || 3500)
  let step = 0
  let inFlight = false
  let stopped = false

  const tick = async () => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      await bootAppOnce()

      const state = states[step % states.length]
      const daysBack = daysBackOptions[step % daysBackOptions.length]

      await activateStateByRegion(state)
      await sleep(300)

      if (headerDaysBackSelect) {
        const desired = String(daysBack)
        const hasOption = Array.from(headerDaysBackSelect.options).some((opt) => opt.value === desired)
        if (hasOption) {
          headerDaysBackSelect.value = desired
          headerDaysBackSelect.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }

      if (Array.isArray(countyPickerOptions) && countyPickerOptions.length > 0) {
        const cap = Math.min(countyPickerOptions.length, 8)
        const pick = countyPickerOptions[step % cap]
        if (pick?.countyRegion) {
          activateCountyByRegion(pick.countyRegion, pick.lat, pick.lng, pick.countyName)
        }
      }

      step += 1
      console.log(`[stress] step=${step} state=${state} days=${daysBack} counties=${countyPickerOptions.length}`)
    } catch (error) {
      stopped = true
      console.error('[stress] stopped due to error:', error)
      handleUnhandledUiFault('stress-runner', error)
    } finally {
      inFlight = false
    }
  }

  console.log(`[stress] Starting: interval=${intervalMs}ms (stop by removing ?stress=1)`)
  window.setInterval(() => { void tick() }, intervalMs)
  void tick()
}

maybeStartStressTestRunner()

validateNlReviewLabelConsistency()

window.addEventListener('error', (event) => {
  handleUnhandledUiFault('window-error', event?.error || new Error(event?.message || 'Unknown runtime error'))
})

window.addEventListener('unhandledrejection', (event) => {
  handleUnhandledUiFault('unhandled-rejection', event?.reason || new Error('Unhandled promise rejection'))
})
