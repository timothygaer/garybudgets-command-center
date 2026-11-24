/**
 * Hermes ↔ Google bridge (Apps Script web app)
 * ------------------------------------------------------------------
 * One script, deployed as a web app, that gives Hermes Drive / Sheets /
 * Docs / Gmail / Calendar access WITHOUT an OAuth client, without
 * verification, and without the 7-day refresh-token expiry that keeps
 * killing the old setup.
 *
 * Deploy once (see "Google Apps Script Bridge.md" in the Obsidian vault):
 *   Deploy → New deployment → Web app
 *     Execute as: Me
 *     Who has access: Anyone
 *   Copy the /exec URL, paste it + the secret into ~/.hermes/gas_bridge.json
 *
 * Auth: every request must carry the secret in the JSON body under "k".
 * Change SECRET below to the value you put in the config file.
 * ------------------------------------------------------------------
 */

var SECRET = 'REPLACE_WITH_SECRET';

function doGet(e) {
  return reply_({ ok: true, service: 'hermes-gas-bridge', hint: 'POST JSON {k, action, params}' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ ok: false, error: 'bad_json' });
  }
  if (String(body.k) !== SECRET) return reply_({ ok: false, error: 'unauthorized' });

  var p = body.params || {};
  var action = String(body.action || '');
  try {
    var handler = HANDLERS[action];
    if (!handler) return reply_({ ok: false, error: 'unknown_action: ' + action });
    return reply_({ ok: true, result: handler(p) });
  } catch (err) {
    return reply_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------------------------------------------------- helpers */

function driveFetch_(path, options) {
  options = options || {};
  options.headers = {
    Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
  };
  options.muteHttpExceptions = true;
  var res = UrlFetchApp.fetch('https://www.googleapis.com/' + path, options);
  var txt = res.getContentText();
  var data;
  try { data = JSON.parse(txt); } catch (err) { data = { raw: txt }; }
  if (res.getResponseCode() >= 300) {
    throw new Error('drive api ' + res.getResponseCode() + ': ' + (data.error && data.error.message ? data.error.message : txt.slice(0, 200)));
  }
  return data;
}

function withFolder_(id) {
  return id ? DriveApp.getFolderById(id) : DriveApp.getRootFolder();
}

/* --------------------------------------------------------------- handlers */

var HANDLERS = {
  ping: function () {
    return {
      email: Session.getActiveUser().getEmail(),
      now: new Date().toISOString(),
      timezone: Session.getScriptTimeZone()
    };
  },

  /* ---- Drive ---------------------------------------------------- */

  // drive.list {folderId?, query?, pageSize?} → files [{id,name,mimeType,size,modified,url}]
  'drive.list': function (p) {
    var q = [];
    if (p.query) q.push(p.query);
    if (p.folderId) q.push("'" + p.folderId + "' in parents");
    q.push('trashed = false');
    var path = 'drive/v3/files?pageSize=' + (p.pageSize || 50) +
      '&fields=files(id,name,mimeType,size,modifiedTime,webViewLink),nextPageToken' +
      '&q=' + encodeURIComponent(q.join(' and ')) +
      '&orderBy=' + encodeURIComponent(p.orderBy || 'modifiedTime desc');
    var d = driveFetch_(path);
    return (d.files || []).map(function (f) {
      return { id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, modified: f.modifiedTime, url: f.webViewLink };
    });
  },

  // drive.search {name} → files whose name contains it
  'drive.search': function (p) {
    return HANDLERS['drive.list']({ query: "name contains '" + String(p.name).replace(/'/g, "\\'") + "'", pageSize: p.pageSize || 25 });
  },

  // drive.meta {fileId} → id,name,mimeType,size,modified,parents
  'drive.meta': function (p) {
    return driveFetch_('drive/v3/files/' + p.fileId + '?fields=id,name,mimeType,size,modifiedTime,parents,webViewLink');
  },

  // drive.read {fileId} → {name, mimeType, base64}  (native Google files are exported)
  'drive.read': function (p) {
    var meta = driveFetch_('drive/v3/files/' + p.fileId + '?fields=id,name,mimeType,size');
    var mime = meta.mimeType || '';
    var url;
    if (mime.indexOf('application/vnd.google-apps') === 0) {
      var exportAs = p.exportMimeType || (mime.indexOf('spreadsheet') > -1 ? 'text/csv' : 'text/plain');
      url = 'https://www.googleapis.com/drive/v3/files/' + p.fileId + '/export?mimeType=' + encodeURIComponent(exportAs);
    } else {
      url = 'https://www.googleapis.com/drive/v3/files/' + p.fileId + '?alt=media';
    }
    var res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 300) throw new Error('read failed ' + res.getResponseCode());
    return { name: meta.name, mimeType: mime, base64: Utilities.base64Encode(res.getBlob().getBytes()) };
  },

  // drive.write {folderId?, name, base64, mimeType?, overwrite?} → {id,name,url}
  'drive.write': function (p) {
    var mime = p.mimeType || 'application/octet-stream';
    var existingId = null;
    if (p.overwrite !== false) {
      var q = "name = '" + String(p.name).replace(/'/g, "\\'") + "' and trashed = false" +
        (p.folderId ? " and '" + p.folderId + "' in parents" : '');
      var found = driveFetch_('drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id)');
      if (found.files && found.files.length) existingId = found.files[0].id;
    }

    if (existingId) {
      // update in place: keeps the same file id and sharing links
      driveFetch_('upload/drive/v3/files/' + existingId + '?uploadType=media&supportsAllDrives=true', {
        method: 'patch',
        contentType: mime,
        payload: Utilities.base64Decode(p.base64)
      });
      return { id: existingId, name: p.name, updated: true };
    }

    var meta = { name: p.name };
    if (p.folderId) meta.parents = [p.folderId];
    var boundary = 'hermes_multipart_boundary';
    var body = '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(meta) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: ' + mime + '\r\n' +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      p.base64 + '\r\n' +
      '--' + boundary + '--';
    var created = driveFetch_('upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'post',
      contentType: 'multipart/related; boundary=' + boundary,
      payload: body
    });
    return { id: created.id, name: created.name, url: created.webViewLink, created: true };
  },

  // drive.mkdir {name, parentId?} → folder
  'drive.mkdir': function (p) {
    var parent = withFolder_(p.parentId);
    var it = parent.getFoldersByName(p.name);
    var f = it.hasNext() ? it.next() : parent.createFolder(p.name);
    return { id: f.getId(), name: f.getName() };
  },

  // drive.trash {fileId}
  'drive.trash': function (p) {
    DriveApp.getFileById(p.fileId).setTrashed(true);
    return { trashed: p.fileId };
  },

  /* ---- Sheets --------------------------------------------------- */

  // sheets.read {spreadsheetId, range} → 2D array
  'sheets.read': function (p) {
    var ss = SpreadsheetApp.openById(p.spreadsheetId);
    var range = p.range ? ss.getRange(p.range) : ss.getActiveSheet().getDataRange();
    return range.getValues();
  },

  // sheets.meta {spreadsheetId} → {title, sheets:[{name,index,rows,cols}]}
  'sheets.meta': function (p) {
    var ss = SpreadsheetApp.openById(p.spreadsheetId);
    return {
      title: ss.getName(),
      sheets: ss.getSheets().map(function (s, i) {
        return { name: s.getName(), index: i, rows: s.getLastRow(), cols: s.getLastColumn() };
      })
    };
  },

  // sheets.write {spreadsheetId, range, values} → written range
  'sheets.write': function (p) {
    var ss = SpreadsheetApp.openById(p.spreadsheetId);
    var r = ss.getRange(p.range);
    r.setValues(p.values);
    return { range: r.getA1Notation(), rows: p.values.length, cols: p.values[0] ? p.values[0].length : 0 };
  },

  // sheets.append {spreadsheetId, sheetName?, values}
  'sheets.append': function (p) {
    var ss = SpreadsheetApp.openById(p.spreadsheetId);
    var sheet = p.sheetName ? ss.getSheetByName(p.sheetName) : ss.getActiveSheet();
    p.values.forEach(function (row) { sheet.appendRow(row); });
    return { sheet: sheet.getName(), lastRow: sheet.getLastRow() };
  },

  // sheets.create {title} → new spreadsheet
  'sheets.create': function (p) {
    var ss = SpreadsheetApp.create(p.title);
    return { id: ss.getId(), url: ss.getUrl() };
  },

  /* ---- Docs ----------------------------------------------------- */

  // docs.create {title, body, folderId?} → doc
  'docs.create': function (p) {
    var doc = DocumentApp.create(p.title);
    if (p.body) doc.getBody().setText(p.body);
    doc.saveAndClose();
    var file = DriveApp.getFileById(doc.getId());
    if (p.folderId) {
      file.moveTo(DriveApp.getFolderById(p.folderId));
    }
    return { id: doc.getId(), url: doc.getUrl(), name: doc.getName() };
  },

  // docs.get {docId} → {name, text}
  'docs.get': function (p) {
    var doc = DocumentApp.openById(p.docId);
    return { name: doc.getName(), text: doc.getBody().getText() };
  },

  // docs.append {docId, text}
  'docs.append': function (p) {
    var doc = DocumentApp.openById(p.docId);
    doc.getBody().appendParagraph(p.text);
    doc.saveAndClose();
    return { appended: true, name: doc.getName() };
  },

  /* ---- Gmail ---------------------------------------------------- */

  // gmail.search {query, max?} → [{id,threadId,from,subject,date,snippet,unread}]
  'gmail.search': function (p) {
    var threads = GmailApp.search(p.query || 'in:inbox', 0, p.max || 20);
    var out = [];
    threads.forEach(function (t) {
      var m = t.getMessages()[t.getMessageCount() - 1];
      out.push({
        id: m.getId(),
        threadId: t.getId(),
        from: m.getFrom(),
        subject: m.getSubject(),
        date: m.getDate().toISOString(),
        snippet: m.getPlainBody().slice(0, 300).replace(/\s+/g, ' '),
        unread: t.isUnread(),
        labels: t.getLabels().map(function (l) { return l.getName(); })
      });
    });
    return out;
  },

  // gmail.get {id} → {from,to,subject,date,body}
  'gmail.get': function (p) {
    var m = GmailApp.getMessageById(p.id);
    return {
      from: m.getFrom(), to: m.getTo(), subject: m.getSubject(),
      date: m.getDate().toISOString(), body: m.getPlainBody()
    };
  },

  // gmail.send {to, subject, body, html?, cc?, bcc?}
  'gmail.send': function (p) {
    var opts = {};
    if (p.html) { opts.htmlBody = p.html; opts.body = p.body || p.html.replace(/<[^>]+>/g, ' '); }
    if (p.cc) opts.cc = p.cc;
    if (p.bcc) opts.bcc = p.bcc;
    GmailApp.sendEmail(p.to, p.subject, p.body || '', opts);
    return { sent: true, to: p.to };
  },

  // gmail.archive / gmail.markRead {threadId}
  'gmail.archive': function (p) {
    GmailApp.getThreadById(p.threadId).moveToArchive();
    return { archived: p.threadId };
  },
  'gmail.markRead': function (p) {
    GmailApp.getThreadById(p.threadId).markRead();
    return { read: p.threadId };
  },

  /* ---- Calendar ------------------------------------------------- */

  // calendar.list {calendarId?, timeMin, timeMax, max?} → events
  'calendar.list': function (p) {
    var cal = p.calendarId ? CalendarApp.getCalendarById(p.calendarId) : CalendarApp.getDefaultCalendar();
    var start = new Date(p.timeMin || new Date().toISOString());
    var end = new Date(p.timeMax || new Date(Date.now() + 7 * 864e5).toISOString());
    return cal.getEvents(start, end).slice(0, p.max || 25).map(function (ev) {
      return {
        id: ev.getId(),
        title: ev.getTitle(),
        start: ev.getStartTime().toISOString(),
        end: ev.getEndTime().toISOString(),
        allDay: ev.isAllDayEvent(),
        location: ev.getLocation(),
        description: (ev.getDescription() || '').slice(0, 500),
        guests: ev.getGuestList().map(function (g) { return g.getEmail(); })
      };
    });
  },

  // calendar.create {title, start, end, description?, location?, calendarId?}
  'calendar.create': function (p) {
    var cal = p.calendarId ? CalendarApp.getCalendarById(p.calendarId) : CalendarApp.getDefaultCalendar();
    var ev = cal.createEvent(p.title, new Date(p.start), new Date(p.end), {
      description: p.description || '',
      location: p.location || ''
    });
    return { id: ev.getId(), title: ev.getTitle(), start: ev.getStartTime().toISOString() };
  },

  /* ---- generic escape hatch ------------------------------------- */

  // sheet.batchUpdate etc. can be added here as the workflow needs them.
  version: function () { return { version: '1.0.0', actions: Object.keys(HANDLERS) }; }
};
