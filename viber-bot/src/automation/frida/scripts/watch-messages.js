/*
 * Observes Viber writing rows into the `messages` SQLite table. The insert
 * happens as soon as an incoming (or outgoing) chat message is persisted, so
 * the host can ingest it without waiting for the next poll.
 *
 * Read-only: the original SQLite call always runs first and its return value
 * is passed through unchanged.
 */
import Java from 'frida-java-bridge';

Java.perform(function () {
  function dumpValues(values) {
    var out = {};
    if (values === null || values === undefined) return out;
    try {
      var keys = values.keySet().toArray();
      for (var i = 0; i < keys.length; i += 1) {
        var key = String(keys[i]);
        try {
          var raw = values.get(key);
          out[key] = raw === null || raw === undefined ? null : String(raw);
        } catch (e) {
          out[key] = null;
        }
      }
    } catch (e) {
      out._error = String(e);
    }
    return out;
  }

  function isMessagesTable(table) {
    return String(table || '').replace(/"/g, '').toLowerCase() === 'messages';
  }

  function report(op, table, rowId, values) {
    try {
      send({
        event: 'db-write',
        op: op,
        table: String(table),
        rowId: rowId === null || rowId === undefined ? null : String(rowId),
        values: dumpValues(values),
      });
    } catch (e) {
      send({ event: 'watch-error', where: 'send/' + op, message: String(e) });
    }
  }

  var hooked = [];

  try {
    var SQLiteDatabase = Java.use('android.database.sqlite.SQLiteDatabase');

    SQLiteDatabase.insertWithOnConflict.implementation = function (table, nullColumnHack, values, conflict) {
      var id = this.insertWithOnConflict(table, nullColumnHack, values, conflict);
      if (isMessagesTable(table)) {
        report('insert', table, id, values);
      }
      return id;
    };
    hooked.push('insertWithOnConflict');

    SQLiteDatabase.updateWithOnConflict.implementation = function (
      table,
      values,
      whereClause,
      whereArgs,
      conflict,
    ) {
      var count = this.updateWithOnConflict(table, values, whereClause, whereArgs, conflict);
      if (isMessagesTable(table) && count > 0) {
        report('update', table, null, values);
      }
      return count;
    };
    hooked.push('updateWithOnConflict');
  } catch (e) {
    send({ event: 'watch-error', where: 'install', message: String(e), stack: String(e.stack || '') });
    return;
  }

  send({ event: 'watch-ready', hooks: hooked });
});
