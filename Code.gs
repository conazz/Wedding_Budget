/**
 * Wedding Budget - Google Apps Script backend (Phase 1: read-only)
 *
 * Paste this whole file into Extensions > Apps Script in the budget Sheet.
 * The PIN is NOT in this file. Set it under Project Settings > Script properties
 * (name: PIN). See SETUP.md.
 */

// ---- Settings ---------------------------------------------------------
var SHEET_GID = 2019565424;   // the tab's gid (the number after "gid=" in the Sheet's URL)
var FIRST_DATA_ROW = 3;       // first item row (rows 1-2 are headers)
var MAX_FAILS = 5;            // wrong PINs allowed before a lockout
var LOCK_MINUTES = 15;        // how long the lockout lasts
var ID_KEY = 'wb_id';         // invisible row tag (Developer Metadata) used as stable ID

// ---- Entry points -----------------------------------------------------
// The page sends POST requests as text/plain so the browser skips the CORS
// pre-check that Apps Script cannot answer.
function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }

  var auth = checkPin_(req.pin);
  if (!auth.ok) return json_(auth);

  try {
    switch (req.action) {
      case 'read':
        return json_(readAll_());
      default:
        return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json_({ ok: false, error: 'server_error', message: String(err && err.message || err) });
  }
}

// Opening the URL in a browser shows nothing but a heartbeat - no data, no PIN check.
function doGet() {
  return json_({ ok: true, service: 'wedding-budget' });
}

// ---- PIN check with lockout ------------------------------------------
function checkPin_(pin) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('fails') || 0);
  if (fails >= MAX_FAILS) {
    return { ok: false, error: 'locked', retryMinutes: LOCK_MINUTES };
  }
  var real = PropertiesService.getScriptProperties().getProperty('PIN');
  if (!real) return { ok: false, error: 'pin_not_set' };

  if (typeof pin === 'string' && safeEqual_(pin, real)) {
    cache.remove('fails');
    return { ok: true };
  }
  cache.put('fails', String(fails + 1), LOCK_MINUTES * 60);
  return { ok: false, error: 'bad_pin', triesLeft: Math.max(0, MAX_FAILS - fails - 1) };
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- Reading the Sheet ------------------------------------------------
function getSheet_() {
  var sheets = SpreadsheetApp.getActive().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === SHEET_GID) return sheets[i];
  }
  throw new Error('Tab with gid ' + SHEET_GID + ' not found');
}

function num_(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function readAll_() {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  var range = sheet.getRange(1, 1, lastRow, 9);        // columns A..I
  var values = range.getValues();                      // calculated values
  var notes = range.getNotes();

  // Find the TOTAL row and the personal-budget rows by their labels,
  // so the layout can shift without breaking anything.
  var totalRow = -1, budgets = {};
  for (var r = 0; r < values.length; r++) {
    var label = String(values[r][0]).trim().toUpperCase();
    if (label === 'TOTAL' && totalRow < 0) totalRow = r + 1;
    if (label === 'CHARLES' || label === 'JUSTINE') {
      budgets[label.toLowerCase()] = {
        budget: num_(values[r][1]),
        remaining: num_(values[r][3]),
        row: r + 1
      };
    }
  }
  if (totalRow < 0) throw new Error('TOTAL row not found');

  var itemRows = [];
  for (var row = FIRST_DATA_ROW; row < totalRow; row++) {
    var v = values[row - 1];
    if (String(v[0]).trim() !== '' || num_(v[1]) !== 0) itemRows.push(row);
  }

  var ids = ensureIds_(sheet, itemRows);

  var items = itemRows.map(function (row) {
    var v = values[row - 1], n = notes[row - 1];
    var amount = num_(v[1]);
    return {
      id: ids[row],
      row: row,
      name: String(v[0]).trim(),
      amount: amount,
      paidCharles: num_(v[2]),
      paidJustine: num_(v[3]),
      remaining: num_(v[4]),
      heads: { preDinner: v[6] === '' ? null : num_(v[6]), breakfast: v[7] === '' ? null : num_(v[7]), lunch: v[8] === '' ? null : num_(v[8]) },
      note: [n[0], n[1], n[2], n[3]].filter(String).join('\n\n')
    };
  });

  var t = values[totalRow - 1];
  var data = {
    items: items,
    totals: { amount: num_(t[1]), paidCharles: num_(t[2]), paidJustine: num_(t[3]), remaining: num_(t[4]) },
    budgets: budgets
  };

  // Fingerprint of the data - Phase 2 uses this to detect "the Sheet changed since you loaded it".
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(data));
  var version = digest.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');

  return { ok: true, version: version, serverTime: new Date().toISOString(), data: data };
}

// ---- Stable row IDs ---------------------------------------------------
// Each item row gets an invisible tag (Developer Metadata). Google moves the tag
// with the row when rows are inserted, deleted or sorted, so an ID always
// points at the same item. Nothing is added to the visible Sheet.
function ensureIds_(sheet, itemRows) {
  var finder = sheet.createDeveloperMetadataFinder()
    .withKey(ID_KEY)
    .withLocationType(SpreadsheetApp.DeveloperMetadataLocationType.ROW);
  var found = finder.find();

  var byRow = {}, seen = {}, dupes = [];
  found.forEach(function (md) {
    var r = md.getLocation().getRow().getRow();
    var id = md.getValue();
    if (seen[id]) { dupes.push(md); return; }   // a copied row duplicated the tag
    seen[id] = true;
    byRow[r] = id;
  });

  var missing = itemRows.filter(function (r) { return !byRow[r]; });
  if (missing.length === 0 && dupes.length === 0) return byRow;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    missing.forEach(function (r) { byRow[r] = 'row' + r; });   // temporary, not saved
    return byRow;
  }
  try {
    dupes.forEach(function (md) { md.remove(); });
    var again = itemRows.filter(function (r) { return !byRow[r]; });
    again.forEach(function (r) {
      var id = Utilities.getUuid().slice(0, 8);
      sheet.getRange(r + ':' + r).addDeveloperMetadata(ID_KEY, id);
      byRow[r] = id;
    });
  } finally {
    lock.releaseLock();
  }
  return byRow;
}

// ---- Helpers ----------------------------------------------------------
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
