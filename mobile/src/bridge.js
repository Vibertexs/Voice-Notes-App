/**
 * The script injected into the WebView before the web app boots.
 *
 * It makes the unmodified web build run with no server behind it, by taking
 * over the two browser APIs it depends on:
 *
 *   fetch('/api/...')  -> a message to native, answered from SQLite
 *   MediaRecorder      -> a message to native, answered by expo-audio
 *
 * Recording is the reason the WebView cannot simply use the browser APIs: a
 * WebView's MediaRecorder is suspended when the screen locks, which is exactly
 * the case this app exists to handle. Audio is captured natively and never
 * crosses the bridge - only a token naming the file on disk does.
 *
 * Written as ES5 in a plain string: it runs before any bundle, on whatever
 * engine the platform's WebView provides, with no transpiler in front of it.
 */
export const BRIDGE_JS = String.raw`
(function () {
  if (window.__CN_BRIDGE__) return;
  window.__CN_BRIDGE__ = true;

  var seq = 0;
  var pending = {};

  // Registered before the bundle runs, because the failure this catches is a
  // blank page with nothing on it to read. The shell shows whatever arrives
  // here rather than leaving the user staring at white.
  function report(kind, detail) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        channel: 'page.error', payload: { kind: kind, detail: String(detail) }
      }));
    } catch (ignored) { /* nothing left to report with */ }
  }

  window.addEventListener('error', function (event) {
    report('error', (event && (event.message || (event.error && event.error.message))) || 'Script error')
      ;
  });
  window.addEventListener('unhandledrejection', function (event) {
    report('rejection', (event && event.reason && (event.reason.message || event.reason)) || 'Unhandled rejection');
  });

  // A bundle can also fail by simply never mounting - no throw, no output.
  window.addEventListener('load', function () {
    setTimeout(function () {
      var root = document.getElementById('root');
      if (!root || root.childNodes.length === 0) {
        report('blank', 'The interface loaded but rendered nothing.');
      }
    }, 2500);
  });

  function call(channel, payload) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      window.ReactNativeWebView.postMessage(JSON.stringify({
        id: id, channel: channel, payload: payload
      }));
    });
  }

  // Native calls this to answer a pending request.
  window.__cnSettle = function (id, ok, data) {
    var entry = pending[id];
    if (!entry) return;
    delete pending[id];
    if (ok) entry.resolve(data);
    else entry.reject(new Error((data && data.message) || 'The app could not complete that.'));
  };

  // ---------------------------------------------------------------- fetch --

  var realFetch = window.fetch ? window.fetch.bind(window) : null;

  function readBlob(blob) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { resolve(''); };
      reader.readAsText(blob);
    });
  }

  // A recording never travels as bytes. The shim recorder hands the page a
  // token instead of audio, and it is swapped back for the file here.
  function unwrapPart(value) {
    if (typeof value === 'string') return Promise.resolve(value);
    if (value && typeof value.size === 'number') {
      return readBlob(value).then(function (text) {
        try {
          var parsed = JSON.parse(text);
          if (parsed && parsed.__cnRecording) return { __recording: parsed.__cnRecording };
        } catch (ignored) { /* a real file, not a token */ }
        return { __file: { name: value.name || 'file', type: value.type || '', text: text } };
      });
    }
    return Promise.resolve(value);
  }

  function serializeBody(body) {
    if (!body) return Promise.resolve(null);
    if (typeof body === 'string') {
      try { return Promise.resolve(JSON.parse(body)); } catch (e) { return Promise.resolve(body); }
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      var keys = [];
      var values = [];
      body.forEach(function (value, key) { keys.push(key); values.push(unwrapPart(value)); });
      return Promise.all(values).then(function (resolved) {
        var out = {};
        for (var i = 0; i < keys.length; i++) out[keys[i]] = resolved[i];
        return out;
      });
    }
    return Promise.resolve(body);
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/') !== 0) {
      if (realFetch) return realFetch(input, init);
      return Promise.reject(new Error('Offline.'));
    }
    var options = init || {};
    var method = String(options.method || 'GET').toUpperCase();

    return serializeBody(options.body)
      .then(function (body) { return call('api', { method: method, path: url, body: body }); })
      .then(function (result) {
        var payload = result && result.body !== undefined ? result.body : null;
        var status = (result && result.status) || 200;
        // Built by hand rather than with the Response constructor. The client
        // only reads ok, status, headers.get and json, and not every WebView
        // exposes Response - one that does not would take the page down on its
        // very first request.
        return {
          ok: status >= 200 && status < 300,
          status: status,
          headers: { get: function (name) {
            return String(name).toLowerCase() === 'content-type' ? 'application/json' : null;
          } },
          json: function () { return Promise.resolve(payload); },
          text: function () { return Promise.resolve(JSON.stringify(payload)); }
        };
      });
  };

  // ------------------------------------------------------------ microphone --

  // The page only needs the stream as a handle to stop and to visualise, so a
  // stand-in is enough. Native owns the actual microphone.
  function FakeStream() {
    this.__cnFake = true;
    this.__tracks = [{ kind: 'audio', stop: function () {}, enabled: true }];
  }
  FakeStream.prototype.getTracks = function () { return this.__tracks; };
  FakeStream.prototype.getAudioTracks = function () { return this.__tracks; };

  if (!navigator.mediaDevices) navigator.mediaDevices = {};
  navigator.mediaDevices.getUserMedia = function () {
    return call('mic.permission', {}).then(function (granted) {
      if (!granted || !granted.ok) throw new Error('Microphone permission denied');
      return new FakeStream();
    });
  };

  // The waveform reads RMS off an AnalyserNode. There is no real audio graph
  // here, so the analyser is fed a synthetic trace whose amplitude follows the
  // metering level native reports - the drawing code stays untouched.
  window.__cnLevel = 0;
  window.__cnSetLevel = function (value) { window.__cnLevel = Number(value) || 0; };

  // Both spellings: some WebViews expose only the prefixed constructor, and
  // the page picks whichever it finds. Patching one and missing the other
  // leaves the trace flat with nothing to show for it.
  var audioCtors = [];
  if (typeof AudioContext !== 'undefined') audioCtors.push(AudioContext);
  if (typeof webkitAudioContext !== 'undefined' && webkitAudioContext !== AudioContext) {
    audioCtors.push(webkitAudioContext);
  }

  for (var c = 0; c < audioCtors.length; c++) {
    (function (Ctor) {
      var realCreateSource = Ctor.prototype.createMediaStreamSource;
      Ctor.prototype.createMediaStreamSource = function (stream) {
        if (!stream || !stream.__cnFake) return realCreateSource.call(this, stream);
        return {
          connect: function (node) { if (node) node.__cnSynthetic = true; return node; },
          disconnect: function () {}
        };
      };
    })(audioCtors[c]);
  }

  if (audioCtors.length && typeof AnalyserNode !== 'undefined') {
    var realGetFloat = AnalyserNode.prototype.getFloatTimeDomainData;

    // The page turns these samples into a bar height with
    //     gated = (rms - 0.006) / 0.12,  height = min(1, gated ** 0.55)
    // so the synthetic trace has to land in that window. Feeding it raw
    // amplitude instead put the RMS an order of magnitude too high and pinned
    // every bar at full height, which looked exactly like no animation at all.
    // Solving for gated == the level native measured gives the target RMS,
    // and the waveform below has RMS 0.621 x its amplitude.
    var SILENCE_FLOOR = 0.006;
    var GATE_SPAN = 0.12;
    var WAVE_RMS_PER_AMPLITUDE = 0.621;

    AnalyserNode.prototype.getFloatTimeDomainData = function (array) {
      if (!this.__cnSynthetic) return realGetFloat.call(this, array);
      var level = Math.max(0, Math.min(1, window.__cnLevel));
      var targetRms = level * GATE_SPAN + SILENCE_FLOOR;
      var amplitude = targetRms / WAVE_RMS_PER_AMPLITUDE;
      for (var i = 0; i < array.length; i++) {
        array[i] = Math.sin(i / 7) * amplitude * (0.75 + Math.random() * 0.25);
      }
      return undefined;
    };
  }

  // --------------------------------------------------------- MediaRecorder --

  function ShimRecorder(stream, options) {
    this.stream = stream;
    this.state = 'inactive';
    this.mimeType = (options && options.mimeType) || 'audio/mp4';
    this.__listeners = {};
    this.__recordingId = null;
    // Native preparation is asynchronous. Keeping its commands in order
    // avoids a fast Pause or Done reaching Expo before rec.start completes.
    this.__operation = Promise.resolve();
  }

  ShimRecorder.prototype.addEventListener = function (name, handler) {
    (this.__listeners[name] = this.__listeners[name] || []).push(handler);
  };
  ShimRecorder.prototype.removeEventListener = function (name, handler) {
    var list = this.__listeners[name] || [];
    var index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  };
  ShimRecorder.prototype.__emit = function (name, event) {
    var list = (this.__listeners[name] || []).slice();
    for (var i = 0; i < list.length; i++) list[i].call(this, event || { type: name });
    var inline = this['on' + name];
    if (typeof inline === 'function') inline.call(this, event || { type: name });
  };

  ShimRecorder.prototype.start = function () {
    var self = this;
    self.state = 'recording';
    self.__operation = self.__operation.then(function () { return call('rec.start', {}); });
    self.__operation.then(function (result) {
      self.__recordingId = result.id;
    }).catch(function (error) {
      self.state = 'inactive';
      self.__emit('error', { type: 'error', error: error, message: error.message });
    });
  };

  ShimRecorder.prototype.pause = function () {
    var self = this;
    self.state = 'paused';
    self.__operation = self.__operation.then(function () { return call('rec.pause', {}); });
    self.__operation.catch(function () {});
  };

  ShimRecorder.prototype.resume = function () {
    var self = this;
    self.state = 'recording';
    self.__operation = self.__operation.then(function () { return call('rec.resume', {}); });
    self.__operation.catch(function () {});
  };

  ShimRecorder.prototype.stop = function () {
    var self = this;
    self.__operation = self.__operation.then(function () { return call('rec.stop', {}); });
    self.__operation.then(function (result) {
      self.state = 'inactive';
      // The token stands in for the audio. It is swapped for the file on disk
      // when the page posts it back, so the bytes never cross the bridge.
      var token = JSON.stringify({ __cnRecording: result.id });
      self.__emit('dataavailable', {
        type: 'dataavailable',
        data: new Blob([token], { type: self.mimeType })
      });
      self.__emit('stop', { type: 'stop' });
    }).catch(function (error) {
      self.state = 'inactive';
      self.__emit('error', { type: 'error', error: error, message: error.message });
      self.__emit('stop', { type: 'stop' });
    });
  };

  ShimRecorder.isTypeSupported = function () { return true; };
  window.MediaRecorder = ShimRecorder;

  // ------------------------------------------------------------------ misc --

  // Tells the web app it is running inside the native shell, so it can hide
  // anything that has no meaning here.
  //
  // This script runs before the document is parsed, so documentElement may not
  // exist yet. Throwing here would abort the whole bridge and leave the page
  // talking to a server that is not there, so the flag is set now and the
  // attribute waits for a document to put it on.
  window.__CN_NATIVE__ = true;
  function markNative() {
    if (document.documentElement) {
      document.documentElement.setAttribute('data-native', 'true');
      return true;
    }
    return false;
  }
  if (!markNative()) {
    document.addEventListener('DOMContentLoaded', markNative);
  }

  true;
})();
`;
