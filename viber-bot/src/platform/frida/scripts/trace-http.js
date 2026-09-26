/*
 * Diagnostic agent: reports the metadata of every HTTP exchange Viber's OkHttp
 * stack completes — method, URL, status and Content-Type. Never touches bodies.
 *
 * It exists to find the call behind the "No Connectivity" dialog: Viber's
 * native HTTP layer throws
 *
 *   NullPointerException: ... 'java.lang.String okhttp3.MediaType.toString()'
 *     at com.viber.libnativehttp.OkHttp3HttpDelegate.convertResponse
 *
 * which means a response reached it with no Content-Type header. The hook is
 * read-only: it calls the original implementation first and returns its value
 * unchanged.
 */

import Java from 'frida-java-bridge';

Java.perform(function () {
  try {
    const ResponseBuilder = Java.use('okhttp3.Response$Builder');
    ResponseBuilder.build.implementation = function () {
      const response = this.build();
      try {
        const request = response.request();
        const contentType = response.header('Content-Type', null);
        // An error page explains itself; peekBody leaves the real body intact
        // for the app to consume.
        let body = null;
        if (response.code() >= 400) {
          try {
            body = response.peekBody(2048).string().slice(0, 1200);
          } catch (inner) {
            body = '(peek failed: ' + String(inner) + ')';
          }
        }
        send({
          event: 'http',
          method: request.method(),
          url: request.url().toString(),
          code: response.code(),
          contentType: contentType === null ? null : contentType.toString(),
          headers: response.headers().toString().slice(0, 800),
          body: body,
        });
      } catch (e) {
        send({ event: 'hook-error', where: 'Response$Builder.build', message: String(e) });
      }
      return response;
    };
    send({ event: 'ready', what: 'okhttp3.Response$Builder.build' });
  } catch (e) {
    send({ event: 'hook-error', where: 'Response$Builder', message: String(e) });
  }

  // The delegate that turns a response into Viber's native representation —
  // this is where the NPE is thrown, so log what it was handed.
  try {
    const Delegate = Java.use('com.viber.libnativehttp.OkHttp3HttpDelegate');
    const overloads = Delegate.convertResponse.overloads;
    overloads.forEach(function (overload) {
      overload.implementation = function () {
        try {
          return overload.apply(this, arguments);
        } catch (e) {
          let url = '(unknown)';
          try {
            const response = arguments[0];
            if (response && response.request) url = response.request().url().toString();
          } catch (inner) {
            /* the response shape differs between builds */
          }
          send({ event: 'convert-failed', url: url, message: String(e) });
          throw e;
        }
      };
    });
    send({ event: 'ready', what: 'OkHttp3HttpDelegate.convertResponse (' + overloads.length + ')' });
  } catch (e) {
    send({ event: 'hook-error', where: 'convertResponse', message: String(e) });
  }
});
