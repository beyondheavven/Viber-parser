/*
 * Frida hook that captures Viber's Public-Group General Query replies — the
 * server-paged community roster. When the participants screen loads or scrolls,
 * Viber issues a General Query and the reply arrives at a JNI delegate method
 *
 *   onPGGeneralQueryReply(int seq, long groupId, java.lang.String reply, int status)
 *
 * whose third argument is the JSON page of members (em token, name, foto). The
 * local database never stores the full roster, so this is the only place the
 * complete member list passes through the app in one piece.
 *
 * Two modes share this one agent:
 *   - Passive capture: the onPGGeneralQueryReply hook observes every reply. It
 *     is READ-ONLY — it calls the original first and never alters a value.
 *   - Active paging (no-scroll): the host posts {type:'query', a0, a1, groupId}
 *     and the agent calls gp0.y.b(a0, a1, <long groupId>, stubCallback) to make
 *     Viber fetch that page directly, so the roster can be paged in by offset
 *     without driving the UI. The reply still comes back through the passive
 *     hook above. Requesting a page the user is already entitled to see is the
 *     same request the scroll listener fires; nothing is written or forged.
 *
 * This is a frida-compile ENTRY MODULE: the host (scripts/trace-pg-query.ts)
 * runs `frida-compile` on it, which bundles frida-java-bridge (Frida 17 removed
 * the built-in `Java` global) into a single agent before loading it.
 *
 * Every hook and call is wrapped in try/catch and reports failures over `send`
 * instead of aborting, so a class renamed or absent on some Viber build is
 * skipped rather than killing the tracer silently.
 */

import Java from 'frida-java-bridge';

// Classes that (on Viber 20.1.0.0's dex) implement the JNI delegate callback
// with the (int, long, java.lang.String, int) signature. EngineDelegatesManager
// is the un-obfuscated aggregator and the main candidate; the rest are the
// obfuscated concrete delegates. Whichever exist on this build get hooked.
var CANDIDATE_CLASSES = [
  'com.viber.jni.EngineDelegatesManager',
  'gp0.y',
  'gp0.z',
  'op0.e',
  'com.viber.voip.messages.controller.a',
];

var METHOD = 'onPGGeneralQueryReply';

// The General Query controller and its result callback interface. gp0.y.b is
// the load-more entry the scroll listener itself calls; gp0.y$a is a two-method
// callback we satisfy with a no-op stub so the request goes through cleanly.
var QUERY_CLASS = 'gp0.y';
var QUERY_METHOD = 'b';
var CALLBACK_IFACE = 'gp0.y$a';

Java.perform(function () {
  function safeString(value) {
    if (value === null || value === undefined) return null;
    try {
      return '' + value.toString();
    } catch (e) {
      return '<toString failed: ' + e + '>';
    }
  }

  function hookClass(className) {
    var Klass;
    try {
      Klass = Java.use(className);
    } catch (e) {
      send({ event: 'skip', cls: className, reason: 'Java.use failed: ' + e });
      return false;
    }

    var method = Klass[METHOD];
    if (method === undefined || method === null) {
      send({ event: 'skip', cls: className, reason: 'no ' + METHOD + ' member' });
      return false;
    }

    try {
      Klass[METHOD].overload('int', 'long', 'java.lang.String', 'int').implementation = function (
        seq,
        token,
        reply,
        status,
      ) {
        // Original first — this is a pure observer, it must never alter the flow.
        var ret = this[METHOD](seq, token, reply, status);
        try {
          send({
            event: 'pg-reply',
            cls: className,
            seq: seq,
            token: String(token),
            status: status,
            json: safeString(reply),
          });
        } catch (e) {
          send({ event: 'error', where: 'send/' + className, message: String(e) });
        }
        return ret;
      };
      return true;
    } catch (e) {
      send({ event: 'skip', cls: className, reason: 'overload failed: ' + e });
      return false;
    }
  }

  // ---- Passive capture --------------------------------------------------
  try {
    var hooked = [];
    for (var i = 0; i < CANDIDATE_CLASSES.length; i += 1) {
      if (hookClass(CANDIDATE_CLASSES[i])) hooked.push(CANDIDATE_CLASSES[i]);
    }
    send({ event: 'hooks-installed', method: METHOD, classes: hooked });
  } catch (e) {
    send({ event: 'error', where: 'install', message: String(e), stack: e.stack });
  }

  // ---- Active paging (no-scroll) ---------------------------------------
  // Lazily-built, then cached: the live gp0.y controller instance and a no-op
  // callback implementing gp0.y$a.
  var queryInstance = null;
  var stubCallback = null;

  function buildStub() {
    if (stubCallback !== null) return stubCallback;
    var Iface;
    try {
      Iface = Java.use(CALLBACK_IFACE);
    } catch (e) {
      send({ event: 'query-error', message: 'Java.use(' + CALLBACK_IFACE + ') failed: ' + e });
      return null;
    }
    try {
      // gp0.y$a: a(java.util.LinkedHashSet, boolean) and b() — both no-ops. The
      // real reply is delivered to onPGGeneralQueryReply, which the passive hook
      // above already captures, so this callback needs to do nothing.
      var Stub = Java.registerClass({
        name: 'com.frida.PgQueryStub',
        implements: [Iface],
        methods: {
          a: function (_set, _flag) {},
          b: function () {},
        },
      });
      stubCallback = Stub.$new();
    } catch (e) {
      send({ event: 'query-error', message: 'registerClass(' + CALLBACK_IFACE + ') failed: ' + e });
      return null;
    }
    return stubCallback;
  }

  try {
    var QueryKlass = Java.use(QUERY_CLASS);
    var inits = QueryKlass.$init.overloads;
    for (var k = 0; k < inits.length; k++) {
      inits[k].implementation = function () {
        queryInstance = this;
        return this.$init.apply(this, arguments);
      };
    }
    // `b` is deliberately not hooked. The name is obfuscated and shared by
    // several unrelated overloads, some of them static; replacing all of them
    // put the class wrapper (not an instance) into queryInstance and wrapped a
    // hot path for nothing. The constructor hook plus Java.choose cover it.
  } catch (hookErr) {
    send({ event: 'error', where: 'hookQueryClass/' + QUERY_CLASS, message: String(hookErr) });
  }

  function findInstance() {
    if (queryInstance !== null) return queryInstance;
    try {
      Java.choose(QUERY_CLASS, {
        onMatch: function (inst) {
          queryInstance = inst;
          return 'stop';
        },
        onComplete: function () {},
      });
    } catch (e) {
      send({ event: 'query-error', message: 'Java.choose(' + QUERY_CLASS + ') failed: ' + e });
      return null;
    }
    if (queryInstance === null) {
      send({ event: 'query-error', message: 'no live ' + QUERY_CLASS + ' instance found' });
    }
    return queryInstance;
  }

  // gp0.y.b dedups by a HashSet of already-loaded offsets: `if (set.contains(
  // sindex)) return;`. A live instance that has already paged the roster (e.g.
  // from an earlier scroll in this process) has every offset in that set, so a
  // re-request silently no-ops. Clearing the set before each call makes b send
  // the request again. The field is obfuscated, so it is found by type.
  var HashSet = null;
  var dedupReported = false;

  function clearDedup(inst) {
    try {
      if (HashSet === null) HashSet = Java.use('java.util.HashSet');
      var fields = inst.getClass().getDeclaredFields();
      var types = [];
      var cleared = 0;
      for (var i = 0; i < fields.length; i += 1) {
        var f = fields[i];
        var tn = f.getType().getName();
        types.push(tn);
        if (tn === 'java.util.HashSet') {
          f.setAccessible(true);
          var raw = f.get(inst);
          if (raw !== null) {
            Java.cast(raw, HashSet).clear();
            cleared += 1;
          }
        }
      }
      if (!dedupReported) {
        dedupReported = true;
        send({ event: 'dedup-info', cleared: cleared, fieldTypes: types });
      }
      return cleared;
    } catch (e) {
      send({ event: 'query-error', message: 'clearDedup failed: ' + e });
      return 0;
    }
  }

  // gp0.w is the Runnable that gp0.y.b enqueues: its run() does the real send
  // (generateSequence + secureToken + build request). Constructing it directly
  // with (gp0.y outer, callback, sindex, size, groupId) and running it bypasses
  // b's dedup guard entirely, which is why the cleared-HashSet path still no-op'd.
  var QUERY_RUNNABLE = 'gp0.w';

  function sendQuery(a0, a1, groupIdStr, size) {
    Java.perform(function () {
      var inst = findInstance();
      var cb = buildStub();
      if (inst === null || cb === null) return;
      // groupId is a 64-bit id that overflows a JS number; pass it as an Int64
      // so the long primitive keeps full precision.
      var gid = int64(groupIdStr);
      var pageSize = size && size > 0 ? size : 50;

      // Primary path: build and run gp0.w directly (skips b's dedup).
      try {
        var W = Java.use(QUERY_RUNNABLE);
        var w = W.$new(inst, cb, a1, pageSize, gid);
        w.run();
        send({ event: 'query-sent', via: 'gp0.w', sindex: a1, size: pageSize, groupId: groupIdStr });
        return;
      } catch (e) {
        send({ event: 'query-error', message: 'gp0.w path failed: ' + e });
      }

      // Fallback: clear the dedup set and call b the normal way.
      try {
        clearDedup(inst);
        inst[QUERY_METHOD](a0, a1, gid, cb);
        send({ event: 'query-sent', via: 'gp0.y.b', a0: a0, a1: a1, groupId: groupIdStr });
      } catch (e2) {
        send({ event: 'query-error', message: 'b fallback failed: ' + e2 });
      }
    });
  }

  // One-shot recv is re-armed after each request so the host can page in a loop.
  function listen() {
    recv('query', function (msg) {
      try {
        sendQuery(msg.a0, msg.a1, String(msg.groupId), msg.size);
      } catch (e) {
        send({ event: 'query-error', message: 'recv handler failed: ' + e });
      }
      listen();
    });
  }
  listen();
  send({ event: 'query-ready', queryClass: QUERY_CLASS, method: QUERY_METHOD });
});
