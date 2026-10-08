/**
 * Wedding Budget - Google Apps Script backend (Phase 2: read + safe editing)
 *
 * Paste this whole file into Extensions > Apps Script in the budget Sheet.
 * Passphrases are NOT in this file. Set them under Project Settings > Script properties:
 *   PIN       = edit passphrase (can read AND change the budget)  [required]
 *   VIEW_PIN  = view-only passphrase (can only read)              [optional]
 * See SETUP.md.
 *
 * Safety rules enforced here (not just in the web page):
 *  - Only input cells are ever written: Item, Amount, Paid (Charles / Justine),
 *    the three headcount columns, the item note, and the two personal budgets.
 *  - A write to any cell that contains a formula is refused.
 *  - Every write checks that the cell still holds what the page last saw;
 *    otherwise it reports a conflict instead of overwriting.
 *  - Writes run one at a time (script lock).
 *  - "Delete" clears an item's input cells and keeps the row, so formulas,
 *    totals and any other notes in the Sheet are never shifted around.
 */

// ---- Settings ---------------------------------------------------------
var SHEET_GID = 2019565424;   // the tab's gid (the number after "gid=" in the Sheet's URL)
var FIRST_DATA_ROW = 3;       // first item row (rows 1-2 are headers)
var MAX_FAILS = 5;            // wrong passphrases allowed before a lockout
var LOCK_MINUTES = 15;        // how long the lockout lasts
var ID_KEY = 'wb_id';         // invisible row tag (Developer Metadata) used as stable ID
var MAX_MONEY = 1000000000;

// Editable fields -> column number
var FIELD_COL = { name: 1, amount: 2, paidCharles: 3, paidJustine: 4, preDinner: 7, breakfast: 8, lunch: 9 };
var MONEY_FIELDS = { amount: 1, paidCharles: 1, paidJustine: 1 };
var HEAD_FIELDS = { preDinner: 1, breakfast: 1, lunch: 1 };
var WRITE_ACTIONS = { add: 1, update: 1, pay: 1, remove: 1, budget: 1 };

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
    if (req.action === 'read') return json_(readAll_(auth.role, false));
    if (WRITE_ACTIONS[req.action]) {
      if (auth.role !== 'edit') return json_({ ok: false, error: 'forbidden' });
      return json_(withLock_(function () { return handleWrite_(req); }));
    }
    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json_({ ok: false, error: 'server_error', message: String(err && err.message || err) });
  }
}

// Opening the URL in a browser shows nothing but a heartbeat - no data, no passphrase check.
function doGet() {
  return json_({ ok: true, service: 'wedding-budget' });
}

// ---- Passphrase check with lockout -----------------------------------
function checkPin_(pin) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('fails') || 0);
  if (fails >= MAX_FAILS) {
    return { ok: false, error: 'locked', retryMinutes: LOCK_MINUTES };
  }
  var props = PropertiesService.getScriptProperties();
  var editPin = props.getProperty('PIN');
  var viewPin = props.getProperty('VIEW_PIN');
  if (!editPin) return { ok: false, error: 'pin_not_set' };

  if (typeof pin === 'string' && pin !== '') {
    if (safeEqual_(pin, editPin)) { cache.remove('fails'); return { ok: true, role: 'edit' }; }
    if (viewPin && safeEqual_(pin, viewPin)) { cache.remove('fails'); return { ok: true, role: 'view' }; }
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

// ---- Sheet helpers ----------------------------------------------------
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

function headOrNull_(v) {
  return v === '' || v === null || v === undefined ? null : num_(v);
}

// Finds the TOTAL row and the personal-budget rows by their labels,
// so the layout can shift without breaking anything.
function layout_(sheet) {
  var last = sheet.getLastRow();
  var col = sheet.getRange(1, 1, last, 1).getValues();
  var totalRow = -1, budgetRows = {};
  for (var r = 0; r < col.length; r++) {
    var label = String(col[r][0]).trim().toUpperCase();
    if (label === 'TOTAL' && totalRow < 0) totalRow = r + 1;
    if (label === 'CHARLES' || label === 'JUSTINE') budgetRows[label.toLowerCase()] = r + 1;
  }
  if (totalRow < 0) throw new Error('TOTAL row not found');
  return { totalRow: totalRow, budgetRows: budgetRows };
}

// ---- Reading the Sheet ------------------------------------------------
function readAll_(role, haveLock) {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  var range = sheet.getRange(1, 1, lastRow, 9);        // columns A..I
  var values = range.getValues();                      // calculated values
  var notes = range.getNotes();

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

  var ids = ensureIds_(sheet, itemRows, haveLock);

  var items = itemRows.map(function (row) {
    var v = values[row - 1], n = notes[row - 1];
    return {
      id: ids[row],
      row: row,
      name: String(v[0]).trim(),
      amount: num_(v[1]),
      paidCharles: num_(v[2]),
      paidJustine: num_(v[3]),
      remaining: num_(v[4]),
      heads: { preDinner: headOrNull_(v[6]), breakfast: headOrNull_(v[7]), lunch: headOrNull_(v[8]) },
      noteA: n[0] || '',                                           // the note the editor can change
      note: [n[0], n[1], n[2], n[3]].filter(String).join('\n\n')   // all notes, for display
    };
  });

  var t = values[totalRow - 1];
  var data = {
    items: items,
    totals: { amount: num_(t[1]), paidCharles: num_(t[2]), paidJustine: num_(t[3]), remaining: num_(t[4]) },
    budgets: budgets
  };

  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(data));
  var version = digest.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');

  return { ok: true, canEdit: role === 'edit', version: version, serverTime: new Date().toISOString(), data: data };
}

// ---- Stable row IDs ---------------------------------------------------
// Each item row gets an invisible tag (Developer Metadata). Google moves the tag
// with the row when rows are inserted, deleted or sorted, so an ID always
// points at the same item. Nothing is added to the visible Sheet.
function ensureIds_(sheet, itemRows, haveLock) {
  var found = sheet.createDeveloperMetadataFinder()
    .withKey(ID_KEY)
    .withLocationType(SpreadsheetApp.DeveloperMetadataLocationType.ROW)
    .find();

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

  var lock = null;
  if (!haveLock) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      missing.forEach(function (r) { byRow[r] = 'row' + r; });   // temporary, not saved
      return byRow;
    }
  }
  try {
    dupes.forEach(function (md) { md.remove(); });
    itemRows.filter(function (r) { return !byRow[r]; }).forEach(function (r) {
      var id = Utilities.getUuid().slice(0, 8);
      sheet.getRange(r + ':' + r).addDeveloperMetadata(ID_KEY, id);
      byRow[r] = id;
    });
  } finally {
    if (lock) lock.releaseLock();
  }
  return byRow;
}

function findRowById_(sheet, id) {
  if (typeof id !== 'string' || !id) return 0;
  var found = sheet.createDeveloperMetadataFinder()
    .withKey(ID_KEY)
    .withValue(id)
    .withLocationType(SpreadsheetApp.DeveloperMetadataLocationType.ROW)
    .find();
  return found.length ? found[0].getLocation().getRow().getRow() : 0;
}

// ---- Writing ----------------------------------------------------------
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function handleWrite_(req) {
  var cache = CacheService.getScriptCache();
  var opId = typeof req.opId === 'string' ? req.opId.slice(0, 64) : '';

  // A retried request (the phone lost signal after we saved) must not apply twice.
  if (opId && cache.get('op:' + opId)) {
    var again = readAll_('edit', true);
    again.duplicate = true;
    return again;
  }

  var sheet = getSheet_();
  var res;
  switch (req.action) {
    case 'add':    res = addItem_(sheet, req.item); break;
    case 'update': res = updateItem_(sheet, req); break;
    case 'pay':    res = payItem_(sheet, req); break;
    case 'remove': res = removeItem_(sheet, req); break;
    case 'budget': res = setBudget_(sheet, req); break;
    default:       res = { ok: false, error: 'unknown_action' };
  }
  if (!res.ok) return res;          // failed/conflicting requests are not remembered, so they can be retried

  SpreadsheetApp.flush();
  if (opId) cache.put('op:' + opId, '1', 21600);
  var out = readAll_('edit', true);   // fresh, recalculated values straight from the Sheet
  out.changedRow = res.row || null;
  return out;
}

function err_(error, field, message) {
  return { ok: false, error: error, field: field || null, message: message || '' };
}

function round2_(n) { return Math.round(n * 100) / 100; }

// Checks every incoming field. Returns { ok:true, values } or an error.
function clean_(changes) {
  var out = {};
  var keys = Object.keys(changes || {});
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i], v = changes[k];
    if (k === 'name') {
      if (typeof v !== 'string') return err_('invalid', k, 'Name must be text');
      v = v.trim();
      if (!v || v.length > 80) return err_('invalid', k, 'Name must be 1-80 characters');
      if (/^[=+\-@]/.test(v)) return err_('invalid', k, 'Name cannot start with = + - or @');
      out[k] = v;
    } else if (MONEY_FIELDS[k]) {
      if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > MAX_MONEY) return err_('invalid', k, 'Enter a number from 0 up');
      out[k] = round2_(v);
    } else if (HEAD_FIELDS[k]) {
      if (v === null) { out[k] = null; continue; }
      if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 99999 || Math.floor(v) !== v) return err_('invalid', k, 'Headcount must be a whole number');
      out[k] = v;
    } else if (k === 'noteA') {
      if (v === null) v = '';
      if (typeof v !== 'string' || v.length > 1000) return err_('invalid', k, 'Note too long');
      out[k] = v;
    } else {
      return err_('invalid', k, 'Unknown field');
    }
  }
  return { ok: true, values: out };
}

function itemAt_(sheet, row) {
  var v = sheet.getRange(row, 1, 1, 9).getValues()[0];
  return {
    name: String(v[0]).trim(),
    amount: num_(v[1]),
    paidCharles: num_(v[2]),
    paidJustine: num_(v[3]),
    preDinner: headOrNull_(v[6]),
    breakfast: headOrNull_(v[7]),
    lunch: headOrNull_(v[8]),
    noteA: sheet.getRange(row, 1).getNote() || ''
  };
}

function same_(a, b) {
  var an = (a === null || a === undefined || a === ''), bn = (b === null || b === undefined || b === '');
  if (an || bn) return an && bn;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.005;
  return String(a).trim() === String(b).trim();
}

// The Sheet no longer matches what the page last saw -> report instead of overwriting.
function diffs_(current, base, keys, mine) {
  var out = [];
  keys.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(base, k) && !same_(current[k], base[k])) {
      out.push({ field: k, sheet: current[k], mine: mine ? mine[k] : null, base: base[k] });
    }
  });
  return out;
}

// Returns the address of the first target cell that holds a formula, else null.
function formulaCell_(sheet, row, keys) {
  for (var i = 0; i < keys.length; i++) {
    var col = FIELD_COL[keys[i]] || 1;
    var cell = sheet.getRange(row, col);
    if (cell.getFormula()) return cell.getA1Notation();
  }
  return null;
}

function writeFields_(sheet, row, values) {
  Object.keys(values).forEach(function (k) {
    var v = values[k];
    if (k === 'noteA') {
      var a = sheet.getRange(row, 1);
      if (v === '') a.clearNote(); else a.setNote(v);
      return;
    }
    var cell = sheet.getRange(row, FIELD_COL[k]);
    if (v === null) cell.clearContent(); else cell.setValue(v);
  });
}

function updateItem_(sheet, req) {
  var row = findRowById_(sheet, req.id);
  if (!row) return err_('not_found');
  var cl = clean_(req.changes || {});
  if (!cl.ok) return cl;
  var keys = Object.keys(cl.values);
  if (!keys.length) return { ok: true, row: row };

  var cur = itemAt_(sheet, row);
  var d = diffs_(cur, req.base || {}, keys, cl.values);
  if (d.length) return { ok: false, error: 'conflict', diffs: d };

  var bad = formulaCell_(sheet, row, keys.filter(function (k) { return k !== 'noteA'; }));
  if (bad) return err_('formula_cell', bad, 'Cell ' + bad + ' contains a formula and was not changed');

  writeFields_(sheet, row, cl.values);
  return { ok: true, row: row };
}

function payItem_(sheet, req) {
  var row = findRowById_(sheet, req.id);
  if (!row) return err_('not_found');
  var key = req.who === 'charles' ? 'paidCharles' : req.who === 'justine' ? 'paidJustine' : null;
  if (!key) return err_('invalid', 'who', 'Choose who paid');
  var amt = req.amount;
  if (typeof amt !== 'number' || !isFinite(amt) || amt <= 0 || amt > MAX_MONEY) return err_('invalid', 'amount', 'Enter a payment above 0');

  var cur = itemAt_(sheet, row);
  var base = {};
  if (typeof req.base === 'number') base[key] = req.base;
  var d = diffs_(cur, base, [key], null);
  if (d.length) return { ok: false, error: 'conflict', diffs: d, payment: round2_(amt) };

  var bad = formulaCell_(sheet, row, [key]);
  if (bad) return err_('formula_cell', bad, 'Cell ' + bad + ' contains a formula and was not changed');

  var next = {}; next[key] = round2_(cur[key] + amt);
  writeFields_(sheet, row, next);
  return { ok: true, row: row };
}

// "Delete" empties the item's input cells (and notes). The row, its formulas and
// everything to the right stay exactly where they are, so totals never shift.
function removeItem_(sheet, req) {
  var row = findRowById_(sheet, req.id);
  if (!row) return err_('not_found');
  var keys = ['name', 'amount', 'paidCharles', 'paidJustine'];
  var cur = itemAt_(sheet, row);
  var d = diffs_(cur, req.base || {}, keys, null);
  if (d.length) return { ok: false, error: 'conflict', diffs: d };

  var all = Object.keys(FIELD_COL);
  var bad = formulaCell_(sheet, row, all);
  if (bad) return err_('formula_cell', bad, 'Cell ' + bad + ' contains a formula and was not changed');

  all.forEach(function (k) {
    var cell = sheet.getRange(row, FIELD_COL[k]);
    cell.clearContent();
  });
  [1, 2, 3, 4, 7, 8, 9].forEach(function (c) { sheet.getRange(row, c).clearNote(); });
  sheet.createDeveloperMetadataFinder().withKey(ID_KEY).withValue(req.id).find()
    .forEach(function (md) { md.remove(); });
  return { ok: true, row: row };
}

function setBudget_(sheet, req) {
  var who = req.who;
  if (who !== 'charles' && who !== 'justine') return err_('invalid', 'who', 'Choose Charles or Justine');
  var v = req.value;
  if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > MAX_MONEY) return err_('invalid', 'budget', 'Enter a number from 0 up');
  var lay = layout_(sheet);
  var row = lay.budgetRows[who];
  if (!row) return err_('not_found');
  var cell = sheet.getRange(row, 2);
  if (cell.getFormula()) return err_('formula_cell', cell.getA1Notation(), 'Cell ' + cell.getA1Notation() + ' contains a formula and was not changed');
  var cur = num_(cell.getValue());
  if (typeof req.base === 'number' && !same_(cur, req.base)) {
    return { ok: false, error: 'conflict', diffs: [{ field: 'budget', sheet: cur, mine: round2_(v), base: req.base }] };
  }
  cell.setValue(round2_(v));
  return { ok: true, row: row };
}

function addItem_(sheet, item) {
  if (!item || typeof item.name !== 'string') return err_('invalid', 'name', 'Name is required');
  var cl = clean_(item);
  if (!cl.ok) return cl;
  var vals = cl.values;
  if (!vals.name) return err_('invalid', 'name', 'Name is required');

  var lay = layout_(sheet);
  var data = sheet.getRange(FIRST_DATA_ROW, 1, lay.totalRow - FIRST_DATA_ROW, 9).getValues();

  // 1) reuse the first empty item row (it already has the Remaining / Percentage formulas)
  var row = 0;
  for (var i = 0; i < data.length; i++) {
    var v = data[i];
    var empty = [0, 1, 2, 3, 6, 7, 8].every(function (c) { return v[c] === '' || v[c] === null; });
    if (empty) { row = FIRST_DATA_ROW + i; break; }
  }

  // 2) none free: insert a row INSIDE the totals range so the SUM formulas grow with it
  if (!row) {
    var at = lay.totalRow - 1;
    sheet.insertRowBefore(at);
    row = at;
    var above = row - 1;
    if (above >= FIRST_DATA_ROW) {
      sheet.getRange(above, 1, 1, 9).copyTo(sheet.getRange(row, 1, 1, 9));   // copies formats + formulas
      [1, 2, 3, 4, 7, 8, 9].forEach(function (c) {
        var cell = sheet.getRange(row, c);
        cell.clearContent();
        cell.clearNote();
      });
    }
  }

  // make sure the formula columns (E, F) are present on this row
  if (!sheet.getRange(row, 5).getFormula() && row - 1 >= FIRST_DATA_ROW) {
    sheet.getRange(row - 1, 5, 1, 2).copyTo(sheet.getRange(row, 5, 1, 2));
  }

  var bad = formulaCell_(sheet, row, Object.keys(vals).filter(function (k) { return k !== 'noteA'; }));
  if (bad) return err_('formula_cell', bad, 'Cell ' + bad + ' contains a formula and was not changed');

  // leave zero / empty optional cells blank rather than filling them with 0
  var toWrite = {};
  Object.keys(vals).forEach(function (k) {
    var x = vals[k];
    if (k === 'name') toWrite[k] = x;
    else if (k === 'noteA') { if (x !== '') toWrite[k] = x; }
    else if (x !== null && x !== 0) toWrite[k] = x;
  });
  writeFields_(sheet, row, toWrite);
  return { ok: true, row: row };
}

// ---- Helpers ----------------------------------------------------------
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
