import Java from 'frida-java-bridge';

Java.perform(function () {
  var EDM = Java.use('com.viber.jni.EngineDelegatesManager');
  var StringClass = Java.use('java.lang.String');
  var callerInstance = null;

  function findCaller() {
    if (callerInstance !== null) return callerInstance;
    try {
      Java.choose('com.viber.jni.lastonline.LastOnlineControllerCaller', {
        onMatch: function (inst) {
          callerInstance = inst;
          return 'stop';
        },
        onComplete: function () {},
      });
    } catch (e) {
      send({ event: 'online-error', message: 'Java.choose LastOnlineControllerCaller failed: ' + e });
    }
    return callerInstance;
  }

  // Hook onLastOnline callback
  try {
    EDM.onLastOnline.overload('[Lcom.viber.jni.OnlineContactInfo;', 'int').implementation = function (
      infoArray,
      status,
    ) {
      var results = [];
      if (infoArray !== null) {
        for (var i = 0; i < infoArray.length; i++) {
          var item = infoArray[i];
          if (!item) continue;
          if (i === 0) {
            try {
              var fieldDump = [];
              var fields = item.class.getDeclaredFields();
              for (var fIdx = 0; fIdx < fields.length; fIdx++) {
                fields[fIdx].setAccessible(true);
                fieldDump.push(fields[fIdx].getName() + ': ' + fields[fIdx].get(item));
              }
              send({ event: 'debug-item', fields: fieldDump });
            } catch (e) {}
          }
          var mid = item.memberId ? item.memberId.value : null;
          var online = item.isOnLine ? item.isOnLine.value : false;
          var rawTime = item.time ? item.time.value.toString() : '0';
          var numTime = Number(rawTime);
          var isoDate = numTime > 0 ? new Date(numTime).toISOString() : null;

          if (mid) {
            results.push({
              memberId: mid,
              isOnline: online,
              lastSeenTimestamp: numTime > 0 ? numTime : null,
              lastSeen: isoDate,
            });
          }
        }
      }
      send({
        event: 'onLastOnline-reply',
        token: status,
        results: results,
      });
      return this.onLastOnline(infoArray, status);
    };
    send({ event: 'last-online-ready' });
  } catch (e) {
    send({ event: 'online-error', message: 'Hook EDM.onLastOnline failed: ' + e });
  }

  // Listen for query requests from host
  function listen() {
    recv('query-last-online', function (msg) {
      try {
        var caller = findCaller();
        if (!caller) {
          send({ event: 'onLastOnline-reply', token: msg.token, results: [], error: 'Caller not found' });
          listen();
          return;
        }

        var memberIds = msg.memberIds || [];
        var jArray = Java.array(
          'java.lang.String',
          memberIds.map(function (m) {
            return StringClass.$new(m);
          }),
        );

        caller.handleGetLastOnline(jArray, msg.token);
      } catch (err) {
        send({ event: 'onLastOnline-reply', token: msg.token, results: [], error: String(err) });
      }
      listen();
    });
  }
  listen();
});
